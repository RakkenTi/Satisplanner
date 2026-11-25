import {
  getDefaultMachineForRecipe,
  getDefaultRecipeForItem,
  getPrimaryFuelItemId,
  getPrimaryOutputItemId,
  ITEMS,
  MACHINES,
  RECIPES,
} from '../data/catalog';
import { solveFactory } from './solver';
import {
  PURITY_MULTIPLIER,
  type FactoryEdge,
  type FactoryNode,
  type NodePurity,
  type PlanSettings,
} from './types';

let idCounter = 1;
export function createId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export function createRecipeNode(
  recipeId: string,
  x: number,
  y: number,
  settings: PlanSettings,
  overrides?: Partial<FactoryNode>,
): FactoryNode {
  const recipe = RECIPES[recipeId];
  const machineId = recipe
    ? getDefaultMachineForRecipe(recipe, settings.defaultMinerId)
    : undefined;
  return {
    id: createId('n'),
    kind: 'recipe',
    x,
    y,
    recipeId,
    machineId,
    clockSpeed: 100,
    somersloops: 0,
    purity: settings.defaultPurity ?? 'normal',
    pinMode: 'auto',
    pinnedValue: 1,
    built: false,
    ...overrides,
  };
}

/**
 * Synthesizes a complete, cleanly de-duplicated, auto-laid-out production graph
 * for a target item and output rate per minute using the user's preferred recipes.
 */
export function buildProductionChain(
  targetItemId: string,
  targetRatePerMin: number,
  settings: PlanSettings,
  overrideRecipeId?: string,
  splitOverloaded = false,
): { nodes: FactoryNode[]; edges: FactoryEdge[] } {
  const nodes: FactoryNode[] = [];
  const edges: FactoryEdge[] = [];
  const recipeToNodeId = new Map<string, string>();
  const edgeSet = new Set<string>();
  const activeStack = new Set<string>();

  function ensureProducer(itemId: string, forcedRecipeId?: string): string | null {
    const recipe =
      (forcedRecipeId && RECIPES[forcedRecipeId]) ||
      getDefaultRecipeForItem(itemId, settings.preferredRecipes);
    if (!recipe) return null;

    // Prevent infinite recursion on cyclic recipes (e.g. Packaged <-> Unpackaged, Recycled Rubber <-> Plastic)
    if (activeStack.has(recipe.id)) {
      return recipeToNodeId.get(recipe.id) ?? null;
    }

    let nodeId = recipeToNodeId.get(recipe.id);
    if (!nodeId) {
      const node = createRecipeNode(recipe.id, 0, 0, settings);
      nodeId = node.id;
      nodes.push(node);
      recipeToNodeId.set(recipe.id, nodeId);

      activeStack.add(recipe.id);
      for (const inItemId of Object.keys(recipe.in)) {
        // Avoid trivial self-loop
        if (inItemId === itemId) continue;
        const srcNodeId = ensureProducer(inItemId);
        if (srcNodeId && srcNodeId !== nodeId) {
          const edgeKey = `${srcNodeId}:${inItemId}->${nodeId}:${inItemId}`;
          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey);
            edges.push({
              id: createId('e'),
              sourceNodeId: srcNodeId,
              sourceItemId: inItemId,
              targetNodeId: nodeId,
              targetItemId: inItemId,
            });
          }
        }
      }
      activeStack.delete(recipe.id);
    }

    return nodeId;
  }

  const rootId = ensureProducer(targetItemId, overrideRecipeId);
  if (rootId) {
    const rootNode = nodes.find((n) => n.id === rootId);
    if (rootNode) {
      rootNode.pinMode = 'output';
      rootNode.pinnedValue = Math.max(0.1, targetRatePerMin);
    }
  }

  if (splitOverloaded) {
    return splitAllOverloadedEdges(nodes, edges, settings);
  }

  const laidOut = autoLayoutNodes(nodes, edges);
  return { nodes: laidOut, edges };
}

export interface PowerPlantPlanOptions {
  generatorRecipeId: string;
  targetMW: number;
  targetMode: 'gross' | 'net';
  fuelRecipeId?: string;
  purity?: NodePurity;
  alienAugmenters?: { count: number; fueled: boolean };
  autoSinkByproducts?: boolean;
  splitOverloaded?: boolean;
}

/**
 * Builds a balanced Satisfactory 1.2 power facility targeting an exact Gross or Net MW
 * output using any generator (Fuel, Coal, Nuclear, Biomass, Geothermal, or Alien Power
 * Augmenter) and any chosen fuel production recipe.
 */
export function buildPowerPlant(
  options: PowerPlantPlanOptions,
  settings: PlanSettings,
): { nodes: FactoryNode[]; edges: FactoryEdge[] } {
  const genRecipe = RECIPES[options.generatorRecipeId];
  if (!genRecipe) return { nodes: [], edges: [] };
  const genMachine = MACHINES[genRecipe.producers[0]];
  if (!genMachine) return { nodes: [], edges: [] };

  const targetMW = Math.max(0.5, options.targetMW || 250);
  const autoSink = options.autoSinkByproducts ?? true;
  const primaryFuelId = getPrimaryFuelItemId(genRecipe);

  // Merge user's preferred recipes with sensible power-plant defaults
  const effectivePrefs: Record<string, string> = {
    'heavy-oil-residue': 'heavy-oil-residue',
    biomass: 'biomass-wood',
    ...settings.preferredRecipes,
  };
  if (primaryFuelId && options.fuelRecipeId && RECIPES[options.fuelRecipeId]) {
    effectivePrefs[primaryFuelId] = options.fuelRecipeId;
  }
  const effectiveSettings: PlanSettings = {
    ...settings,
    preferredRecipes: effectivePrefs,
  };

  const nodes: FactoryNode[] = [];
  const edges: FactoryEdge[] = [];
  const recipeToNodeId = new Map<string, string>();
  const importToNodeId = new Map<string, string>();
  const edgeSet = new Set<string>();
  const activeStack = new Set<string>();

  function ensureProducer(itemId: string): string | null {
    const recipe = getDefaultRecipeForItem(itemId, effectiveSettings.preferredRecipes);
    if (!recipe) {
      // Raw harvested items without an extractor (e.g. Leaves, Wood, Mycelia) -> External Import node
      let impId = importToNodeId.get(itemId);
      if (!impId) {
        const impNode: FactoryNode = {
          id: createId('n'),
          kind: 'input',
          x: 0,
          y: 0,
          clockSpeed: 100,
          somersloops: 0,
          purity: 'normal',
          pinMode: 'auto',
          pinnedValue: 1,
          itemId,
          ratePerMin: 60,
          label: `Import ${ITEMS[itemId]?.name ?? itemId}`,
          built: false,
        };
        impId = impNode.id;
        importToNodeId.set(itemId, impId);
        nodes.push(impNode);
      }
      return impId;
    }

    if (activeStack.has(recipe.id)) {
      return recipeToNodeId.get(recipe.id) ?? null;
    }

    let nodeId = recipeToNodeId.get(recipe.id);
    if (!nodeId) {
      const node = createRecipeNode(recipe.id, 0, 0, effectiveSettings);
      nodeId = node.id;
      nodes.push(node);
      recipeToNodeId.set(recipe.id, nodeId);

      activeStack.add(recipe.id);
      for (const inItemId of Object.keys(recipe.in)) {
        if (inItemId === itemId) continue;
        const srcId = ensureProducer(inItemId);
        if (srcId && srcId !== nodeId) {
          const key = `${srcId}:${inItemId}->${nodeId}:${inItemId}`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push({
              id: createId('e'),
              sourceNodeId: srcId,
              sourceItemId: inItemId,
              targetNodeId: nodeId,
              targetItemId: inItemId,
            });
          }
        }
      }
      activeStack.delete(recipe.id);
    }

    return nodeId;
  }

  // Create primary generator bank
  const genNode = createRecipeNode(genRecipe.id, 0, 0, effectiveSettings, {
    purity: options.purity ?? 'normal',
    pinMode: 'machines',
    pinnedValue: 1,
  });
  nodes.push(genNode);
  recipeToNodeId.set(genRecipe.id, genNode.id);

  // Build upstream fuel & water supply chains
  for (const inItemId of Object.keys(genRecipe.in)) {
    const srcId = ensureProducer(inItemId);
    if (srcId && srcId !== genNode.id) {
      const key = `${srcId}:${inItemId}->${genNode.id}:${inItemId}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({
          id: createId('e'),
          sourceNodeId: srcId,
          sourceItemId: inItemId,
          targetNodeId: genNode.id,
          targetItemId: inItemId,
        });
      }
    }
  }

  // Auto-sink secondary byproducts (e.g. Polymer Resin, Compacted Coal, Nuclear Waste)
  if (autoSink) {
    const snapshot = [...nodes];
    for (const n of snapshot) {
      if (n.kind !== 'recipe' || !n.recipeId) continue;
      const r = RECIPES[n.recipeId];
      if (!r) continue;
      const outKeys = Object.keys(r.out);
      const primaryOut = getPrimaryOutputItemId(r);
      for (const outId of outKeys) {
        const isConnected = edges.some(
          (e) => e.sourceNodeId === n.id && e.sourceItemId === outId,
        );
        // Sink unconnected byproducts (or nuclear waste from generators!)
        if (!isConnected && (outId !== primaryOut || r.isGenerator)) {
          const isWaste = outId.includes('waste');
          const sinkNode: FactoryNode = {
            id: createId('n'),
            kind: 'sink',
            x: 0,
            y: 0,
            clockSpeed: 100,
            somersloops: 0,
            purity: 'normal',
            pinMode: 'auto',
            pinnedValue: 1,
            itemId: outId,
            label: isWaste ? `Store ${ITEMS[outId]?.name ?? outId}` : `Sink ${ITEMS[outId]?.name ?? outId}`,
            built: false,
          };
          nodes.push(sinkNode);
          edges.push({
            id: createId('e'),
            sourceNodeId: n.id,
            sourceItemId: outId,
            targetNodeId: sinkNode.id,
            targetItemId: outId,
          });
        }
      }
    }
  }

  // Compute exact generator scale for Gross or Net Target MW
  const purityFactor = genMachine.supportsPurity
    ? PURITY_MULTIPLIER[options.purity ?? 'normal']
    : 1;
  const mwPerGen = Math.abs(genRecipe.powerMW ?? genMachine.basePowerMW) * purityFactor;

  const extraApaCount =
    genRecipe.id === 'power-alien-base' || genRecipe.id === 'power-alien-boosted'
      ? 0
      : Math.max(0, Math.round(options.alienAugmenters?.count ?? 0));
  const extraApaFueled = Boolean(options.alienAugmenters?.fueled);
  const extraApaBoost = extraApaCount * (extraApaFueled ? 0.3 : 0.1);
  const extraApaBaseMW = extraApaCount * 500;

  let desiredGens = 1;

  if (genRecipe.powerBoostPct) {
    // Standalone Alien Power Augmenter target: N * 500 * (1 + b * N) = targetMW
    const b = genRecipe.powerBoostPct;
    const probe = solveFactory(nodes, edges, effectiveSettings);
    const parasiticPerApa =
      options.targetMode === 'net' ? probe.totalPowerConsumedMW : 0;
    // Solve 500*b*N^2 + (500 - parasiticPerApa)*N - targetMW = 0
    const A = 500 * b;
    const B = 500 - parasiticPerApa;
    const disc = B * B + 4 * A * targetMW;
    desiredGens = Math.max(1, Math.ceil((-B + Math.sqrt(Math.max(0, disc))) / (2 * A)));
  } else if (options.targetMode === 'gross') {
    const baseNeeded = Math.max(0, targetMW / (1 + extraApaBoost) - extraApaBaseMW);
    desiredGens = mwPerGen > 0 ? Math.max(0.01, baseNeeded / mwPerGen) : 1;
  } else {
    // Net Target MW: measure exact parasitic draw per 1 generator first!
    const probe = solveFactory(nodes, edges, effectiveSettings);
    const parasiticPerGen = probe.totalPowerConsumedMW;
    const netPerGen = mwPerGen * (1 + extraApaBoost) - parasiticPerGen;
    const apaNetBase = extraApaBaseMW * (1 + extraApaBoost);
    const remainingNet = Math.max(0.01, targetMW - apaNetBase);
    if (netPerGen > 1e-3) {
      desiredGens = Math.max(0.01, remainingNet / netPerGen);
    } else {
      desiredGens = mwPerGen > 0 ? Math.max(0.01, targetMW / mwPerGen) : 1;
    }
  }

  // Ergonomic underclocking for small targets (e.g. 15 MW on a 250 MW Fuel Generator -> 1x @ 6%!)
  if (desiredGens < 1 && !genMachine.noOverclock && desiredGens >= 0.01) {
    genNode.pinnedValue = 1;
    genNode.clockSpeed = Number((desiredGens * 100).toFixed(2));
  } else {
    genNode.pinnedValue = Number(desiredGens.toFixed(4));
    genNode.clockSpeed = 100;
  }

  // Adjust any External Import nodes (Leaves/Wood/Mycelia) to match exact solved demand
  if (importToNodeId.size > 0) {
    const solvedPass = solveFactory(nodes, edges, effectiveSettings);
    for (const [itemId, impId] of importToNodeId.entries()) {
      const impNode = nodes.find((n) => n.id === impId);
      if (!impNode) continue;
      // Sum required input across downstream nodes connected to this import
      let req = 0;
      for (const e of edges) {
        if (e.sourceNodeId === impId) {
          req += solvedPass.nodes[e.targetNodeId]?.inputs[itemId]?.required ?? 0;
        }
      }
      if (req > 0) impNode.ratePerMin = Number(req.toFixed(3));
    }
  }

  // Attach optional Alien Power Augmenter booster(s)
  if (extraApaCount > 0) {
    const apaRecipeId = extraApaFueled ? 'power-alien-boosted' : 'power-alien-base';
    const apaNode = createRecipeNode(apaRecipeId, 0, 0, effectiveSettings, {
      pinMode: 'machines',
      pinnedValue: extraApaCount,
    });
    nodes.push(apaNode);

    if (extraApaFueled) {
      const matrixImport: FactoryNode = {
        id: createId('n'),
        kind: 'input',
        x: 0,
        y: 0,
        clockSpeed: 100,
        somersloops: 0,
        purity: 'normal',
        pinMode: 'auto',
        pinnedValue: 1,
        itemId: 'alien-power-matrix',
        ratePerMin: extraApaCount * 5,
        label: 'Import Matrix',
        built: false,
      };
      nodes.push(matrixImport);
      edges.push({
        id: createId('e'),
        sourceNodeId: matrixImport.id,
        sourceItemId: 'alien-power-matrix',
        targetNodeId: apaNode.id,
        targetItemId: 'alien-power-matrix',
      });
    }
  }

  if (options.splitOverloaded) {
    return splitAllOverloadedEdges(nodes, edges, effectiveSettings);
  }

  return { nodes: autoLayoutNodes(nodes, edges), edges };
}

function estimateNodeHeight(n: FactoryNode): number {
  if (n.kind !== 'recipe' || !n.recipeId) return 118;
  const r = RECIPES[n.recipeId];
  if (!r) return 160;
  const maxPorts = Math.max(Object.keys(r.in).length, Object.keys(r.out).length, 1);
  return 112 + maxPorts * 34;
}

function areHomogeneousSources(
  inEdges: FactoryEdge[],
  nodeMap: Map<string, FactoryNode>,
): boolean {
  if (inEdges.length <= 1) return true;
  const first = nodeMap.get(inEdges[0].sourceNodeId);
  if (!first) return false;
  return inEdges.every((e) => {
    const n = nodeMap.get(e.sourceNodeId);
    if (!n) return false;
    return (
      n.kind === first.kind &&
      n.recipeId === first.recipeId &&
      n.machineId === first.machineId &&
      n.pinMode === first.pinMode &&
      n.clockSpeed === first.clockSpeed &&
      n.purity === first.purity &&
      n.somersloops === first.somersloops &&
      n.itemId === first.itemId &&
      Math.abs((n.pinnedValue ?? 0) - (first.pinnedValue ?? 0)) < 1e-3 &&
      Math.abs((n.ratePerMin ?? 0) - (first.ratePerMin ?? 0)) < 1e-3
    );
  });
}

export interface SplitEdgeResult {
  nodes: FactoryNode[];
  edges: FactoryEdge[];
  splitCount: number;
  sourceNodeId: string;
  newNodeIds: string[];
}

/**
 * Splits an overloaded belt or pipe by dividing its source machine node into N parallel
 * nodes (e.g. 10x Water Extractors at 1200 m3/min -> 2x 5x Water Extractors at 600 m3/min)
 * and rewiring upstream and downstream connections cleanly.
 */
export function splitOverloadedEdge(
  nodes: FactoryNode[],
  edges: FactoryEdge[],
  edgeId: string,
  settings: PlanSettings,
  options?: { splitCount?: number; nudgeColumn?: boolean },
): SplitEdgeResult {
  const edge = edges.find((e) => e.id === edgeId);
  if (!edge) {
    return { nodes, edges, splitCount: 1, sourceNodeId: '', newNodeIds: [] };
  }

  const src = nodes.find((n) => n.id === edge.sourceNodeId);
  if (!src) {
    return { nodes, edges, splitCount: 1, sourceNodeId: '', newNodeIds: [] };
  }

  let splitCount = options?.splitCount;
  if (!splitCount) {
    const solved = solveFactory(nodes, edges, settings);
    const se = solved.edges[edgeId];
    if (!se || !se.overLimit || se.beltCountAtMax < 2) {
      return { nodes, edges, splitCount: 1, sourceNodeId: src.id, newNodeIds: [] };
    }
    splitCount = se.beltCountAtMax;
  }

  splitCount = Math.max(2, Math.min(24, Math.ceil(splitCount)));

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const srcHeight = estimateNodeHeight(src);
  const stepY = Math.round((srcHeight + 36) / 24) * 24;
  const expandHalf = Math.round((((splitCount - 1) * stepY) / 2) / 24) * 24;

  const copies: FactoryNode[] = [];
  for (let i = 0; i < splitCount; i++) {
    const copyY = Math.round((src.y + (i - (splitCount - 1) / 2) * stepY) / 24) * 24;
    const copy: FactoryNode = {
      ...src,
      id: i === 0 ? src.id : createId('n'),
      y: copyY,
    };

    if (copy.kind === 'recipe' && (copy.pinMode === 'machines' || copy.pinMode === 'output')) {
      copy.pinnedValue = Number((src.pinnedValue / splitCount).toFixed(4));
    } else if (copy.kind === 'input') {
      copy.ratePerMin = Number(((src.ratePerMin ?? 60) / splitCount).toFixed(4));
    }

    copies.push(copy);
  }

  // Gently nudge same-column neighbors vertically so split nodes don't overlap them
  const nudgeColumn = options?.nudgeColumn ?? true;
  const topCopyY = copies[0].y;
  const bottomCopyBottom = copies[copies.length - 1].y + srcHeight;

  let needNudgeUp = false;
  let needNudgeDown = false;
  if (nudgeColumn) {
    for (const n of nodes) {
      if (n.id === src.id) continue;
      if (Math.abs(n.x - src.x) >= 260) continue;
      const nh = estimateNodeHeight(n);
      if (n.y < src.y && n.y + nh + 16 > topCopyY) {
        needNudgeUp = true;
      } else if (n.y > src.y && n.y < bottomCopyBottom + 16) {
        needNudgeDown = true;
      }
    }
  }

  const nextNodes: FactoryNode[] = [];
  for (const n of nodes) {
    if (n.id === src.id) {
      nextNodes.push(...copies);
    } else if (nudgeColumn && Math.abs(n.x - src.x) < 260) {
      if (needNudgeUp && n.y < src.y) {
        nextNodes.push({ ...n, y: Math.round((n.y - expandHalf) / 24) * 24 });
      } else if (needNudgeDown && n.y > src.y) {
        nextNodes.push({ ...n, y: Math.round((n.y + expandHalf) / 24) * 24 });
      } else {
        nextNodes.push(n);
      }
    } else {
      nextNodes.push(n);
    }
  }

  // Partition existing edges
  const unrelatedEdges: FactoryEdge[] = [];
  const inEdges: FactoryEdge[] = [];
  const otherOutEdges: FactoryEdge[] = [];

  for (const e of edges) {
    if (e.id === edge.id) continue;
    if (e.targetNodeId === src.id && e.sourceNodeId !== src.id) {
      inEdges.push(e);
    } else if (e.sourceNodeId === src.id && e.targetNodeId !== src.id) {
      otherOutEdges.push(e);
    } else if (e.sourceNodeId !== src.id && e.targetNodeId !== src.id) {
      unrelatedEdges.push(e);
    }
  }

  const newEdges: FactoryEdge[] = [...unrelatedEdges];
  const seenEdgeKey = new Set(
    unrelatedEdges.map(
      (e) => `${e.sourceNodeId}:${e.sourceItemId}->${e.targetNodeId}:${e.targetItemId}`,
    ),
  );

  const pushEdge = (
    sourceNodeId: string,
    sourceItemId: string,
    targetNodeId: string,
    targetItemId: string,
    priority?: number,
  ) => {
    const key = `${sourceNodeId}:${sourceItemId}->${targetNodeId}:${targetItemId}`;
    if (seenEdgeKey.has(key)) return;
    seenEdgeKey.add(key);
    newEdges.push({
      id: createId('e'),
      sourceNodeId,
      sourceItemId,
      targetNodeId,
      targetItemId,
      priority,
    });
  };

  // 1. Wire incoming edges grouped by targetItemId
  const inByItem = new Map<string, FactoryEdge[]>();
  for (const e of inEdges) {
    if (!inByItem.has(e.targetItemId)) inByItem.set(e.targetItemId, []);
    inByItem.get(e.targetItemId)!.push(e);
  }
  for (const [, group] of inByItem) {
    const homogeneous = areHomogeneousSources(group, nodeMap);
    if (homogeneous && group.length === splitCount) {
      // Pair parallel upstream lanes 1-to-1
      for (let i = 0; i < splitCount; i++) {
        const g = group[i];
        pushEdge(g.sourceNodeId, g.sourceItemId, copies[i].id, g.targetItemId, g.priority);
      }
    } else if (homogeneous && group.length > splitCount && group.length % splitCount === 0) {
      const perCopy = group.length / splitCount;
      for (let i = 0; i < splitCount; i++) {
        for (let j = 0; j < perCopy; j++) {
          const g = group[i * perCopy + j];
          pushEdge(g.sourceNodeId, g.sourceItemId, copies[i].id, g.targetItemId, g.priority);
        }
      }
    } else {
      for (const g of group) {
        for (const copy of copies) {
          pushEdge(g.sourceNodeId, g.sourceItemId, copy.id, g.targetItemId, g.priority);
        }
      }
    }
  }

  // 2. Wire the target overloaded edge as splitCount parallel connections
  for (const copy of copies) {
    pushEdge(copy.id, edge.sourceItemId, edge.targetNodeId, edge.targetItemId, edge.priority);
  }

  // 3. Wire any other outgoing edges from src (e.g. byproducts or sibling consumers)
  const outByItem = new Map<string, FactoryEdge[]>();
  for (const e of otherOutEdges) {
    if (!outByItem.has(e.sourceItemId)) outByItem.set(e.sourceItemId, []);
    outByItem.get(e.sourceItemId)!.push(e);
  }
  for (const [, group] of outByItem) {
    const distinctTargets = new Set(group.map((g) => g.targetNodeId));
    if (group.length === splitCount && distinctTargets.size === splitCount) {
      for (let i = 0; i < splitCount; i++) {
        const g = group[i];
        pushEdge(copies[i].id, g.sourceItemId, g.targetNodeId, g.targetItemId, g.priority);
      }
    } else {
      for (const g of group) {
        for (const copy of copies) {
          pushEdge(copy.id, g.sourceItemId, g.targetNodeId, g.targetItemId, g.priority);
        }
      }
    }
  }

  return {
    nodes: nextNodes,
    edges: newEdges,
    splitCount,
    sourceNodeId: src.id,
    newNodeIds: copies.map((c) => c.id),
  };
}

/**
 * Iteratively splits all overloaded pipes and belts in topological order (upstream first)
 * so parallel lanes pair 1-to-1, then lays out the resulting graph.
 */
export function splitAllOverloadedEdges(
  nodes: FactoryNode[],
  edges: FactoryEdge[],
  settings: PlanSettings,
): { nodes: FactoryNode[]; edges: FactoryEdge[]; splitsPerformed: number } {
  let curNodes = nodes;
  let curEdges = edges;
  let splitsPerformed = 0;
  const MAX_PASSES = 20;
  const MAX_NODES = 160;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    if (curNodes.length >= MAX_NODES) break;
    const solved = solveFactory(curNodes, curEdges, settings);
    const overloaded = curEdges
      .map((e) => ({ edge: e, se: solved.edges[e.id] }))
      .filter((x) => x.se && x.se.overLimit && x.se.beltCountAtMax >= 2);

    if (overloaded.length === 0) break;

    // Compute approximate topological depth so upstream extractors split before downstream consumers
    const depth = new Map<string, number>();
    for (const n of curNodes) depth.set(n.id, 0);
    for (let p = 0; p < Math.min(curNodes.length, 16); p++) {
      let changed = false;
      for (const e of curEdges) {
        if (e.sourceNodeId === e.targetNodeId) continue;
        const dSrc = depth.get(e.sourceNodeId) ?? 0;
        const dDst = depth.get(e.targetNodeId) ?? 0;
        if (dDst <= dSrc) {
          depth.set(e.targetNodeId, dSrc + 1);
          changed = true;
        }
      }
      if (!changed) break;
    }

    overloaded.sort((a, b) => {
      const da = depth.get(a.edge.sourceNodeId) ?? 0;
      const db = depth.get(b.edge.sourceNodeId) ?? 0;
      if (da !== db) return da - db;
      if (a.se.isFluid !== b.se.isFluid) return a.se.isFluid ? -1 : 1;
      return b.se.flowRate - a.se.flowRate;
    });

    const target = overloaded[0];
    if (curNodes.length + (target.se.beltCountAtMax - 1) > MAX_NODES) break;

    const res = splitOverloadedEdge(curNodes, curEdges, target.edge.id, settings, {
      splitCount: target.se.beltCountAtMax,
      nudgeColumn: false,
    });
    if (res.splitCount <= 1) break;
    curNodes = res.nodes;
    curEdges = res.edges;
    splitsPerformed += 1;
  }

  return {
    nodes: autoLayoutNodes(curNodes, curEdges),
    edges: curEdges,
    splitsPerformed,
  };
}

/**
 * Expands any unconnected input ports on a target node by spawning upstream
 * recipe nodes neatly to its left and connecting them automatically.
 * Reuses existing compatible upstream nodes only if `reuseExisting` is true.
 */
export function expandMissingInputsForNode(
  nodes: FactoryNode[],
  edges: FactoryEdge[],
  targetNodeId: string,
  settings: PlanSettings,
  recursive = false,
): { addedNodes: FactoryNode[]; addedEdges: FactoryEdge[] } {
  const addedNodes: FactoryNode[] = [];
  const addedEdges: FactoryEdge[] = [];
  const allNodes = [...nodes];
  const allEdges = [...edges];
  const visited = new Set<string>();

  function expand(nodeId: string, depth: number) {
    if (visited.has(nodeId) || depth > 10) return;
    visited.add(nodeId);
    const node = allNodes.find((n) => n.id === nodeId);
    if (!node || node.kind !== 'recipe' || !node.recipeId) return;
    const recipe = RECIPES[node.recipeId];
    if (!recipe) return;

    const missingItems = Object.keys(recipe.in).filter(
      (inItemId) =>
        !allEdges.some((e) => e.targetNodeId === nodeId && e.targetItemId === inItemId),
    );

    const spacingY = 190;
    const startY = node.y - ((missingItems.length - 1) * spacingY) / 2;

    missingItems.forEach((inItemId, idx) => {
      const upstreamRecipe = getDefaultRecipeForItem(inItemId, settings.preferredRecipes);
      if (!upstreamRecipe) return;

      const newNode = createRecipeNode(
        upstreamRecipe.id,
        Math.round((node.x - 360) / 24) * 24,
        Math.round((startY + idx * spacingY) / 24) * 24,
        settings,
      );
      const newEdge: FactoryEdge = {
        id: createId('e'),
        sourceNodeId: newNode.id,
        sourceItemId: inItemId,
        targetNodeId: nodeId,
        targetItemId: inItemId,
      };

      addedNodes.push(newNode);
      addedEdges.push(newEdge);
      allNodes.push(newNode);
      allEdges.push(newEdge);

      if (recursive && !upstreamRecipe.isExtractor) {
        expand(newNode.id, depth + 1);
      }
    });
  }

  expand(targetNodeId, 0);
  return { addedNodes, addedEdges };
}

/**
 * Clean left-to-right Sugiyama-style topological layered auto-layout with
 * barycenter crossing minimization and generous breathing room.
 */
export function autoLayoutNodes(
  nodes: FactoryNode[],
  edges: FactoryEdge[],
): FactoryNode[] {
  if (nodes.length === 0) return nodes;

  const nodeIds = new Set(nodes.map((n) => n.id));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const n of nodes) {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }
  for (const e of edges) {
    if (!nodeIds.has(e.sourceNodeId) || !nodeIds.has(e.targetNodeId)) continue;
    if (e.sourceNodeId === e.targetNodeId) continue;
    outgoing.get(e.sourceNodeId)!.push(e.targetNodeId);
    incoming.get(e.targetNodeId)!.push(e.sourceNodeId);
  }

  // Detect cycle back-edges (e.g. Aluminum recycled water loop) via DFS so
  // feedback arcs don't distort left-to-right topological columns!
  const backEdges = new Set<string>();
  const color = new Map<string, number>(); // 0=unvisited, 1=visiting, 2=done
  // Start DFS from natural sources (extractors, inputs, zero in-degree nodes) first
  const dfsOrder = [...nodes].sort((a, b) => {
    const aScore =
      a.kind === 'input' || (a.recipeId && RECIPES[a.recipeId]?.isExtractor)
        ? 0
        : (incoming.get(a.id)?.length ?? 0);
    const bScore =
      b.kind === 'input' || (b.recipeId && RECIPES[b.recipeId]?.isExtractor)
        ? 0
        : (incoming.get(b.id)?.length ?? 0);
    return aScore - bScore;
  });

  const dfs = (u: string) => {
    color.set(u, 1);
    for (const v of outgoing.get(u) ?? []) {
      const c = color.get(v) ?? 0;
      if (c === 1) {
        backEdges.add(`${u}->${v}`);
      } else if (c === 0) {
        dfs(v);
      }
    }
    color.set(u, 2);
  };
  for (const n of dfsOrder) {
    if ((color.get(n.id) ?? 0) === 0) dfs(n.id);
  }

  const dagEdges = edges.filter(
    (e) =>
      nodeIds.has(e.sourceNodeId) &&
      nodeIds.has(e.targetNodeId) &&
      e.sourceNodeId !== e.targetNodeId &&
      !backEdges.has(`${e.sourceNodeId}->${e.targetNodeId}`),
  );

  // Assign layers via longest path on the acyclic DAG
  const layer = new Map<string, number>();
  for (const n of nodes) {
    layer.set(n.id, 0);
  }

  const maxPasses = Math.min(nodes.length + 2, 24);
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const e of dagEdges) {
      const srcL = layer.get(e.sourceNodeId) ?? 0;
      const dstL = layer.get(e.targetNodeId) ?? 0;
      if (dstL <= srcL) {
        layer.set(e.targetNodeId, srcL + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Pull pure sources closer to their consumers so skip-edges stay tidy
  const dagOut = new Map<string, string[]>();
  const dagIn = new Map<string, string[]>();
  for (const n of nodes) {
    dagOut.set(n.id, []);
    dagIn.set(n.id, []);
  }
  for (const e of dagEdges) {
    dagOut.get(e.sourceNodeId)!.push(e.targetNodeId);
    dagIn.get(e.targetNodeId)!.push(e.sourceNodeId);
  }

  for (let pass = 0; pass < 3; pass++) {
    for (const n of nodes) {
      const outs = dagOut.get(n.id) ?? [];
      const ins = dagIn.get(n.id) ?? [];
      if (outs.length > 0 && ins.length === 0) {
        const minOutLayer = Math.min(...outs.map((id) => layer.get(id) ?? 1));
        if (minOutLayer > 1) {
          layer.set(n.id, minOutLayer - 1);
        }
      }
    }
  }

  // Group into columns
  const colMap = new Map<number, FactoryNode[]>();
  for (const n of nodes) {
    const col = layer.get(n.id) ?? 0;
    if (!colMap.has(col)) colMap.set(col, []);
    colMap.get(col)!.push(n);
  }
  const sortedCols = Array.from(colMap.keys()).sort((a, b) => a - b);

  // Normalize column indices to 0..K-1
  const columns: FactoryNode[][] = sortedCols.map((c) => colMap.get(c)!);

  // Barycenter sweeps (left-to-right and right-to-left) to minimize edge crossings
  const rankInCol = new Map<string, number>();
  const refreshRanks = () => {
    for (const col of columns) {
      col.forEach((n, idx) => rankInCol.set(n.id, idx));
    }
  };
  refreshRanks();

  for (let sweep = 0; sweep < 4; sweep++) {
    // Forward sweep
    for (let c = 1; c < columns.length; c++) {
      columns[c].sort((a, b) => {
        const aIns = incoming.get(a.id) ?? [];
        const bIns = incoming.get(b.id) ?? [];
        const aAvg =
          aIns.length > 0
            ? aIns.reduce((s, id) => s + (rankInCol.get(id) ?? 0), 0) / aIns.length
            : rankInCol.get(a.id) ?? 0;
        const bAvg =
          bIns.length > 0
            ? bIns.reduce((s, id) => s + (rankInCol.get(id) ?? 0), 0) / bIns.length
            : rankInCol.get(b.id) ?? 0;
        return aAvg - bAvg;
      });
      refreshRanks();
    }
    // Backward sweep
    for (let c = columns.length - 2; c >= 0; c--) {
      columns[c].sort((a, b) => {
        const aOuts = outgoing.get(a.id) ?? [];
        const bOuts = outgoing.get(b.id) ?? [];
        const aAvg =
          aOuts.length > 0
            ? aOuts.reduce((s, id) => s + (rankInCol.get(id) ?? 0), 0) / aOuts.length
            : rankInCol.get(a.id) ?? 0;
        const bAvg =
          bOuts.length > 0
            ? bOuts.reduce((s, id) => s + (rankInCol.get(id) ?? 0), 0) / bOuts.length
            : rankInCol.get(b.id) ?? 0;
        return aAvg - bAvg;
      });
      refreshRanks();
    }
  }

  // Compute coordinates with adaptive node height & crisp 24px grid alignment
  const COL_GAP = 408;
  const ROW_PAD = 44;

  const estimateHeight = (n: FactoryNode): number => {
    if (n.kind !== 'recipe' || !n.recipeId) return 118;
    const r = RECIPES[n.recipeId];
    if (!r) return 160;
    const maxPorts = Math.max(Object.keys(r.in).length, Object.keys(r.out).length, 1);
    return 112 + maxPorts * 34;
  };

  const posMap = new Map<string, { x: number; y: number }>();
  columns.forEach((col, colIdx) => {
    const heights = col.map(estimateHeight);
    const totalHeight =
      heights.reduce((a, b) => a + b, 0) + Math.max(0, col.length - 1) * ROW_PAD;
    let curY = -totalHeight / 2;

    col.forEach((n, rowIdx) => {
      const h = heights[rowIdx];
      const x = Math.round((colIdx * COL_GAP + 80) / 24) * 24;
      const y = Math.round((curY + 320) / 24) * 24;
      posMap.set(n.id, { x, y });
      curY += h + ROW_PAD;
    });
  });

  return nodes.map((n) => {
    const p = posMap.get(n.id);
    return p ? { ...n, x: p.x, y: p.y } : n;
  });
}
