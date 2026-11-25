import React, { useState } from 'react';
import {
  Check,
  Copy,
  GitFork,
  Lock,
  Merge,
  PackagePlus,
  Sparkles,
  Trash2,
  Unlock,
  Wand2,
} from 'lucide-react';
import {
  formatMW,
  formatRate,
  getPrimaryOutputItemId,
  ITEMS,
  MACHINES,
  RECIPES,
} from '../data/catalog';
import { evaluateMathExpr } from '../engine/expr';
import { resolveLogisticsItemId } from '../engine/solver';
import type { FactoryEdge, FactoryNode, SolvedNode } from '../engine/types';
import { SpriteIcon } from './SpriteIcon';

export interface DragWireState {
  fromNodeId: string;
  fromDirection: 'input' | 'output';
  itemId: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface NodeCardProps {
  node: FactoryNode;
  solved?: SolvedNode;
  edges: FactoryEdge[];
  selected: boolean;
  dragWire: DragWireState | null;
  onSelect: (nodeId: string, additive: boolean) => void;
  onStartDragNode: (e: React.MouseEvent, nodeId: string) => void;
  onStartDragWire: (
    e: React.MouseEvent,
    nodeId: string,
    direction: 'input' | 'output',
    itemId: string,
  ) => void;
  onCompleteWire: (
    nodeId: string,
    direction: 'input' | 'output',
    itemId: string,
  ) => void;
  onUpdateNode: (nodeId: string, patch: Partial<FactoryNode>) => void;
  onExpandInputs: (nodeId: string) => void;
  onSnapWholeMachines: (nodeId: string) => void;
  onDuplicateNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onFocusRecipeSwap: (nodeId: string) => void;
}

export const NodeCard: React.FC<NodeCardProps> = React.memo(
  ({
    node,
    solved,
    edges,
    selected,
    dragWire,
    onSelect,
    onStartDragNode,
    onStartDragWire,
    onCompleteWire,
    onUpdateNode,
    onExpandInputs,
    onSnapWholeMachines,
    onDuplicateNode,
    onDeleteNode,
    onFocusRecipeSwap,
  }) => {
    const [editingField, setEditingField] = useState<'machines' | 'output' | 'inputRate' | null>(
      null,
    );
    const [draftVal, setDraftVal] = useState('');

    const isCompatiblePort = (direction: 'input' | 'output', itemId: string) => {
      if (!dragWire) return false;
      if (dragWire.fromNodeId === node.id) return false;
      if (dragWire.fromDirection === direction) return false;
      if (itemId === '__any__' || dragWire.itemId === '__any__') return true;
      return dragWire.itemId === itemId;
    };

    // --- Compact Logistics / Input / Sink Card ---
    if (node.kind !== 'recipe') {
      const inferredItemId = resolveLogisticsItemId(node, edges);
      const item = inferredItemId ? ITEMS[inferredItemId] : undefined;
      const portItemId = inferredItemId ?? '__any__';
      const totalFlow =
        node.kind === 'input'
          ? node.ratePerMin ?? 60
          : Object.values(solved?.inputs ?? {})[0]?.actual ??
            Object.values(solved?.outputs ?? {})[0]?.required ??
            0;

      const KindIcon =
        node.kind === 'splitter'
          ? GitFork
          : node.kind === 'merger'
            ? Merge
            : node.kind === 'input'
              ? PackagePlus
              : Trash2;

      const kindTitle =
        node.label ||
        (node.kind === 'splitter'
          ? `Splitter · ${node.splitterMode ?? 'demand'}`
          : node.kind === 'merger'
            ? 'Merger'
            : node.kind === 'input'
              ? 'External Import'
              : 'AWESOME Sink');

      const commitInputRate = () => {
        const parsed = evaluateMathExpr(draftVal);
        if (parsed !== null && parsed >= 0) {
          onUpdateNode(node.id, { ratePerMin: parsed });
        }
        setEditingField(null);
      };

      return (
        <div
          className={`node-card compact ${selected ? 'selected' : ''} ${
            node.built ? 'built' : ''
          } ${solved?.isBottlenecked ? 'bottlenecked' : ''}`}
          style={{ left: node.x, top: node.y }}
          onMouseDown={(e) => {
            e.stopPropagation();
            onSelect(node.id, e.shiftKey);
          }}
        >
          <div className="node-quickbar" onMouseDown={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="node-qb-btn"
              onClick={() => onDuplicateNode(node.id)}
              title="Duplicate (Ctrl+D)"
            >
              <Copy size={11} />
            </button>
            <button
              type="button"
              className="node-qb-btn danger"
              onClick={() => onDeleteNode(node.id)}
              title="Delete (Del)"
            >
              <Trash2 size={11} />
            </button>
          </div>

          <div
            className="node-header"
            style={{ height: 44 }}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              onStartDragNode(e, node.id);
            }}
          >
            <KindIcon
              size={15}
              style={{ color: item?.isFluid ? 'var(--fluid)' : 'var(--accent)' }}
            />
            <div className="node-title-wrap">
              <div className="node-title" style={{ fontSize: 12 }}>
                {kindTitle}
              </div>
            </div>
            <button
              type="button"
              className={`built-toggle ${node.built ? 'checked' : ''}`}
              title={node.built ? 'Built in-game' : 'Mark as built'}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onUpdateNode(node.id, { built: !node.built });
              }}
            >
              <Check size={11} strokeWidth={3} />
            </button>
          </div>

          <div className="node-ports" style={{ minHeight: 42 }}>
            {node.kind !== 'input' && (
              <div className="port-col">
                <div className="port-row input">
                  <div
                    className={`port-handle ${item?.isFluid ? 'fluid' : ''} ${
                      solved?.isBottlenecked ? 'starved' : totalFlow > 0 ? 'balanced' : ''
                    } ${isCompatiblePort('input', portItemId) ? 'compatible' : ''}`}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      onStartDragWire(e, node.id, 'input', portItemId);
                    }}
                    onMouseUp={(e) => {
                      e.stopPropagation();
                      onCompleteWire(node.id, 'input', portItemId);
                    }}
                    title="Drag to connect input"
                  />
                  {item && <SpriteIcon iconId={item.icon} size={18} />}
                  <div className="port-info">
                    <span className="port-name">{item?.name ?? 'Any item'}</span>
                    <span className={`port-rate ${item?.isFluid ? 'fluid' : ''}`}>
                      {formatRate(totalFlow)}/m
                    </span>
                  </div>
                </div>
              </div>
            )}

            {node.kind !== 'sink' && (
              <div className="port-col outputs">
                <div className="port-row output">
                  <div
                    className={`port-handle ${item?.isFluid ? 'fluid' : ''} ${
                      totalFlow > 0 ? 'balanced' : ''
                    } ${isCompatiblePort('output', portItemId) ? 'compatible' : ''}`}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      onStartDragWire(e, node.id, 'output', portItemId);
                    }}
                    onMouseUp={(e) => {
                      e.stopPropagation();
                      onCompleteWire(node.id, 'output', portItemId);
                    }}
                    title="Drag to connect output"
                  />
                  {node.kind === 'input' && (
                    <>
                      {item && <SpriteIcon iconId={item.icon} size={18} />}
                      <div className="port-info">
                        <span className="port-name">{item?.name ?? 'Select item'}</span>
                        {editingField === 'inputRate' ? (
                          <input
                            className="inline-edit-input"
                            style={{ width: 64 }}
                            value={draftVal}
                            autoFocus
                            onMouseDown={(e) => e.stopPropagation()}
                            onChange={(e) => setDraftVal(e.target.value)}
                            onBlur={commitInputRate}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') commitInputRate();
                              if (e.key === 'Escape') setEditingField(null);
                            }}
                          />
                        ) : (
                          <span
                            className="port-rate"
                            title="Click to edit supply rate (supports math like 480/2)"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDraftVal(formatRate(node.ratePerMin ?? 60));
                              setEditingField('inputRate');
                            }}
                          >
                            {formatRate(node.ratePerMin ?? 60)}/m
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    // --- Production / Extractor / Power Generator Node Card ---
    const recipe = node.recipeId ? RECIPES[node.recipeId] : undefined;
    if (!recipe) return null;

    const machineId = node.machineId ?? recipe.producers[0];
    const machine = MACHINES[machineId];
    const inItems = Object.keys(recipe.in);
    const outItems = Object.keys(recipe.out);
    const primaryOut = getPrimaryOutputItemId(recipe);
    const hasMissingInputs = inItems.some(
      (id) => !edges.some((e) => e.targetNodeId === node.id && e.targetItemId === id),
    );

    const machinesVal = solved?.machines ?? 0;
    const isPinned = node.pinMode !== 'auto';
    const powerMW = solved?.powerMW ?? 0;
    const isFractional =
      !machine?.noOverclock &&
      machinesVal > 0.01 &&
      Math.abs(machinesVal - Math.round(machinesVal)) > 0.015;

    const commitMachinesEdit = () => {
      const parsed = evaluateMathExpr(draftVal);
      if (parsed !== null && parsed > 0) {
        onUpdateNode(node.id, { pinMode: 'machines', pinnedValue: parsed });
      }
      setEditingField(null);
    };

    const commitOutputEdit = () => {
      const parsed = evaluateMathExpr(draftVal);
      if (parsed !== null && parsed > 0) {
        onUpdateNode(node.id, { pinMode: 'output', pinnedValue: parsed });
      }
      setEditingField(null);
    };

    return (
      <div
        className={`node-card ${selected ? 'selected' : ''} ${
          node.built ? 'built' : ''
        } ${solved?.isBottlenecked ? 'bottlenecked' : ''}`}
        style={{ left: node.x, top: node.y }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onSelect(node.id, e.shiftKey);
        }}
      >
        {/* Floating hover/selected quick actions */}
        <div className="node-quickbar" onMouseDown={(e) => e.stopPropagation()}>
          {hasMissingInputs && (
            <button
              type="button"
              className="node-qb-btn accent"
              onClick={() => onExpandInputs(node.id)}
              title="Auto-spawn missing upstream inputs (E)"
            >
              <Wand2 size={11} />
              <span>Fill Inputs</span>
            </button>
          )}
          {isFractional && (
            <button
              type="button"
              className="node-qb-btn accent"
              onClick={() => onSnapWholeMachines(node.id)}
              title="Underclock to whole machine count with identical output"
            >
              <Sparkles size={11} />
              <span>Snap</span>
            </button>
          )}
          <button
            type="button"
            className="node-qb-btn"
            onClick={() =>
              onUpdateNode(node.id, {
                pinMode: isPinned ? 'auto' : 'machines',
                pinnedValue: Math.max(0.1, Number(machinesVal.toFixed(3)) || 1),
              })
            }
            title={isPinned ? 'Unpin (auto-scale from demand)' : 'Pin current machine count'}
          >
            {isPinned ? <Lock size={11} /> : <Unlock size={11} />}
          </button>
          <button
            type="button"
            className="node-qb-btn"
            onClick={() => onDuplicateNode(node.id)}
            title="Duplicate (Ctrl+D)"
          >
            <Copy size={11} />
          </button>
          <button
            type="button"
            className="node-qb-btn danger"
            onClick={() => onDeleteNode(node.id)}
            title="Delete (Del)"
          >
            <Trash2 size={11} />
          </button>
        </div>

        {/* Header (drag handle) */}
        <div
          className="node-header"
          style={{ height: 48 }}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            onStartDragNode(e, node.id);
          }}
        >
          <SpriteIcon
            iconId={machine?.icon ?? recipe.icon}
            size={28}
            title={machine?.name}
          />
          <div className="node-title-wrap">
            <div className="node-title-row">
              <button
                type="button"
                className="node-title-btn"
                title="Click to swap recipe or inspect alternates"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onFocusRecipeSwap(node.id);
                }}
              >
                <span className="node-title">{recipe.name}</span>
              </button>
              {recipe.isAlternate && <span className="alt-tag">ALT</span>}
              {recipe.isGenerator && <span className="gen-tag">GEN</span>}
            </div>
            <div className="node-sub">
              <span>{machine?.name ?? machineId}</span>
            </div>
          </div>
          <button
            type="button"
            className={`built-toggle ${node.built ? 'checked' : ''}`}
            title={node.built ? 'Built in-game (click to uncheck)' : 'Mark built in-game'}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onUpdateNode(node.id, { built: !node.built });
            }}
          >
            <Check size={11} strokeWidth={3} />
          </button>
        </div>

        {/* Metrics Strip: Machine Count + Clock/Sloop/Purity + Power */}
        <div
          className="node-metrics"
          style={{ height: 39 }}
        >
          <div
            className={`machine-badge ${isPinned ? 'pinned' : ''}`}
            title="Click to set exact machine count (supports math like 12/3)"
            onClick={() => {
              setDraftVal(formatRate(machinesVal));
              setEditingField('machines');
            }}
          >
            {isPinned && <Lock size={10} style={{ color: 'var(--accent)' }} />}
            {editingField === 'machines' ? (
              <input
                className="inline-edit-input"
                value={draftVal}
                autoFocus
                onChange={(e) => setDraftVal(e.target.value)}
                onBlur={commitMachinesEdit}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commitMachinesEdit();
                  if (e.key === 'Escape') setEditingField(null);
                }}
              />
            ) : (
              <span className="machine-count-val">{formatRate(machinesVal)}×</span>
            )}
          </div>

          <div className="metrics-pills">
            {machine?.supportsPurity && (
              <span className={`metric-chip purity-${node.purity}`}>
                {node.purity === 'pure' ? 'PURE' : node.purity === 'impure' ? 'IMP' : 'NORM'}
              </span>
            )}
            {recipe.powerBoostPct && (
              <span className="metric-chip sloop">
                +{Math.round(recipe.powerBoostPct * 100 * Math.max(1, machinesVal))}% GRID
              </span>
            )}
            {!machine?.noOverclock && Math.abs(node.clockSpeed - 100) > 0.05 && (
              <span className="metric-chip clock">{formatRate(node.clockSpeed)}%</span>
            )}
            {node.somersloops > 0 && (
              <span className="metric-chip sloop">
                S×{node.somersloops}
              </span>
            )}
            <span className={`metric-chip ${powerMW < -0.01 ? 'power-gen' : ''}`}>
              {formatMW(powerMW)}
            </span>
          </div>
        </div>

        {/* Input & Output Ports */}
        <div className="node-ports">
          <div className="port-col inputs">
            {inItems.map((itemId) => {
              const item = ITEMS[itemId];
              const port = solved?.inputs[itemId];
              const req = port?.required ?? 0;
              const act = port?.actual ?? 0;
              const status = port?.status ?? 'disconnected';
              const isFluid = Boolean(item?.isFluid);
              const compat = isCompatiblePort('input', itemId);

              return (
                <div key={`in-${itemId}`} className="port-row input">
                  <div
                    className={`port-handle ${isFluid ? 'fluid' : ''} ${status} ${
                      compat ? 'compatible' : ''
                    }`}
                    title={`Drag from ${item?.name ?? itemId} to spawn producer or connect`}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      onStartDragWire(e, node.id, 'input', itemId);
                    }}
                    onMouseUp={(e) => {
                      e.stopPropagation();
                      onCompleteWire(node.id, 'input', itemId);
                    }}
                  />
                  <SpriteIcon iconId={item?.icon ?? itemId} size={18} />
                  <div className="port-info">
                    <span className="port-name" title={item?.name ?? itemId}>
                      {item?.name ?? itemId}
                    </span>
                    <span
                      className={`port-rate ${status === 'starved' ? 'starved' : ''} ${
                        isFluid ? 'fluid' : ''
                      }`}
                    >
                      {status === 'starved'
                        ? `${formatRate(act)}/${formatRate(req)}`
                        : `${formatRate(req)}/m`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="port-col outputs">
            {outItems.map((itemId) => {
              const item = ITEMS[itemId];
              const port = solved?.outputs[itemId];
              const prod = port?.required ?? 0;
              const status = port?.status ?? 'disconnected';
              const isFluid = Boolean(item?.isFluid);
              const isPrimary = itemId === primaryOut;
              const compat = isCompatiblePort('output', itemId);

              return (
                <div key={`out-${itemId}`} className="port-row output">
                  <div
                    className={`port-handle ${isFluid ? 'fluid' : ''} ${status} ${
                      compat ? 'compatible' : ''
                    }`}
                    title={`Drag from ${item?.name ?? itemId} to spawn consumer or connect`}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      onStartDragWire(e, node.id, 'output', itemId);
                    }}
                    onMouseUp={(e) => {
                      e.stopPropagation();
                      onCompleteWire(node.id, 'output', itemId);
                    }}
                  />
                  <SpriteIcon iconId={item?.icon ?? itemId} size={18} />
                  <div className="port-info">
                    <span className="port-name" title={item?.name ?? itemId}>
                      {item?.name ?? itemId}
                    </span>
                    {isPrimary && editingField === 'output' ? (
                      <input
                        className="inline-edit-input"
                        style={{ width: 64, textAlign: 'right' }}
                        value={draftVal}
                        autoFocus
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => setDraftVal(e.target.value)}
                        onBlur={commitOutputEdit}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') commitOutputEdit();
                          if (e.key === 'Escape') setEditingField(null);
                        }}
                      />
                    ) : (
                      <span
                        className={`port-rate ${status === 'surplus' ? 'surplus' : ''} ${
                          isFluid ? 'fluid' : ''
                        }`}
                        title={
                          isPrimary
                            ? 'Click to pin target output rate/min (supports math like 60/2)'
                            : `${formatRate(prod)}/min byproduct`
                        }
                        onClick={(e) => {
                          if (!isPrimary) return;
                          e.stopPropagation();
                          setDraftVal(formatRate(prod));
                          setEditingField('output');
                        }}
                      >
                        {formatRate(prod)}/m
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  },
);
