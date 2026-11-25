import {
  getBeltForRate,
  getMaxBeltSpec,
  getPrimaryOutputItemId,
  ITEMS,
  MACHINES,
  RECIPES,
} from '../data/catalog';
import {
  PURITY_MULTIPLIER,
  type BuildingSummaryItem,
  type FactoryEdge,
  type FactoryNode,
  type PlanSettings,
  type PortStatus,
  type ResourceFlowSummary,
  type SolvedEdge,
  type SolvedFactory,
  type SolvedNode,
  type SolvedPort,
} from './types';

const POWER_EXPONENT = 1.321928; // log2(2.5) in Satisfactory 1.0 - 1.2
const EPS = 1e-4;

export interface MachineRates {
  inPerMin: Record<string, number>;
  outPerMin: Record<string, number>;
  powerPerMachineMW: number; // positive = draw, negative = generation
  primaryOutItemId?: string;
}

/**
 * Computes exact per-machine input rates, output rates, and power draw (MW)
 * for a single machine of a recipe node at its configured clock, purity, somersloops,
 * and Satisfactory 1.2 Game Mode multipliers.
 */
export function getSingleMachineRates(
  node: FactoryNode,
  settings: PlanSettings,
): MachineRates | null {
  if (node.kind !== 'recipe' || !node.recipeId) return null;
  const recipe = RECIPES[node.recipeId];
  if (!recipe) return null;
  const machineId = node.machineId ?? recipe.producers[0];
  const machine = MACHINES[machineId];
  if (!machine) return null;

  const effectiveClock = machine.noOverclock
    ? 100
    : Math.max(1, Math.min(250, node.clockSpeed || 100));
  const clockFactor = effectiveClock / 100;
  const purityFactor = machine.supportsPurity
    ? PURITY_MULTIPLIER[node.purity ?? 'normal']
    : 1;
  const maxSloops = machine.somersloopSlots || 0;
  const clampedSloops =
    maxSloops > 0 ? Math.max(0, Math.min(maxSloops, Math.round(node.somersloops || 0))) : 0;
  const sloopOutFactor = maxSloops > 0 ? 1 + clampedSloops / maxSloops : 1;
  const sloopPowerFactor = sloopOutFactor * sloopOutFactor;

  const cyclesPerMin = (60 / recipe.time) * machine.speed * purityFactor * clockFactor;
  const costMult = recipe.noCostMultiplier ? 1 : settings.recipeCostMultiplier || 1;

  const inPerMin: Record<string, number> = {};
  for (const [itemId, qty] of Object.entries(recipe.in)) {
    inPerMin[itemId] = qty * cyclesPerMin * costMult;
  }

  const outPerMin: Record<string, number> = {};
  for (const [itemId, qty] of Object.entries(recipe.out)) {
    outPerMin[itemId] = qty * cyclesPerMin * sloopOutFactor;
  }

  const baseMW = recipe.powerMW !== undefined ? recipe.powerMW : machine.basePowerMW;
  let powerPerMachineMW: number;
  if (machine.isGenerator || baseMW < 0) {
    // Generators scale linearly with clock speed (and purity for Geothermal Generators)
    powerPerMachineMW = baseMW * clockFactor * purityFactor;
  } else {
    powerPerMachineMW =
      baseMW *
      Math.pow(clockFactor, POWER_EXPONENT) *
      sloopPowerFactor *
      (settings.powerMultiplier || 1);
  }

  return {
    inPerMin,
    outPerMin,
    powerPerMachineMW,
    primaryOutItemId: getPrimaryOutputItemId(recipe),
  };
}

/**
 * Infers the item flowing through a Splitter, Merger, Input, or Sink node
 * from its explicit itemId or connected edges.
 */
export function resolveLogisticsItemId(
  node: FactoryNode,
  edges: FactoryEdge[],
): string | undefined {
  if (node.itemId && ITEMS[node.itemId]) return node.itemId;
  for (const e of edges) {
    if (e.sourceNodeId === node.id && e.sourceItemId && ITEMS[e.sourceItemId]) {
      return e.sourceItemId;
    }
    if (e.targetNodeId === node.id && e.targetItemId && ITEMS[e.targetItemId]) {
      return e.targetItemId;
    }
  }
  return undefined;
}

/**
 * Real-time bidirectional constraint and flow solver.
 *
 * Supports:
 * - Target-driven (pull) scaling from pinned outputs or machine counts
 * - Supply-driven (push) scaling from pinned inputs / extractors
 * - Smart byproduct recycling loops (e.g. Aluminum water loop, Dark Matter Residue)
 * - Splitters (demand-balanced, even, and priority overflow) and Mergers
 * - Exact belt/pipe capacity & bottleneck analysis
 */
export function solveFactory(
  nodes: FactoryNode[],
  edges: FactoryEdge[],
  settings: PlanSettings,
): SolvedFactory {
  const nodeMap = new Map<string, FactoryNode>();
  const outEdgesByNode = new Map<string, FactoryEdge[]>();
  const inEdgesByNode = new Map<string, FactoryEdge[]>();

  for (const n of nodes) {
    nodeMap.set(n.id, n);
    outEdgesByNode.set(n.id, []);
    inEdgesByNode.set(n.id, []);
  }
  for (const e of edges) {
    if (!nodeMap.has(e.sourceNodeId) || !nodeMap.has(e.targetNodeId)) continue;
    outEdgesByNode.get(e.sourceNodeId)!.push(e);
    inEdgesByNode.get(e.targetNodeId)!.push(e);
  }

  // Precompute single-machine rates for recipe nodes
  const singleRates = new Map<string, MachineRates>();
  for (const n of nodes) {
    const r = getSingleMachineRates(n, settings);
    if (r) singleRates.set(n.id, r);
  }

  // Track machine counts for recipe nodes and throughput for logistics nodes
  const machineCount = new Map<string, number>();
  const isPinned = new Set<string>();

  for (const n of nodes) {
    if (n.kind === 'recipe') {
      const sr = singleRates.get(n.id);
      if (!sr) {
        machineCount.set(n.id, 0);
        continue;
      }
      if (n.pinMode === 'machines') {
        machineCount.set(n.id, Math.max(0, n.pinnedValue || 0));
        isPinned.add(n.id);
      } else if (n.pinMode === 'output') {
        const prim = sr.primaryOutItemId;
        const unitOut = prim ? sr.outPerMin[prim] : 0;
        if (unitOut > EPS) {
          machineCount.set(n.id, Math.max(0, n.pinnedValue || 0) / unitOut);
        } else {
          machineCount.set(n.id, Math.max(0, n.pinnedValue || 0));
        }
        isPinned.add(n.id);
      } else {
        // Auto-scaled: start at 0 if it has downstream consumers, else 1
        const outs = outEdgesByNode.get(n.id) ?? [];
        machineCount.set(n.id, outs.length > 0 ? 0 : 1);
      }
    } else if (n.kind === 'input') {
      isPinned.add(n.id);
      machineCount.set(n.id, 1);
    } else {
      machineCount.set(n.id, 1);
    }
  }

  // Track solved edge demands (pull) and edge supplies (push)
  const edgeDemand = new Map<string, number>();
  const edgeSupply = new Map<string, number>();
  for (const e of edges) {
    edgeDemand.set(e.id, 0);
    edgeSupply.set(e.id, 0);
  }

  // Helper: get node's current produced rate for an item
  const getNodeOutRate = (nodeId: string, itemId: string): number => {
    const n = nodeMap.get(nodeId);
    if (!n) return 0;
    if (n.kind === 'recipe') {
      const sr = singleRates.get(nodeId);
      const count = machineCount.get(nodeId) ?? 0;
      return (sr?.outPerMin[itemId] ?? 0) * count;
    }
    if (n.kind === 'input') {
      const item = resolveLogisticsItemId(n, edges);
      return item === itemId ? Math.max(0, n.ratePerMin ?? 60) : 0;
    }
    if (n.kind === 'merger' || n.kind === 'splitter') {
      const ins = inEdgesByNode.get(nodeId) ?? [];
      let sum = 0;
      for (const e of ins) {
        if (e.targetItemId === itemId || e.sourceItemId === itemId) {
          sum += edgeSupply.get(e.id) ?? 0;
        }
      }
      return sum;
    }
    return 0;
  };

  // Iterative bidirectional fixed-point solver (converges cleanly even with byproduct loops)
  const MAX_ITERS = 36;
  for (let iter = 0; iter < MAX_ITERS; iter++) {
    let maxDelta = 0;

    // 1. Backward Demand Propagation (from sinks / recipes / splitters / mergers -> incoming edges)
    for (const n of nodes) {
      const ins = inEdgesByNode.get(n.id) ?? [];
      const outs = outEdgesByNode.get(n.id) ?? [];

      if (n.kind === 'recipe') {
        const sr = singleRates.get(n.id);
        if (!sr) continue;
        const count = machineCount.get(n.id) ?? 0;

        // Group incoming edges by itemId
        for (const [itemId, unitIn] of Object.entries(sr.inPerMin)) {
          const totalReq = unitIn * count;
          const matchingIns = ins.filter((e) => e.targetItemId === itemId);
          if (matchingIns.length === 0) continue;
          distributeDemandAcrossInputs(matchingIns, totalReq, nodeMap, isPinned, getNodeOutRate, edgeDemand, outEdgesByNode);
        }
      } else if (n.kind === 'splitter') {
        const totalOutDemand = outs.reduce((s, e) => s + (edgeDemand.get(e.id) ?? 0), 0);
        if (ins.length > 0) {
          const perIn = totalOutDemand / ins.length;
          for (const e of ins) edgeDemand.set(e.id, perIn);
        }
      } else if (n.kind === 'merger') {
        const totalOutDemand = outs.reduce((s, e) => s + (edgeDemand.get(e.id) ?? 0), 0);
        if (ins.length > 0) {
          distributeDemandAcrossInputs(ins, totalOutDemand, nodeMap, isPinned, getNodeOutRate, edgeDemand, outEdgesByNode);
        }
      } else if (n.kind === 'sink') {
        // Sink absorbs whatever is pushed into it (or its configured cap if > 0)
        const cap = n.ratePerMin && n.ratePerMin > 0 ? n.ratePerMin : 0;
        if (cap > 0 && ins.length > 0) {
          for (const e of ins) edgeDemand.set(e.id, cap / ins.length);
        } else {
          for (const e of ins) edgeDemand.set(e.id, edgeSupply.get(e.id) ?? 0);
        }
      }
    }

    // 2. Update auto-scaled (unpinned) recipe nodes based on downstream demand
    for (const n of nodes) {
      if (n.kind !== 'recipe' || isPinned.has(n.id)) continue;
      const sr = singleRates.get(n.id);
      if (!sr) continue;
      const outs = outEdgesByNode.get(n.id) ?? [];
      const ins = inEdgesByNode.get(n.id) ?? [];

      let desiredMachines = 0;
      let hasDownstreamPull = false;

      // Primary output drives scaling if demanded; otherwise check all outputs
      for (const [outItem, unitOut] of Object.entries(sr.outPerMin)) {
        if (unitOut <= EPS) continue;
        const outEdges = outs.filter((e) => e.sourceItemId === outItem);
        if (outEdges.length === 0) continue;
        const demanded = outEdges.reduce((s, e) => s + (edgeDemand.get(e.id) ?? 0), 0);
        if (demanded > EPS) {
          hasDownstreamPull = true;
          // If this is a byproduct whose primary output is already driving the machine,
          // taking max ensures both demands are met unless primary is absent.
          desiredMachines = Math.max(desiredMachines, demanded / unitOut);
        }
      }

      // If no downstream pull exists (e.g. generator or leaf node or push-from-pinned-miner):
      // check if upstream pushes supply!
      if (!hasDownstreamPull) {
        let minPushMachines = Number.POSITIVE_INFINITY;
        let hasUpstreamPush = false;
        for (const [inItem, unitIn] of Object.entries(sr.inPerMin)) {
          if (unitIn <= EPS) continue;
          const matchingIns = ins.filter((e) => e.targetItemId === inItem);
          if (matchingIns.length === 0) continue;
          const supplied = matchingIns.reduce((s, e) => s + (edgeSupply.get(e.id) ?? 0), 0);
          if (supplied > EPS) {
            hasUpstreamPush = true;
            minPushMachines = Math.min(minPushMachines, supplied / unitIn);
          }
        }
        if (hasUpstreamPush && Number.isFinite(minPushMachines)) {
          desiredMachines = minPushMachines;
        } else if (outs.length === 0) {
          desiredMachines = 1;
        } else {
          // Connected downstream but downstream currently demands 0 (e.g., all unpinned chain)
          // Keep 0 until leaf settles to 1, then pull propagates next iteration
          desiredMachines = 0;
        }
      }

      const prev = machineCount.get(n.id) ?? 0;
      // Mild damping prevents oscillation on tight recycling loops
      const next = iter > 12 ? prev * 0.4 + desiredMachines * 0.6 : desiredMachines;
      maxDelta = Math.max(maxDelta, Math.abs(next - prev));
      machineCount.set(n.id, next);
    }

    // 3. Forward Supply Propagation (from producers / inputs / splitters / mergers -> outgoing edges)
    for (const n of nodes) {
      const outs = outEdgesByNode.get(n.id) ?? [];
      if (outs.length === 0) continue;

      if (n.kind === 'recipe') {
        const sr = singleRates.get(n.id);
        if (!sr) continue;
        const count = machineCount.get(n.id) ?? 0;

        for (const [outItem, unitOut] of Object.entries(sr.outPerMin)) {
          const available = unitOut * count;
          const matchingOuts = outs.filter((e) => e.sourceItemId === outItem);
          if (matchingOuts.length === 0) continue;
          distributeSupplyAcrossOutputs(matchingOuts, available, 'demand', edgeDemand, edgeSupply);
        }
      } else if (n.kind === 'input') {
        const available = Math.max(0, n.ratePerMin ?? 60);
        distributeSupplyAcrossOutputs(outs, available, 'demand', edgeDemand, edgeSupply);
      } else if (n.kind === 'merger') {
        const ins = inEdgesByNode.get(n.id) ?? [];
        const available = ins.reduce((s, e) => s + (edgeSupply.get(e.id) ?? 0), 0);
        distributeSupplyAcrossOutputs(outs, available, 'demand', edgeDemand, edgeSupply);
      } else if (n.kind === 'splitter') {
        const ins = inEdgesByNode.get(n.id) ?? [];
        const available = ins.reduce((s, e) => s + (edgeSupply.get(e.id) ?? 0), 0);
        const mode = n.splitterMode ?? 'demand';
        distributeSupplyAcrossOutputs(outs, available, mode, edgeDemand, edgeSupply);
      }
    }

    if (iter > 4 && maxDelta < 1e-6) break;
  }

  // --- Phase 2: Build Final Solved Telemetry ---
  const solvedEdges: Record<string, SolvedEdge> = {};
  const maxSolidSpec = getMaxBeltSpec(settings.maxBeltTier, false);
  const maxFluidSpec = getMaxBeltSpec(settings.maxPipeTier, true);

  for (const e of edges) {
    const itemId = e.sourceItemId || e.targetItemId;
    const item = ITEMS[itemId];
    const isFluid = Boolean(item?.isFluid);
    const flowRate = Math.max(0, edgeSupply.get(e.id) ?? 0);
    const minSpec = getBeltForRate(flowRate, isFluid);
    const maxSpec = isFluid ? maxFluidSpec : maxSolidSpec;
    const overLimit = flowRate > maxSpec.ratePerMin + EPS;
    const loadRatioAtMax = maxSpec.ratePerMin > 0 ? flowRate / maxSpec.ratePerMin : 0;
    const beltCountAtMax = flowRate > EPS ? Math.ceil((flowRate - EPS) / maxSpec.ratePerMin) : 0;

    let status: SolvedEdge['status'] = 'ok';
    if (flowRate <= EPS) status = 'idle';
    else if (overLimit) status = 'overlimit';
    else if (loadRatioAtMax > 0.92) status = 'warning';

    solvedEdges[e.id] = {
      edgeId: e.id,
      itemId,
      isFluid,
      flowRate,
      minTierName: minSpec.name,
      minTierRate: minSpec.ratePerMin,
      beltCountAtMax,
      loadRatioAtMax,
      overLimit,
      status,
    };
  }

  const solvedNodes: Record<string, SolvedNode> = {};
  const buildingMap = new Map<string, BuildingSummaryItem>();
  const rawInputTotals = new Map<string, number>();
  const netOutputTotals = new Map<string, number>();
  const unhandledByproductsMap = new Map<string, number>();
  const missingInputsMap = new Map<string, number>();

  let totalPowerConsumedMW = 0;
  let basePowerGeneratedMW = 0;
  let powerBoostPct = 0;
  let totalMachines = 0;
  let totalBuiltNodes = 0;
  let totalPowerShards = 0;
  let totalSomersloops = 0;

  for (const n of nodes) {
    if (n.built) totalBuiltNodes++;
    const ins = inEdgesByNode.get(n.id) ?? [];
    const outs = outEdgesByNode.get(n.id) ?? [];

    if (n.kind === 'recipe' && n.recipeId && RECIPES[n.recipeId]) {
      const recipe = RECIPES[n.recipeId];
      const machineId = n.machineId ?? recipe.producers[0];
      const machine = MACHINES[machineId];
      const sr = singleRates.get(n.id)!;
      const count = Math.max(0, machineCount.get(n.id) ?? 0);
      const ceilCount = count > EPS ? Math.ceil(count - EPS) : 0;
      const clock = machine?.noOverclock
        ? 100
        : Math.max(1, Math.min(250, n.clockSpeed || 100));
      const shardsPerMachine = clock > 100 ? Math.ceil((clock - 100) / 50) : 0;
      const shards = shardsPerMachine * ceilCount;
      const clampedSloops =
        machine && machine.somersloopSlots > 0
          ? Math.max(0, Math.min(machine.somersloopSlots, Math.round(n.somersloops || 0)))
          : 0;
      const buildSloops = (machine?.buildSomersloops ?? 0) * ceilCount;
      const sloopsTotal = clampedSloops * ceilCount + buildSloops;
      const powerMW = sr.powerPerMachineMW * count;

      if (powerMW >= 0) totalPowerConsumedMW += powerMW;
      else basePowerGeneratedMW += -powerMW;

      if (recipe.powerBoostPct && count > EPS) {
        powerBoostPct += recipe.powerBoostPct * count;
      }

      totalMachines += ceilCount;
      totalPowerShards += shards;
      totalSomersloops += sloopsTotal;

      // Building shopping list aggregation
      if (machine) {
        const existing = buildingMap.get(machineId);
        if (existing) {
          existing.exactCount += count;
          existing.wholeCount += ceilCount;
          if (n.built) existing.builtCount += ceilCount;
          existing.powerMW += powerMW;
          existing.shards += shards;
          existing.somersloops += sloopsTotal;
        } else {
          buildingMap.set(machineId, {
            machineId,
            name: machine.name,
            icon: machine.icon,
            exactCount: count,
            wholeCount: ceilCount,
            builtCount: n.built ? ceilCount : 0,
            powerMW,
            shards,
            somersloops: sloopsTotal,
          });
        }
      }

      // Evaluate input ports
      const solvedIns: Record<string, SolvedPort> = {};
      let minEff = 1;
      let isBottlenecked = false;

      for (const [itemId, unitIn] of Object.entries(sr.inPerMin)) {
        const required = unitIn * count;
        const matching = ins.filter((e) => e.targetItemId === itemId);
        const actual = matching.reduce((s, e) => s + (edgeSupply.get(e.id) ?? 0), 0);
        let status: PortStatus = 'balanced';
        if (matching.length === 0) {
          status = 'disconnected';
          if (required > EPS) {
            isBottlenecked = true;
            missingInputsMap.set(itemId, (missingInputsMap.get(itemId) ?? 0) + required);
          }
        } else if (actual + 0.05 < required) {
          status = 'starved';
          isBottlenecked = true;
          if (required > EPS) minEff = Math.min(minEff, actual / required);
          missingInputsMap.set(
            itemId,
            (missingInputsMap.get(itemId) ?? 0) + (required - actual),
          );
        } else if (actual > required + 0.05) {
          status = 'surplus';
        }
        solvedIns[itemId] = {
          itemId,
          required,
          actual,
          status,
          connectedEdgeIds: matching.map((e) => e.id),
        };
      }

      // Evaluate output ports
      const solvedOuts: Record<string, SolvedPort> = {};
      let hasSurplus = false;

      for (const [itemId, unitOut] of Object.entries(sr.outPerMin)) {
        const produced = unitOut * count;
        const matching = outs.filter((e) => e.sourceItemId === itemId);
        const consumed = matching.reduce((s, e) => s + (edgeDemand.get(e.id) ?? 0), 0);
        const sent = matching.reduce((s, e) => s + (edgeSupply.get(e.id) ?? 0), 0);

        let status: PortStatus = 'balanced';
        if (matching.length === 0) {
          status = 'disconnected';
          if (produced > EPS) {
            if (itemId === sr.primaryOutItemId || outs.length === 0) {
              netOutputTotals.set(itemId, (netOutputTotals.get(itemId) ?? 0) + produced);
            } else {
              // Secondary unconnected byproduct!
              hasSurplus = true;
              unhandledByproductsMap.set(
                itemId,
                (unhandledByproductsMap.get(itemId) ?? 0) + produced,
              );
            }
          }
        } else if (produced > consumed + 0.05 && sent < produced - 0.05) {
          status = 'surplus';
          hasSurplus = true;
          netOutputTotals.set(
            itemId,
            (netOutputTotals.get(itemId) ?? 0) + (produced - sent),
          );
        } else if (produced + 0.05 < consumed) {
          status = 'starved';
        }

        // Track raw resource extraction
        if (recipe.isExtractor && produced > EPS) {
          rawInputTotals.set(itemId, (rawInputTotals.get(itemId) ?? 0) + produced);
        }

        solvedOuts[itemId] = {
          itemId,
          required: produced,
          actual: sent,
          status,
          connectedEdgeIds: matching.map((e) => e.id),
        };
      }

      solvedNodes[n.id] = {
        nodeId: n.id,
        machines: count,
        machinesCeil: ceilCount,
        effectiveClock: clock,
        powerMW,
        powerShards: shards,
        somersloopsTotal: sloopsTotal,
        inputs: solvedIns,
        outputs: solvedOuts,
        efficiency: minEff,
        isBottlenecked,
        hasSurplus,
      };
    } else {
      // Splitter, Merger, Input, Sink
      const itemId = resolveLogisticsItemId(n, edges) ?? '';
      const totalIn = ins.reduce((s, e) => s + (edgeSupply.get(e.id) ?? 0), 0);
      const totalOut = outs.reduce((s, e) => s + (edgeSupply.get(e.id) ?? 0), 0);
      const totalOutDemand = outs.reduce((s, e) => s + (edgeDemand.get(e.id) ?? 0), 0);

      if (n.kind === 'input' && itemId) {
        const rate = Math.max(0, n.ratePerMin ?? 60);
        rawInputTotals.set(itemId, (rawInputTotals.get(itemId) ?? 0) + rate);
      } else if (n.kind === 'sink' && itemId && totalIn > EPS) {
        netOutputTotals.set(itemId, (netOutputTotals.get(itemId) ?? 0) + totalIn);
      }

      const solvedIns: Record<string, SolvedPort> = {};
      const solvedOuts: Record<string, SolvedPort> = {};

      if (itemId && n.kind !== 'input') {
        solvedIns[itemId] = {
          itemId,
          required: n.kind === 'sink' ? totalIn : totalOutDemand,
          actual: totalIn,
          status:
            ins.length === 0
              ? 'disconnected'
              : totalIn + 0.05 < totalOutDemand
                ? 'starved'
                : 'balanced',
          connectedEdgeIds: ins.map((e) => e.id),
        };
      }
      if (itemId && n.kind !== 'sink') {
        const avail = n.kind === 'input' ? Math.max(0, n.ratePerMin ?? 60) : totalIn;
        solvedOuts[itemId] = {
          itemId,
          required: avail,
          actual: totalOut,
          status:
            outs.length === 0
              ? 'disconnected'
              : avail > totalOutDemand + 0.05
                ? 'surplus'
                : 'balanced',
          connectedEdgeIds: outs.map((e) => e.id),
        };
      }

      solvedNodes[n.id] = {
        nodeId: n.id,
        machines: 1,
        machinesCeil: 1,
        effectiveClock: 100,
        powerMW: 0,
        powerShards: 0,
        somersloopsTotal: 0,
        inputs: solvedIns,
        outputs: solvedOuts,
        efficiency: 1,
        isBottlenecked:
          n.kind !== 'input' && n.kind !== 'sink' && totalIn + 0.05 < totalOutDemand,
        hasSurplus: n.kind !== 'sink' && totalIn > totalOutDemand + 0.05,
      };
    }
  }

  const toSummary = (map: Map<string, number>): ResourceFlowSummary[] =>
    Array.from(map.entries())
      .filter(([, rate]) => rate > EPS)
      .map(([itemId, ratePerMin]) => {
        const it = ITEMS[itemId];
        return {
          itemId,
          name: it?.name ?? itemId,
          icon: it?.icon ?? itemId,
          isFluid: Boolean(it?.isFluid),
          ratePerMin,
        };
      })
      .sort((a, b) => b.ratePerMin - a.ratePerMin);

  const powerBoostMW = basePowerGeneratedMW * powerBoostPct;
  const totalPowerGeneratedMW = basePowerGeneratedMW + powerBoostMW;

  return {
    nodes: solvedNodes,
    edges: solvedEdges,
    totalPowerConsumedMW,
    basePowerGeneratedMW,
    powerBoostPct,
    powerBoostMW,
    totalPowerGeneratedMW,
    netPowerMW: totalPowerGeneratedMW - totalPowerConsumedMW,
    totalMachines,
    totalBuiltNodes,
    totalNodes: nodes.length,
    totalPowerShards,
    totalSomersloops,
    buildings: Array.from(buildingMap.values()).sort((a, b) => b.wholeCount - a.wholeCount),
    rawInputs: toSummary(rawInputTotals),
    netOutputs: toSummary(netOutputTotals),
    unhandledByproducts: toSummary(unhandledByproductsMap),
    missingInputs: toSummary(missingInputsMap),
  };
}

/**
 * Smartly distributes an item's total demand across multiple incoming edges:
 * 1. First absorbs supply from pinned sources or byproduct loops (e.g., recycled water!)
 * 2. Splits remaining unmet demand across unpinned auto-scaled sources!
 */
function distributeDemandAcrossInputs(
  inEdges: FactoryEdge[],
  totalReq: number,
  nodeMap: Map<string, FactoryNode>,
  isPinned: Set<string>,
  getNodeOutRate: (nodeId: string, itemId: string) => number,
  edgeDemand: Map<string, number>,
  outEdgesByNode: Map<string, FactoryEdge[]>,
) {
  if (inEdges.length === 1) {
    edgeDemand.set(inEdges[0].id, totalReq);
    return;
  }

  const fixedEdges: Array<{ edge: FactoryEdge; available: number }> = [];
  const flexibleEdges: FactoryEdge[] = [];

  for (const e of inEdges) {
    const src = nodeMap.get(e.sourceNodeId);
    if (!src) continue;
    const isByproduct =
      src.kind === 'recipe' &&
      src.recipeId &&
      RECIPES[src.recipeId] &&
      getPrimaryOutputItemId(RECIPES[src.recipeId]) !== e.sourceItemId;

    if (isPinned.has(src.id) || isByproduct) {
      const totalSrcOut = getNodeOutRate(src.id, e.sourceItemId);
      const siblingCount = Math.max(
        1,
        (outEdgesByNode.get(src.id) ?? []).filter((o) => o.sourceItemId === e.sourceItemId)
          .length,
      );
      fixedEdges.push({ edge: e, available: totalSrcOut / siblingCount });
    } else {
      flexibleEdges.push(e);
    }
  }

  let remaining = totalReq;
  for (const fe of fixedEdges) {
    const take = Math.min(remaining, fe.available);
    edgeDemand.set(fe.edge.id, take);
    remaining = Math.max(0, remaining - take);
  }

  if (flexibleEdges.length > 0) {
    const each = remaining / flexibleEdges.length;
    for (const e of flexibleEdges) {
      edgeDemand.set(e.id, each);
    }
  } else if (remaining > EPS && fixedEdges.length > 0) {
    // All inputs are pinned/fixed; still record unmet share proportionally so bottlenecks show up
    const extraEach = remaining / fixedEdges.length;
    for (const fe of fixedEdges) {
      edgeDemand.set(fe.edge.id, (edgeDemand.get(fe.edge.id) ?? 0) + extraEach);
    }
  }
}

/**
 * Distributes available output flow across outgoing edges based on splitter mode.
 */
function distributeSupplyAcrossOutputs(
  outEdges: FactoryEdge[],
  available: number,
  mode: 'demand' | 'even' | 'priority',
  edgeDemand: Map<string, number>,
  edgeSupply: Map<string, number>,
) {
  if (outEdges.length === 1) {
    edgeSupply.set(outEdges[0].id, available);
    return;
  }

  if (mode === 'even') {
    const each = available / outEdges.length;
    for (const e of outEdges) edgeSupply.set(e.id, each);
    return;
  }

  if (mode === 'priority') {
    const sorted = [...outEdges].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    let rem = available;
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      const dem = edgeDemand.get(e.id) ?? 0;
      if (i === sorted.length - 1) {
        // Last priority branch gets any remaining overflow
        edgeSupply.set(e.id, rem);
        rem = 0;
      } else {
        const give = Math.min(rem, dem > EPS ? dem : rem);
        edgeSupply.set(e.id, give);
        rem = Math.max(0, rem - give);
      }
    }
    return;
  }

  // 'demand' mode (default smart/manifold distribution)
  const demands = outEdges.map((e) => Math.max(0, edgeDemand.get(e.id) ?? 0));
  const sumDemand = demands.reduce((a, b) => a + b, 0);

  if (sumDemand <= EPS) {
    const each = available / outEdges.length;
    for (const e of outEdges) edgeSupply.set(e.id, each);
    return;
  }

  if (available >= sumDemand) {
    // Enough to satisfy every downstream branch exactly
    for (let i = 0; i < outEdges.length; i++) {
      edgeSupply.set(outEdges[i].id, demands[i]);
    }
  } else {
    // Scarce supply: split proportionally to demand
    const ratio = available / sumDemand;
    for (let i = 0; i < outEdges.length; i++) {
      edgeSupply.set(outEdges[i].id, demands[i] * ratio);
    }
  }
}
