import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from './components/Canvas';
import { ContextSpawnMenu, type PendingSpawnState } from './components/ContextSpawnMenu';
import { InspectorPanel, type InspectorTab } from './components/InspectorPanel';
import { getNodeHeightEstimate, getNodeWidth } from './components/portGeometry';
import { QuickPalette, type PaletteMode } from './components/QuickPalette';
import { TopBar } from './components/TopBar';
import { formatMW, getDefaultMachineForRecipe, ITEMS, RECIPES } from './data/catalog';
import { createInitialPlan, type FactoryTemplate } from './data/presets';
import {
  autoLayoutNodes,
  buildPowerPlant,
  buildProductionChain,
  createId,
  createRecipeNode,
  expandMissingInputsForNode,
  splitAllOverloadedEdges,
  splitOverloadedEdge,
  type PowerPlantPlanOptions,
} from './engine/autoPlanner';
import { solveFactory } from './engine/solver';
import type {
  FactoryEdge,
  FactoryNode,
  FactoryPlan,
  NodeKind,
  Outpost,
  PlanSettings,
  ViewportState,
} from './engine/types';

const STORAGE_KEY = 'satisplanner_factory_v1_2';
const LEGACY_STORAGE_KEY = 'satisplan_factory_v1_2';
const OUTPOST_ACCENTS = ['#E27620', '#4D98CC', '#4EA36D', '#C89A3B', '#B083CC', '#D45450'];

function normalizePlan(parsed: FactoryPlan): FactoryPlan {
  return {
    ...parsed,
    settings: {
      ...parsed.settings,
      theme: parsed.settings?.theme ?? 'ficsit',
    },
  };
}

function loadSavedPlan(): FactoryPlan {
  // 1. Check URL hash share payload first
  try {
    const hash = window.location.hash;
    if (hash.startsWith('#plan=')) {
      const encoded = hash.slice(6);
      const decoded = decodeURIComponent(escape(atob(encoded)));
      const parsed = JSON.parse(decoded) as FactoryPlan;
      if (parsed && Array.isArray(parsed.outposts) && parsed.outposts.length > 0) {
        return normalizePlan(parsed);
      }
    }
  } catch {
    // Ignore malformed hash
  }

  // 2. Check localStorage
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as FactoryPlan;
      if (parsed && Array.isArray(parsed.outposts) && parsed.outposts.length > 0) {
        return normalizePlan(parsed);
      }
    }
  } catch {
    // Ignore storage parse error
  }

  return createInitialPlan();
}

export function App() {
  const [plan, setPlan] = useState<FactoryPlan>(loadSavedPlan);
  const [historyPast, setHistoryPast] = useState<FactoryPlan[]>([]);
  const [historyFuture, setHistoryFuture] = useState<FactoryPlan[]>([]);

  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('summary');

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>('chain');
  const [spawnAnchorWorld, setSpawnAnchorWorld] = useState<{ x: number; y: number } | null>(null);
  const [pendingContextSpawn, setPendingContextSpawn] = useState<PendingSpawnState | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  // Sync active theme attribute onto root html element
  useEffect(() => {
    document.documentElement.dataset.theme = plan.settings.theme ?? 'ficsit';
  }, [plan.settings.theme]);

  // Persist to localStorage automatically
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
    } catch {
      // Ignore quota errors
    }
  }, [plan]);

  const activeOutpost = useMemo<Outpost>(
    () =>
      plan.outposts.find((o) => o.id === plan.activeOutpostId) ?? plan.outposts[0],
    [plan],
  );

  // Run live constraint & flow solver
  const solved = useMemo(
    () => solveFactory(activeOutpost.nodes, activeOutpost.edges, plan.settings),
    [activeOutpost.nodes, activeOutpost.edges, plan.settings],
  );

  const selectedNode = useMemo(() => {
    if (selectedNodeIds.length !== 1) return null;
    return activeOutpost.nodes.find((n) => n.id === selectedNodeIds[0]) ?? null;
  }, [activeOutpost.nodes, selectedNodeIds]);

  const selectedEdge = useMemo(() => {
    if (!selectedEdgeId) return null;
    return activeOutpost.edges.find((e) => e.id === selectedEdgeId) ?? null;
  }, [activeOutpost.edges, selectedEdgeId]);

  // Auto-switch inspector tab to Inspect when selecting a node
  const handleSelectNodes = useCallback((ids: string[]) => {
    setSelectedNodeIds(ids);
    if (ids.length === 1) {
      setInspectorTab('inspect');
    }
  }, []);

  const handleSelectEdge = useCallback((edgeId: string | null) => {
    setSelectedEdgeId(edgeId);
    if (edgeId) {
      setInspectorTab('inspect');
    }
  }, []);

  // Push history helper for undoable state mutations
  const mutatePlan = useCallback(
    (updater: (prev: FactoryPlan) => FactoryPlan, recordHistory = true) => {
      setPlan((prev) => {
        const next = updater(prev);
        if (next === prev) return prev;
        if (recordHistory) {
          setHistoryPast((h) => [...h.slice(-49), prev]);
          setHistoryFuture([]);
        }
        return next;
      });
    },
    [],
  );

  const mutateActiveOutpost = useCallback(
    (updater: (outpost: Outpost, settings: PlanSettings) => Outpost, recordHistory = true) => {
      mutatePlan(
        (prev) => ({
          ...prev,
          outposts: prev.outposts.map((o) =>
            o.id === prev.activeOutpostId ? updater(o, prev.settings) : o,
          ),
        }),
        recordHistory,
      );
    },
    [mutatePlan],
  );

  const handleUndo = useCallback(() => {
    setHistoryPast((past) => {
      if (past.length === 0) return past;
      const previous = past[past.length - 1];
      setPlan((cur) => {
        setHistoryFuture((f) => [cur, ...f.slice(0, 49)]);
        return previous;
      });
      return past.slice(0, -1);
    });
  }, []);

  const handleRedo = useCallback(() => {
    setHistoryFuture((future) => {
      if (future.length === 0) return future;
      const next = future[0];
      setPlan((cur) => {
        setHistoryPast((p) => [...p.slice(-49), cur]);
        return next;
      });
      return future.slice(1);
    });
  }, []);

  // Fit viewport cleanly around a list of nodes
  const computeFitViewport = useCallback(
    (nodes: FactoryNode[], edges: FactoryEdge[]): ViewportState => {
      const rect = stageRef.current?.getBoundingClientRect();
      const viewW = rect?.width || window.innerWidth - (inspectorOpen ? 332 : 0);
      const viewH = rect?.height || window.innerHeight - 50;

      if (nodes.length === 0) {
        return { x: viewW / 2, y: viewH / 2, zoom: 1 };
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of nodes) {
        const w = getNodeWidth(n);
        const h = getNodeHeightEstimate(n, edges);
        if (n.x < minX) minX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.x + w > maxX) maxX = n.x + w;
        if (n.y + h > maxY) maxY = n.y + h;
      }
      const pad = 72;
      const contentW = Math.max(100, maxX - minX);
      const contentH = Math.max(100, maxY - minY);
      const zoom = Math.min(
        1.15,
        Math.max(0.28, Math.min((viewW - pad * 2) / contentW, (viewH - pad * 2) / contentH)),
      );
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      return {
        x: Math.round(viewW / 2 - centerX * zoom),
        y: Math.round(viewH / 2 - centerY * zoom),
        zoom,
      };
    },
    [inspectorOpen],
  );

  const handleFitView = useCallback(() => {
    mutateActiveOutpost(
      (o) => ({ ...o, viewport: computeFitViewport(o.nodes, o.edges) }),
      false,
    );
  }, [mutateActiveOutpost, computeFitViewport]);

  // Fit view cleanly once on initial mount
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      handleFitView();
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Node & Edge Mutations ---

  const handleViewportChange = useCallback(
    (vp: ViewportState) => {
      mutateActiveOutpost((o) => ({ ...o, viewport: vp }), false);
    },
    [mutateActiveOutpost],
  );

  const handleMoveNodes = useCallback(
    (updates: Array<{ id: string; x: number; y: number }>, commitHistory: boolean) => {
      const map = new Map(updates.map((u) => [u.id, u]));
      mutateActiveOutpost(
        (o) => ({
          ...o,
          nodes: o.nodes.map((n) => {
            const u = map.get(n.id);
            return u ? { ...n, x: u.x, y: u.y } : n;
          }),
        }),
        commitHistory,
      );
    },
    [mutateActiveOutpost],
  );

  const handleUpdateNode = useCallback(
    (nodeId: string, patch: Partial<FactoryNode>) => {
      mutateActiveOutpost((o) => ({
        ...o,
        nodes: o.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
      }));
    },
    [mutateActiveOutpost],
  );

  const handleSwapNodeRecipe = useCallback(
    (nodeId: string, newRecipeId: string) => {
      const newRecipe = RECIPES[newRecipeId];
      if (!newRecipe) return;
      mutateActiveOutpost((o, settings) => {
        const nextNodes = o.nodes.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                recipeId: newRecipeId,
                machineId: getDefaultMachineForRecipe(newRecipe, settings.defaultMinerId),
                somersloops: 0,
              }
            : n,
        );
        // Preserve matching connected edges; prune obsolete ports
        const nextEdges = o.edges.filter((e) => {
          if (e.targetNodeId === nodeId && !(e.targetItemId in newRecipe.in)) return false;
          if (e.sourceNodeId === nodeId && !(e.sourceItemId in newRecipe.out)) return false;
          return true;
        });
        return { ...o, nodes: nextNodes, edges: nextEdges };
      });
      showToast(`Swapped to ${newRecipe.name}`);
    },
    [mutateActiveOutpost, showToast],
  );

  const handleConnectPorts = useCallback(
    (
      sourceNodeId: string,
      sourceItemId: string,
      targetNodeId: string,
      targetItemId: string,
    ) => {
      if (sourceNodeId === targetNodeId) return;
      mutateActiveOutpost((o) => {
        const exists = o.edges.some(
          (e) =>
            e.sourceNodeId === sourceNodeId &&
            e.sourceItemId === sourceItemId &&
            e.targetNodeId === targetNodeId &&
            e.targetItemId === targetItemId,
        );
        if (exists) return o;
        // Also infer itemId on untyped logistics nodes
        const nextNodes = o.nodes.map((n) => {
          if ((n.id === sourceNodeId || n.id === targetNodeId) && n.kind !== 'recipe' && !n.itemId) {
            return { ...n, itemId: sourceItemId };
          }
          return n;
        });
        const newEdge: FactoryEdge = {
          id: createId('e'),
          sourceNodeId,
          sourceItemId,
          targetNodeId,
          targetItemId,
        };
        return { ...o, nodes: nextNodes, edges: [...o.edges, newEdge] };
      });
    },
    [mutateActiveOutpost],
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      mutateActiveOutpost((o) => ({
        ...o,
        edges: o.edges.filter((e) => e.id !== edgeId),
      }));
      setSelectedEdgeId((cur) => (cur === edgeId ? null : cur));
    },
    [mutateActiveOutpost],
  );

  const handleSpliceEdge = useCallback(
    (edgeId: string, kind: 'splitter' | 'merger') => {
      let insertedLabel = kind === 'splitter' ? 'Splitter' : 'Merger';
      mutateActiveOutpost((o) => {
        const edge = o.edges.find((e) => e.id === edgeId);
        if (!edge) return o;
        const src = o.nodes.find((n) => n.id === edge.sourceNodeId);
        const dst = o.nodes.find((n) => n.id === edge.targetNodeId);
        if (!src || !dst) return o;
        const isFluid = Boolean(ITEMS[edge.sourceItemId]?.isFluid);
        const effectiveKind: 'splitter' | 'merger' = isFluid ? 'merger' : kind;
        insertedLabel = isFluid
          ? 'Pipe Junction'
          : effectiveKind === 'splitter'
            ? 'Splitter'
            : 'Merger';
        const midX = Math.round(((src.x + dst.x) / 2) / 24) * 24;
        const midY = Math.round(((src.y + dst.y) / 2) / 24) * 24;
        const midNode: FactoryNode = {
          id: createId('n'),
          kind: effectiveKind,
          x: midX,
          y: midY,
          clockSpeed: 100,
          somersloops: 0,
          purity: 'normal',
          pinMode: 'auto',
          pinnedValue: 1,
          itemId: edge.sourceItemId,
          splitterMode: effectiveKind === 'splitter' ? 'demand' : undefined,
          label: isFluid ? 'Pipe Junction' : undefined,
          built: false,
        };
        const e1: FactoryEdge = {
          id: createId('e'),
          sourceNodeId: edge.sourceNodeId,
          sourceItemId: edge.sourceItemId,
          targetNodeId: midNode.id,
          targetItemId: edge.sourceItemId,
        };
        const e2: FactoryEdge = {
          id: createId('e'),
          sourceNodeId: midNode.id,
          sourceItemId: edge.sourceItemId,
          targetNodeId: edge.targetNodeId,
          targetItemId: edge.targetItemId,
        };
        return {
          ...o,
          nodes: [...o.nodes, midNode],
          edges: [...o.edges.filter((e) => e.id !== edgeId), e1, e2],
        };
      });
      setSelectedEdgeId(null);
      showToast(`Inserted ${insertedLabel}`);
    },
    [mutateActiveOutpost, showToast],
  );

  const handleSplitOverloadedEdge = useCallback(
    (edgeId: string) => {
      let splitCount = 1;
      let createdIds: string[] = [];
      let isFluid = false;
      mutateActiveOutpost((o, settings) => {
        const edge = o.edges.find((e) => e.id === edgeId);
        if (!edge) return o;
        isFluid = Boolean(ITEMS[edge.sourceItemId]?.isFluid);
        const res = splitOverloadedEdge(o.nodes, o.edges, edgeId, settings);
        if (res.splitCount <= 1) return o;
        splitCount = res.splitCount;
        createdIds = res.newNodeIds;
        return { ...o, nodes: res.nodes, edges: res.edges };
      });
      if (splitCount > 1) {
        setSelectedEdgeId(null);
        setSelectedNodeIds(createdIds);
        showToast(`Split into ${splitCount} parallel ${isFluid ? 'pipes' : 'belts'}`);
      }
    },
    [mutateActiveOutpost, showToast],
  );

  const handleSplitAllOverloaded = useCallback(() => {
    let splits = 0;
    mutateActiveOutpost((o, settings) => {
      const res = splitAllOverloadedEdges(o.nodes, o.edges, settings);
      if (res.splitsPerformed === 0) return o;
      splits = res.splitsPerformed;
      return {
        ...o,
        nodes: res.nodes,
        edges: res.edges,
        viewport: computeFitViewport(res.nodes, res.edges),
      };
    });
    if (splits > 0) {
      setSelectedEdgeId(null);
      setSelectedNodeIds([]);
      showToast(`Split ${splits} overloaded ${splits === 1 ? 'line' : 'lines'}`);
    } else {
      showToast('No overloaded pipes or belts found');
    }
  }, [mutateActiveOutpost, computeFitViewport, showToast]);

  const handleDeleteNodes = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const set = new Set(ids);
      mutateActiveOutpost((o) => ({
        ...o,
        nodes: o.nodes.filter((n) => !set.has(n.id)),
        edges: o.edges.filter(
          (e) => !set.has(e.sourceNodeId) && !set.has(e.targetNodeId),
        ),
      }));
      setSelectedNodeIds((cur) => cur.filter((id) => !set.has(id)));
    },
    [mutateActiveOutpost],
  );

  const handleDuplicateNodes = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const newIds: string[] = [];
      mutateActiveOutpost((o) => {
        const copies: FactoryNode[] = [];
        const idMap = new Map<string, string>();
        for (const id of ids) {
          const orig = o.nodes.find((n) => n.id === id);
          if (!orig) continue;
          const copyId = createId('n');
          idMap.set(orig.id, copyId);
          newIds.push(copyId);
          copies.push({
            ...orig,
            id: copyId,
            x: orig.x + 48,
            y: orig.y + 48,
            built: false,
          });
        }
        const copiedEdges: FactoryEdge[] = o.edges
          .filter((e) => idMap.has(e.sourceNodeId) && idMap.has(e.targetNodeId))
          .map((e) => ({
            ...e,
            id: createId('e'),
            sourceNodeId: idMap.get(e.sourceNodeId)!,
            targetNodeId: idMap.get(e.targetNodeId)!,
          }));
        return {
          ...o,
          nodes: [...o.nodes, ...copies],
          edges: [...o.edges, ...copiedEdges],
        };
      });
      setSelectedNodeIds(newIds);
    },
    [mutateActiveOutpost],
  );

  const handleExpandInputs = useCallback(
    (nodeId: string, recursive = false) => {
      let spawned = 0;
      mutateActiveOutpost((o, settings) => {
        const { addedNodes, addedEdges } = expandMissingInputsForNode(
          o.nodes,
          o.edges,
          nodeId,
          settings,
          recursive,
        );
        spawned = addedNodes.length;
        if (spawned === 0) return o;
        const nextNodes = recursive
          ? autoLayoutNodes([...o.nodes, ...addedNodes], [...o.edges, ...addedEdges])
          : [...o.nodes, ...addedNodes];
        return {
          ...o,
          nodes: nextNodes,
          edges: [...o.edges, ...addedEdges],
        };
      });
      if (spawned > 0) {
        showToast(`Spawned ${spawned} upstream ${spawned === 1 ? 'node' : 'nodes'}`);
      } else {
        showToast('All inputs are already connected');
      }
    },
    [mutateActiveOutpost, showToast],
  );

  const handleSnapWholeMachines = useCallback(
    (nodeId: string) => {
      const sn = solved.nodes[nodeId];
      const node = activeOutpost.nodes.find((n) => n.id === nodeId);
      if (!sn || !node || sn.machines <= 0.001) return;
      const whole = Math.max(1, Math.ceil(sn.machines - 1e-4));
      const newClock = Math.max(
        1,
        Math.min(250, Number(((sn.machines / whole) * node.clockSpeed).toFixed(2))),
      );
      const patch: Partial<FactoryNode> = { clockSpeed: newClock };
      if (node.pinMode === 'machines') {
        patch.pinnedValue = whole;
      }
      handleUpdateNode(nodeId, patch);
      showToast(`Snapped to ${whole}× machines @ ${newClock}% clock`);
    },
    [solved.nodes, activeOutpost.nodes, handleUpdateNode, showToast],
  );

  const handleAutoLayout = useCallback(() => {
    mutateActiveOutpost((o) => {
      const laidOut = autoLayoutNodes(o.nodes, o.edges);
      return {
        ...o,
        nodes: laidOut,
        viewport: computeFitViewport(laidOut, o.edges),
      };
    });
    showToast('Layout updated');
  }, [mutateActiveOutpost, computeFitViewport, showToast]);

  // --- Quick Palette & Context Drag-to-Spawn Actions ---

  const getCenterWorld = useCallback(() => {
    if (spawnAnchorWorld) return spawnAnchorWorld;
    const rect = stageRef.current?.getBoundingClientRect();
    const w = rect?.width ?? 900;
    const h = rect?.height ?? 600;
    const vp = activeOutpost.viewport;
    return {
      x: Math.round(((w / 2 - vp.x) / vp.zoom - 130) / 24) * 24,
      y: Math.round(((h / 2 - vp.y) / vp.zoom - 70) / 24) * 24,
    };
  }, [spawnAnchorWorld, activeOutpost.viewport]);

  const handleAutoBuildChain = useCallback(
    (itemId: string, ratePerMin: number, splitOverloaded = true) => {
      mutateActiveOutpost((o, settings) => {
        const built = buildProductionChain(
          itemId,
          ratePerMin,
          settings,
          undefined,
          splitOverloaded,
        );
        const vp = computeFitViewport(built.nodes, built.edges);
        return {
          ...o,
          nodes: built.nodes,
          edges: built.edges,
          viewport: vp,
        };
      });
      setSelectedNodeIds([]);
      setSelectedEdgeId(null);
      setInspectorTab('summary');
      showToast(`Built ${ratePerMin}/min ${ITEMS[itemId]?.name ?? itemId} chain`);
    },
    [mutateActiveOutpost, computeFitViewport, showToast],
  );

  const handleAutoBuildPower = useCallback(
    (options: PowerPlantPlanOptions) => {
      const genRec = RECIPES[options.generatorRecipeId];
      mutateActiveOutpost((o, settings) => {
        const built = buildPowerPlant(options, settings);
        const vp = computeFitViewport(built.nodes, built.edges);
        return {
          ...o,
          nodes: built.nodes,
          edges: built.edges,
          viewport: vp,
        };
      });
      setSelectedNodeIds([]);
      setSelectedEdgeId(null);
      setInspectorTab('summary');
      showToast(
        `Built ${formatMW(options.targetMW)} (${options.targetMode}) ${genRec?.name ?? 'Power Plant'}`,
      );
    },
    [mutateActiveOutpost, computeFitViewport, showToast],
  );

  const handleAddRecipeNode = useCallback(
    (recipeId: string) => {
      const pos = getCenterWorld();
      let createdId = '';
      mutateActiveOutpost((o, settings) => {
        const node = createRecipeNode(recipeId, pos.x, pos.y, settings);
        createdId = node.id;
        return { ...o, nodes: [...o.nodes, node] };
      });
      setSpawnAnchorWorld(null);
      if (createdId) {
        setSelectedNodeIds([createdId]);
        setInspectorTab('inspect');
      }
    },
    [getCenterWorld, mutateActiveOutpost],
  );

  const handleAddLogisticsNode = useCallback(
    (kind: Exclude<NodeKind, 'recipe'>) => {
      const pos = getCenterWorld();
      const newNode: FactoryNode = {
        id: createId('n'),
        kind,
        x: pos.x,
        y: pos.y,
        clockSpeed: 100,
        somersloops: 0,
        purity: 'normal',
        pinMode: 'auto',
        pinnedValue: 1,
        itemId: kind === 'input' ? 'iron-ore' : undefined,
        ratePerMin: kind === 'input' ? 120 : undefined,
        splitterMode: kind === 'splitter' ? 'demand' : undefined,
        built: false,
      };
      mutateActiveOutpost((o) => ({ ...o, nodes: [...o.nodes, newNode] }));
      setSpawnAnchorWorld(null);
      setSelectedNodeIds([newNode.id]);
      setInspectorTab('inspect');
    },
    [getCenterWorld, mutateActiveOutpost],
  );

  // Spawn & auto-wire from Drag-from-Port Context Menu!
  const handleContextSpawnRecipe = useCallback(
    (recipeId: string) => {
      if (!pendingContextSpawn) return;
      const { worldX, worldY, fromNodeId, fromDirection, itemId } = pendingContextSpawn;
      const x = Math.round((fromDirection === 'input' ? worldX - 268 : worldX) / 24) * 24;
      const y = Math.round((worldY - 76) / 24) * 24;
      let createdId = '';

      mutateActiveOutpost((o, settings) => {
        const node = createRecipeNode(recipeId, x, y, settings);
        createdId = node.id;
        const edge: FactoryEdge =
          fromDirection === 'input'
            ? {
                id: createId('e'),
                sourceNodeId: node.id,
                sourceItemId: itemId,
                targetNodeId: fromNodeId,
                targetItemId: itemId,
              }
            : {
                id: createId('e'),
                sourceNodeId: fromNodeId,
                sourceItemId: itemId,
                targetNodeId: node.id,
                targetItemId: itemId,
              };
        return {
          ...o,
          nodes: [...o.nodes, node],
          edges: [...o.edges, edge],
        };
      });

      setPendingContextSpawn(null);
      if (createdId) {
        setSelectedNodeIds([createdId]);
        setInspectorTab('inspect');
      }
    },
    [pendingContextSpawn, mutateActiveOutpost],
  );

  const handleContextSpawnLogistics = useCallback(
    (kind: Exclude<NodeKind, 'recipe'>) => {
      if (!pendingContextSpawn) return;
      const { worldX, worldY, fromNodeId, fromDirection, itemId } = pendingContextSpawn;
      const x = Math.round((fromDirection === 'input' ? worldX - 196 : worldX) / 24) * 24;
      const y = Math.round((worldY - 48) / 24) * 24;

      const node: FactoryNode = {
        id: createId('n'),
        kind,
        x,
        y,
        clockSpeed: 100,
        somersloops: 0,
        purity: 'normal',
        pinMode: 'auto',
        pinnedValue: 1,
        itemId,
        ratePerMin: kind === 'input' ? 120 : undefined,
        splitterMode: kind === 'splitter' ? 'demand' : undefined,
        built: false,
      };

      const edge: FactoryEdge =
        fromDirection === 'input'
          ? {
              id: createId('e'),
              sourceNodeId: node.id,
              sourceItemId: itemId,
              targetNodeId: fromNodeId,
              targetItemId: itemId,
            }
          : {
              id: createId('e'),
              sourceNodeId: fromNodeId,
              sourceItemId: itemId,
              targetNodeId: node.id,
              targetItemId: itemId,
            };

      mutateActiveOutpost((o) => ({
        ...o,
        nodes: [...o.nodes, node],
        edges: [...o.edges, edge],
      }));
      setPendingContextSpawn(null);
      setSelectedNodeIds([node.id]);
      setInspectorTab('inspect');
    },
    [pendingContextSpawn, mutateActiveOutpost],
  );

  // --- Outpost Management & Templates ---

  const handleAddOutpost = useCallback(() => {
    const id = createId('outpost');
    const accent = OUTPOST_ACCENTS[plan.outposts.length % OUTPOST_ACCENTS.length];
    const newOutpost: Outpost = {
      id,
      name: `Outpost ${plan.outposts.length + 1}`,
      accent,
      nodes: [],
      edges: [],
      viewport: { x: 100, y: 120, zoom: 1 },
    };
    mutatePlan((prev) => ({
      ...prev,
      activeOutpostId: id,
      outposts: [...prev.outposts, newOutpost],
    }));
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
  }, [plan.outposts.length, mutatePlan]);

  const handleRenameOutpost = useCallback(
    (id: string, name: string) => {
      mutatePlan((prev) => ({
        ...prev,
        outposts: prev.outposts.map((o) => (o.id === id ? { ...o, name } : o)),
      }));
    },
    [mutatePlan],
  );

  const handleDeleteOutpost = useCallback(
    (id: string) => {
      mutatePlan((prev) => {
        if (prev.outposts.length <= 1) return prev;
        const remaining = prev.outposts.filter((o) => o.id !== id);
        return {
          ...prev,
          activeOutpostId:
            prev.activeOutpostId === id ? remaining[0].id : prev.activeOutpostId,
          outposts: remaining,
        };
      });
      setSelectedNodeIds([]);
      setSelectedEdgeId(null);
    },
    [mutatePlan],
  );

  const handleLoadTemplate = useCallback(
    (tpl: FactoryTemplate) => {
      mutateActiveOutpost((o, settings) => {
        const built = tpl.build(settings);
        return {
          ...o,
          name: tpl.name,
          accent: tpl.accent,
          nodes: built.nodes,
          edges: built.edges,
          viewport: computeFitViewport(built.nodes, built.edges),
        };
      });
      setSelectedNodeIds([]);
      setSelectedEdgeId(null);
      setInspectorTab('summary');
      showToast(`Loaded template: ${tpl.name}`);
    },
    [mutateActiveOutpost, computeFitViewport, showToast],
  );

  const handleUpdateSettings = useCallback(
    (patch: Partial<PlanSettings>) => {
      mutatePlan((prev) => ({
        ...prev,
        settings: { ...prev.settings, ...patch },
      }));
    },
    [mutatePlan],
  );

  // --- Export / Import / URL Share ---

  const handleExportJSON = useCallback(() => {
    const blob = new Blob([JSON.stringify(plan, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `satisplanner-${activeOutpost.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported blueprint JSON');
  }, [plan, activeOutpost.name, showToast]);

  const handleImportJSON = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result)) as FactoryPlan;
          if (parsed && Array.isArray(parsed.outposts) && parsed.outposts.length > 0) {
            mutatePlan(() => parsed);
            setSelectedNodeIds([]);
            setSelectedEdgeId(null);
            showToast(`Imported ${parsed.outposts.length} outpost(s)`);
          } else {
            showToast('Invalid Satisplanner JSON file');
          }
        } catch {
          showToast('Could not parse JSON file');
        }
      };
      reader.readAsText(file);
    },
    [mutatePlan, showToast],
  );

  const handleCopyShareLink = useCallback(() => {
    try {
      const json = JSON.stringify(plan);
      const encoded = btoa(unescape(encodeURIComponent(json)));
      const url = `${window.location.origin}${window.location.pathname}#plan=${encoded}`;
      window.history.replaceState(null, '', `#plan=${encoded}`);
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url).catch(() => {});
      }
      showToast('Copied shareable blueprint URL to clipboard');
    } catch {
      showToast('Blueprint too large for URL. Use Export JSON instead.');
    }
  }, [plan, showToast]);

  // --- Global Keyboard Shortcuts (Speed-First Ergonomics) ---
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (inInput) return;

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleDuplicateNodes(selectedNodeIds);
        return;
      }

      if (e.key === ' ' || e.key === '/') {
        e.preventDefault();
        setSpawnAnchorWorld(null);
        setPaletteMode('chain');
        setPaletteOpen(true);
      } else if (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setSpawnAnchorWorld(null);
        setPaletteMode('power');
        setPaletteOpen(true);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
        setPendingContextSpawn(null);
        setSelectedNodeIds([]);
        setSelectedEdgeId(null);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedEdgeId) {
          e.preventDefault();
          handleDeleteEdge(selectedEdgeId);
        } else if (selectedNodeIds.length > 0) {
          e.preventDefault();
          handleDeleteNodes(selectedNodeIds);
        }
      } else if (e.key.toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleAutoLayout();
      } else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleFitView();
      } else if (e.key.toLowerCase() === 'i' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setInspectorOpen((v) => !v);
      } else if (e.key.toLowerCase() === 'e' && selectedNodeIds.length === 1) {
        e.preventDefault();
        handleExpandInputs(selectedNodeIds[0], false);
      } else if (e.key.toLowerCase() === 'r' && selectedNodeIds.length === 1) {
        e.preventDefault();
        setInspectorOpen(true);
        setInspectorTab('inspect');
      } else if (e.key >= '1' && e.key <= '6' && !e.ctrlKey && !e.metaKey) {
        const tier = Number(e.key);
        handleUpdateSettings({ maxBeltTier: tier });
        showToast(`Max Conveyor Belt set to Mk.${tier}`);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    selectedNodeIds,
    selectedEdgeId,
    handleUndo,
    handleRedo,
    handleDuplicateNodes,
    handleDeleteEdge,
    handleDeleteNodes,
    handleAutoLayout,
    handleFitView,
    handleExpandInputs,
    handleUpdateSettings,
    showToast,
  ]);

  return (
    <div className="app-shell">
      <TopBar
        outposts={plan.outposts}
        activeOutpostId={activeOutpost.id}
        settings={plan.settings}
        canUndo={historyPast.length > 0}
        canRedo={historyFuture.length > 0}
        inspectorOpen={inspectorOpen}
        onSelectOutpost={(id) => {
          mutatePlan((prev) => ({ ...prev, activeOutpostId: id }), false);
          setSelectedNodeIds([]);
          setSelectedEdgeId(null);
          setInspectorTab((t) => (t === 'inspect' ? 'summary' : t));
        }}
        onAddOutpost={handleAddOutpost}
        onRenameOutpost={handleRenameOutpost}
        onDeleteOutpost={handleDeleteOutpost}
        onOpenPalette={(mode) => {
          setSpawnAnchorWorld(null);
          setPaletteMode(mode);
          setPaletteOpen(true);
        }}
        onAutoLayout={handleAutoLayout}
        onFitView={handleFitView}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onChangeBeltTier={(tier) => {
          handleUpdateSettings({ maxBeltTier: tier });
          showToast(`Max Conveyor Belt set to Mk.${tier}`);
        }}
        onChangeTheme={(theme) => {
          handleUpdateSettings({ theme });
        }}
        onLoadTemplate={handleLoadTemplate}
        onExportJSON={handleExportJSON}
        onImportJSON={handleImportJSON}
        onCopyShareLink={handleCopyShareLink}
        onToggleInspector={() => setInspectorOpen((v) => !v)}
      />

      <main className="workspace-body">
        <Canvas
          nodes={activeOutpost.nodes}
          edges={activeOutpost.edges}
          solved={solved}
          settings={plan.settings}
          viewport={activeOutpost.viewport}
          selectedNodeIds={selectedNodeIds}
          selectedEdgeId={selectedEdgeId}
          onViewportChange={handleViewportChange}
          onSelectNodes={handleSelectNodes}
          onSelectEdge={handleSelectEdge}
          onMoveNodes={handleMoveNodes}
          onUpdateNode={handleUpdateNode}
          onConnectPorts={handleConnectPorts}
          onRequestContextSpawn={setPendingContextSpawn}
          onSpliceEdge={handleSpliceEdge}
          onSplitOverloadedEdge={handleSplitOverloadedEdge}
          onDeleteEdge={handleDeleteEdge}
          onExpandInputs={(id) => handleExpandInputs(id, false)}
          onSnapWholeMachines={handleSnapWholeMachines}
          onDuplicateNode={(id) => handleDuplicateNodes([id])}
          onDeleteNode={(id) => handleDeleteNodes([id])}
          onFocusRecipeSwap={(id) => {
            setSelectedNodeIds([id]);
            setInspectorOpen(true);
            setInspectorTab('inspect');
          }}
          onDoubleClickCanvas={(wx, wy) => {
            setSpawnAnchorWorld({ x: Math.round(wx / 24) * 24, y: Math.round(wy / 24) * 24 });
            setPaletteMode('node');
            setPaletteOpen(true);
          }}
          onOpenPalette={(mode) => {
            setSpawnAnchorWorld(null);
            setPaletteMode(mode);
            setPaletteOpen(true);
          }}
          onStageElement={(el) => {
            stageRef.current = el;
          }}
        />

        <InspectorPanel
          open={inspectorOpen}
          activeTab={inspectorTab}
          onTabChange={setInspectorTab}
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          nodes={activeOutpost.nodes}
          edges={activeOutpost.edges}
          solved={solved}
          settings={plan.settings}
          onUpdateNode={handleUpdateNode}
          onSwapNodeRecipe={handleSwapNodeRecipe}
          onExpandInputs={handleExpandInputs}
          onSnapWholeMachines={handleSnapWholeMachines}
          onSplitOverloadedEdge={handleSplitOverloadedEdge}
          onSplitAllOverloaded={handleSplitAllOverloaded}
          onSpliceEdge={handleSpliceEdge}
          onDeleteEdge={handleDeleteEdge}
          onUpdateSettings={handleUpdateSettings}
          onClearAllBuilt={() =>
            mutateActiveOutpost((o) => ({
              ...o,
              nodes: o.nodes.map((n) => ({ ...n, built: false })),
            }))
          }
        />
      </main>

      {paletteOpen && (
        <QuickPalette
          open={paletteOpen}
          initialMode={paletteMode}
          onClose={() => setPaletteOpen(false)}
          onAutoBuildChain={handleAutoBuildChain}
          onAutoBuildPower={handleAutoBuildPower}
          onAddRecipeNode={handleAddRecipeNode}
          onAddLogisticsNode={handleAddLogisticsNode}
        />
      )}

      {pendingContextSpawn && (
        <ContextSpawnMenu
          key={`${pendingContextSpawn.fromNodeId}-${pendingContextSpawn.itemId}`}
          pending={pendingContextSpawn}
          onClose={() => setPendingContextSpawn(null)}
          onSpawnRecipe={handleContextSpawnRecipe}
          onSpawnLogistics={handleContextSpawnLogistics}
        />
      )}

      {toast && (
        <div className="toast-pill" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}

export default App;
