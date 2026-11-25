import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Search, Sparkles, Zap } from 'lucide-react';
import { formatRate, ITEMS } from '../data/catalog';
import type {
  FactoryEdge,
  FactoryNode,
  PlanSettings,
  SolvedFactory,
  ViewportState,
} from '../engine/types';
import type { PendingSpawnState } from './ContextSpawnMenu';
import { NodeCard, type DragWireState } from './NodeCard';
import { getNodeHeightEstimate, getNodeWidth, getPortAnchor } from './portGeometry';
import type { PaletteMode } from './QuickPalette';
import { SpriteIcon } from './SpriteIcon';

interface CanvasProps {
  nodes: FactoryNode[];
  edges: FactoryEdge[];
  solved: SolvedFactory;
  settings: PlanSettings;
  viewport: ViewportState;
  selectedNodeIds: string[];
  selectedEdgeId: string | null;
  onViewportChange: (vp: ViewportState) => void;
  onSelectNodes: (ids: string[]) => void;
  onSelectEdge: (edgeId: string | null) => void;
  onMoveNodes: (updates: Array<{ id: string; x: number; y: number }>, commitHistory: boolean) => void;
  onUpdateNode: (nodeId: string, patch: Partial<FactoryNode>) => void;
  onConnectPorts: (
    sourceNodeId: string,
    sourceItemId: string,
    targetNodeId: string,
    targetItemId: string,
  ) => void;
  onRequestContextSpawn: (pending: PendingSpawnState) => void;
  onSpliceEdge: (edgeId: string, kind: 'splitter' | 'merger') => void;
  onDeleteEdge: (edgeId: string) => void;
  onExpandInputs: (nodeId: string) => void;
  onSnapWholeMachines: (nodeId: string) => void;
  onDuplicateNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onFocusRecipeSwap: (nodeId: string) => void;
  onDoubleClickCanvas: (worldX: number, worldY: number) => void;
  onOpenPalette: (mode: PaletteMode) => void;
  onStageElement?: (el: HTMLDivElement | null) => void;
}

const GRID = 24;

function computeEdgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  style: 'bezier' | 'orthogonal',
): { d: string; midX: number; midY: number } {
  const dx = x2 - x1;
  if (style === 'orthogonal') {
    const midX = dx >= 40 ? (x1 + x2) / 2 : x1 + 36;
    if (dx >= 40) {
      const r = Math.min(12, Math.abs(y2 - y1) / 2, Math.abs(dx) / 4);
      const sy = y2 >= y1 ? 1 : -1;
      const d =
        Math.abs(y2 - y1) < 2
          ? `M ${x1} ${y1} L ${x2} ${y2}`
          : `M ${x1} ${y1} L ${midX - r} ${y1} Q ${midX} ${y1} ${midX} ${y1 + sy * r} L ${midX} ${
              y2 - sy * r
            } Q ${midX} ${y2} ${midX + r} ${y2} L ${x2} ${y2}`;
      return { d, midX, midY: (y1 + y2) / 2 };
    }
    // Loop-back orthogonal routing (e.g. Aluminum water recycling loop!)
    const loopY = Math.min(y1, y2) - 68;
    const d = `M ${x1} ${y1} L ${x1 + 28} ${y1} L ${x1 + 28} ${loopY} L ${x2 - 28} ${loopY} L ${
      x2 - 28
    } ${y2} L ${x2} ${y2}`;
    return { d, midX: (x1 + x2) / 2, midY: loopY };
  }

  // Smooth cubic bezier (with graceful arch for backward recycling loops)
  if (dx < 20) {
    const loopArch = Math.min(160, Math.max(85, Math.abs(dx) * 0.25 + 70));
    const topY = Math.min(y1, y2) - loopArch;
    const c1x = x1 + 95;
    const c1y = topY;
    const c2x = x2 - 95;
    const c2y = topY;
    const d = `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
    const midX = 0.125 * x1 + 0.375 * c1x + 0.375 * c2x + 0.125 * x2;
    const midY = 0.125 * y1 + 0.375 * c1y + 0.375 * c2y + 0.125 * y2;
    return { d, midX, midY };
  }

  const bend = Math.max(48, Math.min(190, Math.abs(dx) * 0.48));
  const c1x = x1 + bend;
  const c2x = x2 - bend;
  const d = `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`;
  return { d, midX: (x1 + x2) / 2, midY: (y1 + y2) / 2 };
}

export const Canvas: React.FC<CanvasProps> = ({
  nodes,
  edges,
  solved,
  settings,
  viewport,
  selectedNodeIds,
  selectedEdgeId,
  onViewportChange,
  onSelectNodes,
  onSelectEdge,
  onMoveNodes,
  onUpdateNode,
  onConnectPorts,
  onRequestContextSpawn,
  onSpliceEdge,
  onDeleteEdge,
  onExpandInputs,
  onSnapWholeMachines,
  onDuplicateNode,
  onDeleteNode,
  onFocusRecipeSwap,
  onDoubleClickCanvas,
  onOpenPalette,
  onStageElement,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const setStageRef = useCallback(
    (el: HTMLDivElement | null) => {
      stageRef.current = el;
      onStageElement?.(el);
    },
    [onStageElement],
  );

  const [isPanning, setIsPanning] = useState(false);
  const [dragWire, setDragWire] = useState<DragWireState | null>(null);
  const [marquee, setMarquee] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  const dragNodeRef = useRef<{
    startMouseX: number;
    startMouseY: number;
    initialPositions: Array<{ id: string; x: number; y: number }>;
    moved: boolean;
  } | null>(null);

  const panRef = useRef<{
    startMouseX: number;
    startMouseY: number;
    startVpX: number;
    startVpY: number;
  } | null>(null);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - viewport.x) / viewport.zoom,
        y: (clientY - rect.top - viewport.y) / viewport.zoom,
      };
    },
    [viewport],
  );

  // Smooth zoom-to-cursor via wheel
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.91;
      const nextZoom = Math.min(2.2, Math.max(0.22, viewport.zoom * zoomFactor));
      const ratio = nextZoom / viewport.zoom;
      onViewportChange({
        x: mouseX - (mouseX - viewport.x) * ratio,
        y: mouseY - (mouseY - viewport.y) * ratio,
        zoom: nextZoom,
      });
    },
    [viewport, onViewportChange],
  );

  // Canvas background mousedown -> pan or Shift+marquee box select
  const handleStageMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && !e.shiftKey)) {
      onSelectNodes([]);
      onSelectEdge(null);
      setIsPanning(true);
      panRef.current = {
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startVpX: viewport.x,
        startVpY: viewport.y,
      };
    } else if (e.button === 0 && e.shiftKey) {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      setMarquee({ x1: sx, y1: sy, x2: sx, y2: sy });
    }
  };

  const handleStartDragNode = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      const isAlreadySelected = selectedNodeIds.includes(nodeId);
      const activeIds = isAlreadySelected ? selectedNodeIds : [nodeId];
      if (!isAlreadySelected) {
        onSelectNodes(e.shiftKey ? [...selectedNodeIds, nodeId] : [nodeId]);
        onSelectEdge(null);
      }
      const initialPositions = activeIds
        .map((id) => nodes.find((n) => n.id === id))
        .filter((n): n is FactoryNode => Boolean(n))
        .map((n) => ({ id: n.id, x: n.x, y: n.y }));

      dragNodeRef.current = {
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        initialPositions,
        moved: false,
      };
    },
    [nodes, selectedNodeIds, onSelectNodes, onSelectEdge],
  );

  const handleStartDragWire = useCallback(
    (
      e: React.MouseEvent,
      nodeId: string,
      direction: 'input' | 'output',
      itemId: string,
    ) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const anchor = getPortAnchor(node, direction, itemId, edges);
      const world = screenToWorld(e.clientX, e.clientY);
      setDragWire({
        fromNodeId: nodeId,
        fromDirection: direction,
        itemId,
        startX: anchor.x,
        startY: anchor.y,
        currentX: world.x,
        currentY: world.y,
      });
    },
    [nodes, edges, screenToWorld],
  );

  const handleCompleteWire = useCallback(
    (targetNodeId: string, targetDirection: 'input' | 'output', targetItemId: string) => {
      if (!dragWire) return;
      if (
        dragWire.fromNodeId !== targetNodeId &&
        dragWire.fromDirection !== targetDirection
      ) {
        const resolvedItem =
          dragWire.itemId !== '__any__'
            ? dragWire.itemId
            : targetItemId !== '__any__'
              ? targetItemId
              : '';
        if (
          resolvedItem &&
          (dragWire.itemId === '__any__' ||
            targetItemId === '__any__' ||
            dragWire.itemId === targetItemId)
        ) {
          if (dragWire.fromDirection === 'output') {
            onConnectPorts(dragWire.fromNodeId, resolvedItem, targetNodeId, resolvedItem);
          } else {
            onConnectPorts(targetNodeId, resolvedItem, dragWire.fromNodeId, resolvedItem);
          }
        }
      }
      setDragWire(null);
    },
    [dragWire, onConnectPorts],
  );

  // Global mousemove & mouseup listeners for smooth dragging
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (panRef.current) {
        const dx = e.clientX - panRef.current.startMouseX;
        const dy = e.clientY - panRef.current.startMouseY;
        onViewportChange({
          ...viewport,
          x: panRef.current.startVpX + dx,
          y: panRef.current.startVpY + dy,
        });
        return;
      }

      if (dragNodeRef.current) {
        const dx = (e.clientX - dragNodeRef.current.startMouseX) / viewport.zoom;
        const dy = (e.clientY - dragNodeRef.current.startMouseY) / viewport.zoom;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          dragNodeRef.current.moved = true;
        }
        const updates = dragNodeRef.current.initialPositions.map((p) => {
          const rawX = p.x + dx;
          const rawY = p.y + dy;
          return {
            id: p.id,
            x: settings.snapToGrid ? Math.round(rawX / GRID) * GRID : Math.round(rawX),
            y: settings.snapToGrid ? Math.round(rawY / GRID) * GRID : Math.round(rawY),
          };
        });
        onMoveNodes(updates, false);
        return;
      }

      if (dragWire) {
        const world = screenToWorld(e.clientX, e.clientY);
        setDragWire((prev) =>
          prev ? { ...prev, currentX: world.x, currentY: world.y } : null,
        );
        return;
      }

      if (marquee) {
        const rect = stageRef.current?.getBoundingClientRect();
        if (!rect) return;
        setMarquee((prev) =>
          prev
            ? { ...prev, x2: e.clientX - rect.left, y2: e.clientY - rect.top }
            : null,
        );
      }
    };

    const onUp = (e: MouseEvent) => {
      if (panRef.current) {
        panRef.current = null;
        setIsPanning(false);
      }

      if (dragNodeRef.current) {
        if (dragNodeRef.current.moved) {
          const dx = (e.clientX - dragNodeRef.current.startMouseX) / viewport.zoom;
          const dy = (e.clientY - dragNodeRef.current.startMouseY) / viewport.zoom;
          const updates = dragNodeRef.current.initialPositions.map((p) => {
            const rawX = p.x + dx;
            const rawY = p.y + dy;
            return {
              id: p.id,
              x: settings.snapToGrid ? Math.round(rawX / GRID) * GRID : Math.round(rawX),
              y: settings.snapToGrid ? Math.round(rawY / GRID) * GRID : Math.round(rawY),
            };
          });
          onMoveNodes(updates, true);
        }
        dragNodeRef.current = null;
      }

      if (dragWire) {
        // Released on empty space -> open Satisfactory Modeler-style Drag-to-Spawn picker!
        const dist = Math.hypot(
          dragWire.currentX - dragWire.startX,
          dragWire.currentY - dragWire.startY,
        );
        if (dist > 28 && dragWire.itemId !== '__any__') {
          onRequestContextSpawn({
            screenX: e.clientX,
            screenY: e.clientY,
            worldX: dragWire.currentX,
            worldY: dragWire.currentY,
            fromNodeId: dragWire.fromNodeId,
            fromDirection: dragWire.fromDirection,
            itemId: dragWire.itemId,
          });
        }
        setDragWire(null);
      }

      if (marquee) {
        const left = Math.min(marquee.x1, marquee.x2);
        const right = Math.max(marquee.x1, marquee.x2);
        const top = Math.min(marquee.y1, marquee.y2);
        const bottom = Math.max(marquee.y1, marquee.y2);
        if (right - left > 8 || bottom - top > 8) {
          const wx1 = (left - viewport.x) / viewport.zoom;
          const wy1 = (top - viewport.y) / viewport.zoom;
          const wx2 = (right - viewport.x) / viewport.zoom;
          const wy2 = (bottom - viewport.y) / viewport.zoom;
          const inside = nodes
            .filter((n) => {
              const w = getNodeWidth(n);
              const h = getNodeHeightEstimate(n, edges);
              return n.x + w >= wx1 && n.x <= wx2 && n.y + h >= wy1 && n.y <= wy2;
            })
            .map((n) => n.id);
          onSelectNodes(inside);
        }
        setMarquee(null);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [
    viewport,
    settings.snapToGrid,
    dragWire,
    marquee,
    nodes,
    edges,
    onViewportChange,
    onMoveNodes,
    onRequestContextSpawn,
    onSelectNodes,
    screenToWorld,
  ]);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selectedSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);

  // Compute rendered edge geometry
  const renderedEdges = useMemo(() => {
    return edges
      .map((edge) => {
        const src = nodeMap.get(edge.sourceNodeId);
        const dst = nodeMap.get(edge.targetNodeId);
        if (!src || !dst) return null;
        const p1 = getPortAnchor(src, 'output', edge.sourceItemId, edges);
        const p2 = getPortAnchor(dst, 'input', edge.targetItemId, edges);
        const geom = computeEdgePath(p1.x, p1.y, p2.x, p2.y, settings.edgeStyle);
        const se = solved.edges[edge.id];
        return { edge, geom, se };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  }, [edges, nodeMap, settings.edgeStyle, solved.edges]);

  // Minimap bounds
  const minimapData = useMemo(() => {
    if (nodes.length === 0) return null;
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
    const pad = 180;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const scale = Math.min(176 / spanX, 112 / spanY);
    return { minX, minY, spanX, spanY, scale };
  }, [nodes, edges]);

  const patternStep = Math.max(36, 96 * viewport.zoom);

  return (
    <div
      ref={setStageRef}
      id="factory-canvas"
      className={`canvas-stage ${isPanning ? 'panning' : ''} ${
        dragWire ? 'connecting' : ''
      }`}
      style={{
        backgroundSize: `${patternStep}px ${patternStep}px`,
        backgroundPosition: `${viewport.x % patternStep}px ${viewport.y % patternStep}px`,
      }}
      onWheel={handleWheel}
      onMouseDown={handleStageMouseDown}
      onDoubleClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const w = screenToWorld(e.clientX, e.clientY);
        onDoubleClickCanvas(w.x, w.y);
      }}
    >
      {/* Transformed World Space */}
      <div
        className="canvas-world"
        style={{
          transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.zoom})`,
        }}
      >
        {/* SVG Edges Layer */}
        <svg className="edges-svg">
          {renderedEdges.map(({ edge, geom, se }) => {
            const isSelected = selectedEdgeId === edge.id;
            const isHovered = hoveredEdgeId === edge.id;
            const touchesSelected =
              selectedSet.has(edge.sourceNodeId) || selectedSet.has(edge.targetNodeId);
            const isFluid = Boolean(se?.isFluid);
            const overLimit = Boolean(se?.overLimit);
            const isIdle = (se?.flowRate ?? 0) <= 1e-4;

            const strokeColor = isSelected
              ? 'var(--edge-selected)'
              : overLimit
                ? 'var(--edge-overlimit)'
                : isFluid
                  ? 'var(--edge-fluid)'
                  : isIdle
                    ? 'var(--edge-idle)'
                    : 'var(--edge-solid)';

            const strokeWidth = isSelected || isHovered ? 3.2 : touchesSelected ? 2.8 : 2.1;
            const opacity =
              selectedNodeIds.length > 0 && !touchesSelected && !isSelected ? 0.36 : 0.94;

            return (
              <g key={edge.id}>
                <path
                  d={geom.d}
                  className="edge-hit"
                  onMouseEnter={() => setHoveredEdgeId(edge.id)}
                  onMouseLeave={() => setHoveredEdgeId(null)}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    onSelectNodes([]);
                    onSelectEdge(edge.id);
                  }}
                />
                <path
                  d={geom.d}
                  className="edge-path"
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  opacity={opacity}
                />
                {!isIdle && (
                  <path
                    d={geom.d}
                    className="edge-flow-overlay"
                    stroke="var(--edge-flow-dash)"
                    strokeWidth={Math.max(1.2, strokeWidth - 0.9)}
                    opacity={opacity * 0.85}
                  />
                )}
              </g>
            );
          })}

          {/* Live Dragging Wire */}
          {dragWire && (
            <path
              className="edge-draft-path"
              d={
                computeEdgePath(
                  dragWire.fromDirection === 'output' ? dragWire.startX : dragWire.currentX,
                  dragWire.fromDirection === 'output' ? dragWire.startY : dragWire.currentY,
                  dragWire.fromDirection === 'output' ? dragWire.currentX : dragWire.startX,
                  dragWire.fromDirection === 'output' ? dragWire.currentY : dragWire.startY,
                  'bezier',
                ).d
              }
            />
          )}
        </svg>

        {/* Floating Edge Rate / Belt Badges */}
        {settings.showBeltBadges && (
          <div className="edge-label-layer">
            {renderedEdges.map(({ edge, geom, se }) => {
              const isSelected = selectedEdgeId === edge.id;
              const isHovered = hoveredEdgeId === edge.id;
              const item = ITEMS[edge.sourceItemId];
              const rate = se?.flowRate ?? 0;
              const tierLabel = se?.overLimit
                ? `${se.beltCountAtMax}× Max`
                : se?.minTierName ?? '';

              return (
                <div
                  key={`lbl-${edge.id}`}
                  className={`edge-pill ${isSelected ? 'selected' : ''} ${
                    se?.isFluid ? 'fluid' : ''
                  } ${se?.overLimit ? 'overlimit' : ''}`}
                  style={{ left: geom.midX, top: geom.midY }}
                  onMouseEnter={() => setHoveredEdgeId(edge.id)}
                  onMouseLeave={() => setHoveredEdgeId(null)}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    onSelectNodes([]);
                    onSelectEdge(edge.id);
                  }}
                  title={
                    se?.overLimit
                      ? `Exceeds max belt/pipe limit! Needs ${se.beltCountAtMax} belts/pipes.`
                      : `${item?.name ?? edge.sourceItemId}: ${formatRate(rate)}/min (${tierLabel})`
                  }
                >
                  <SpriteIcon iconId={item?.icon ?? edge.sourceItemId} size={14} />
                  <span>{formatRate(rate)}/m</span>
                  {tierLabel && <span className="edge-pill-tier">{tierLabel}</span>}

                  {(isSelected || isHovered) && (
                    <span
                      className="edge-quick-actions"
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="edge-quick-btn"
                        title="Insert Splitter on this belt"
                        onClick={() => onSpliceEdge(edge.id, 'splitter')}
                      >
                        Split
                      </button>
                      <button
                        type="button"
                        className="edge-quick-btn"
                        title="Insert Merger on this belt"
                        onClick={() => onSpliceEdge(edge.id, 'merger')}
                      >
                        Merge
                      </button>
                      <button
                        type="button"
                        className="edge-quick-btn danger"
                        title="Disconnect belt"
                        onClick={() => onDeleteEdge(edge.id)}
                      >
                        ×
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Factory Nodes Layer */}
        <div className="nodes-layer">
          {nodes.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              solved={solved.nodes[node.id]}
              edges={edges}
              selected={selectedSet.has(node.id)}
              dragWire={dragWire}
              onSelect={(id, additive) => {
                onSelectEdge(null);
                if (additive) {
                  onSelectNodes(
                    selectedSet.has(id)
                      ? selectedNodeIds.filter((x) => x !== id)
                      : [...selectedNodeIds, id],
                  );
                } else {
                  onSelectNodes([id]);
                }
              }}
              onStartDragNode={handleStartDragNode}
              onStartDragWire={handleStartDragWire}
              onCompleteWire={handleCompleteWire}
              onUpdateNode={onUpdateNode}
              onExpandInputs={onExpandInputs}
              onSnapWholeMachines={onSnapWholeMachines}
              onDuplicateNode={onDuplicateNode}
              onDeleteNode={onDeleteNode}
              onFocusRecipeSwap={onFocusRecipeSwap}
            />
          ))}
        </div>
      </div>

      {/* Marquee Selection Overlay */}
      {marquee && (
        <div
          className="marquee-box"
          style={{
            left: Math.min(marquee.x1, marquee.x2),
            top: Math.min(marquee.y1, marquee.y2),
            width: Math.abs(marquee.x2 - marquee.x1),
            height: Math.abs(marquee.y2 - marquee.y1),
          }}
        />
      )}

      {/* Empty Canvas CTA */}
      {nodes.length === 0 && (
        <div className="empty-canvas-cta" onMouseDown={(e) => e.stopPropagation()}>
          <h2>Ready to Blueprint</h2>
          <p>
            Auto-synthesize any Satisfactory 1.2 production line or power facility in 2
            keystrokes, or drop single machines and drag ports to spawn connected recipes.
          </p>
          <div className="empty-cta-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onOpenPalette('chain')}
            >
              <Sparkles size={13} />
              <span>Auto-Plan Item</span>
              <span className="kbd">Space</span>
            </button>
            <button
              type="button"
              className="btn btn-power"
              onClick={() => onOpenPalette('power')}
            >
              <Zap size={13} />
              <span>Power Plant</span>
              <span className="kbd">P</span>
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => onOpenPalette('node')}
            >
              <Search size={13} />
              <span>Single Machine</span>
            </button>
          </div>
        </div>
      )}

      {/* Bottom-Left Controls & Shortcut Hints */}
      <div className="canvas-hud-bottom" onMouseDown={(e) => e.stopPropagation()}>
        <div className="hud-pill">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            style={{ width: 22, height: 22 }}
            onClick={() =>
              onViewportChange({
                ...viewport,
                zoom: Math.max(0.22, viewport.zoom / 1.15),
              })
            }
            aria-label="Zoom out"
          >
            <Minus size={12} />
          </button>
          <span className="mono" style={{ minWidth: 40, textAlign: 'center', fontSize: 11 }}>
            {Math.round(viewport.zoom * 100)}%
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            style={{ width: 22, height: 22 }}
            onClick={() =>
              onViewportChange({
                ...viewport,
                zoom: Math.min(2.2, viewport.zoom * 1.15),
              })
            }
            aria-label="Zoom in"
          >
            <Plus size={12} />
          </button>
        </div>

        <div className="hud-pill hud-hint">
          <span className="hud-hint-item">
            <span className="kbd">Drag Port</span> Spawn recipe
          </span>
          <span className="hud-hint-item">
            <span className="kbd">Space</span> Plan item
          </span>
          <span className="hud-hint-item">
            <span className="kbd">P</span> Power plant
          </span>
          <span className="hud-hint-item">
            <span className="kbd">A</span> Auto-layout
          </span>
        </div>
      </div>

      {/* Bottom-Right Live Interactive Minimap */}
      {minimapData && nodes.length > 0 && (
        <div
          className="minimap-box"
          title="Click minimap to jump viewport"
          onMouseDown={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            const stageRect = stageRef.current?.getBoundingClientRect();
            if (!stageRect) return;
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const targetWorldX = minimapData.minX + mx / minimapData.scale;
            const targetWorldY = minimapData.minY + my / minimapData.scale;
            onViewportChange({
              ...viewport,
              x: stageRect.width / 2 - targetWorldX * viewport.zoom,
              y: stageRect.height / 2 - targetWorldY * viewport.zoom,
            });
          }}
        >
          <svg width="176" height="112">
            {renderedEdges.map(({ edge, se }) => {
              const src = nodeMap.get(edge.sourceNodeId);
              const dst = nodeMap.get(edge.targetNodeId);
              if (!src || !dst) return null;
              const x1 = (src.x + getNodeWidth(src) / 2 - minimapData.minX) * minimapData.scale;
              const y1 = (src.y + 50 - minimapData.minY) * minimapData.scale;
              const x2 = (dst.x + getNodeWidth(dst) / 2 - minimapData.minX) * minimapData.scale;
              const y2 = (dst.y + 50 - minimapData.minY) * minimapData.scale;
              return (
                <line
                  key={`mm-e-${edge.id}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={se?.isFluid ? 'var(--minimap-edge-fluid)' : 'var(--minimap-edge-solid)'}
                  strokeWidth={1}
                />
              );
            })}
            {nodes.map((n) => {
              const rx = (n.x - minimapData.minX) * minimapData.scale;
              const ry = (n.y - minimapData.minY) * minimapData.scale;
              const rw = Math.max(4, getNodeWidth(n) * minimapData.scale);
              const rh = Math.max(3, getNodeHeightEstimate(n, edges) * minimapData.scale);
              const isSel = selectedSet.has(n.id);
              return (
                <rect
                  key={`mm-n-${n.id}`}
                  x={rx}
                  y={ry}
                  width={rw}
                  height={rh}
                  rx={1}
                  fill={isSel ? 'var(--accent)' : n.built ? 'var(--ok)' : 'var(--minimap-node)'}
                  opacity={isSel ? 1 : 0.88}
                />
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
};
