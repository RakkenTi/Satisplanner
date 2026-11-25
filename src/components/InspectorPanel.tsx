import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Sliders,
  Sparkles,
  Wand2,
  Wrench,
} from 'lucide-react';
import {
  BELTS,
  formatMW,
  formatRate,
  fuzzyScore,
  getPrimaryOutputItemId,
  ITEM_LIST,
  ITEMS,
  MACHINES,
  PIPES,
  POWER_RECIPES,
  RECIPES,
  RECIPES_BY_OUTPUT,
} from '../data/catalog';
import { evaluateMathExpr } from '../engine/expr';
import type {
  FactoryNode,
  NodePurity,
  PlanSettings,
  SolvedFactory,
  SplitterMode,
} from '../engine/types';
import { SpriteIcon } from './SpriteIcon';

export type InspectorTab = 'inspect' | 'summary' | 'settings';

interface InspectorPanelProps {
  open: boolean;
  activeTab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  selectedNode: FactoryNode | null;
  solved: SolvedFactory;
  settings: PlanSettings;
  onUpdateNode: (nodeId: string, patch: Partial<FactoryNode>) => void;
  onSwapNodeRecipe: (nodeId: string, newRecipeId: string) => void;
  onExpandInputs: (nodeId: string, recursive: boolean) => void;
  onSnapWholeMachines: (nodeId: string) => void;
  onUpdateSettings: (patch: Partial<PlanSettings>) => void;
  onClearAllBuilt: () => void;
}

const CLOCK_PRESETS = [50, 100, 150, 200, 250];

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  open,
  activeTab,
  onTabChange,
  selectedNode,
  solved,
  settings,
  onUpdateNode,
  onSwapNodeRecipe,
  onExpandInputs,
  onSnapWholeMachines,
  onUpdateSettings,
  onClearAllBuilt,
}) => {
  const [altSearch, setAltSearch] = useState('');
  const [itemSearch, setItemSearch] = useState('');

  const selectedSolved = selectedNode ? solved.nodes[selectedNode.id] : undefined;
  const selectedRecipe =
    selectedNode?.kind === 'recipe' && selectedNode.recipeId
      ? RECIPES[selectedNode.recipeId]
      : undefined;
  const selectedMachine = selectedRecipe
    ? MACHINES[selectedNode?.machineId ?? selectedRecipe.producers[0]]
    : undefined;

  // Alternative recipes producing the same primary item (or sibling fuels for generators!)
  const swapCandidates = useMemo(() => {
    if (!selectedRecipe) return [];
    if (selectedRecipe.isGenerator) {
      const producerId = selectedRecipe.producers[0];
      return POWER_RECIPES.filter((r) => r.producers.includes(producerId));
    }
    const primary = getPrimaryOutputItemId(selectedRecipe);
    if (!primary) return [selectedRecipe];
    return RECIPES_BY_OUTPUT[primary] ?? [selectedRecipe];
  }, [selectedRecipe]);

  // Items with multiple recipes for the Global Preferred Alternates section
  const multiRecipeItems = useMemo(() => {
    const list = ITEM_LIST.filter(
      (it) => (RECIPES_BY_OUTPUT[it.id]?.length ?? 0) > 1,
    );
    if (!altSearch.trim()) return list.slice(0, 28);
    return list
      .map((it) => ({ it, score: fuzzyScore(altSearch, it.name, it.id) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 28)
      .map((x) => x.it);
  }, [altSearch]);

  const filteredInputItems = useMemo(() => {
    if (!itemSearch.trim()) return ITEM_LIST.slice(0, 24);
    return ITEM_LIST.map((it) => ({
      it,
      score: fuzzyScore(itemSearch, it.name, it.id),
    }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 24)
      .map((x) => x.it);
  }, [itemSearch]);

  const builtPct =
    solved.totalNodes > 0
      ? Math.round((solved.totalBuiltNodes / solved.totalNodes) * 100)
      : 0;

  return (
    <aside className={`inspector ${open ? '' : 'collapsed'}`} aria-label="Factory Inspector">
      <div className="inspector-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'inspect'}
          className={`inspector-tab ${activeTab === 'inspect' ? 'active' : ''}`}
          onClick={() => onTabChange('inspect')}
        >
          <Wrench size={13} />
          <span>Inspect</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'summary'}
          className={`inspector-tab ${activeTab === 'summary' ? 'active' : ''}`}
          onClick={() => onTabChange('summary')}
        >
          <BarChart3 size={13} />
          <span>Summary</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'settings'}
          className={`inspector-tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => onTabChange('settings')}
        >
          <Sliders size={13} />
          <span>1.2 Rules</span>
        </button>
      </div>

      <div className="inspector-body">
        {/* ==================== INSPECT TAB ==================== */}
        {activeTab === 'inspect' && (
          <>
            {!selectedNode ? (
              <div style={{ padding: '24px 8px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <p style={{ margin: '0 0 8px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  No node selected
                </p>
                <p style={{ margin: 0, fontSize: 12 }}>
                  Click any machine, splitter, merger, or import node on the canvas to configure
                  overclocking, Somersloops, node purity, or swap alternate recipes.
                </p>
              </div>
            ) : selectedNode.kind === 'recipe' && selectedRecipe && selectedMachine ? (
              <>
                {/* Selected Node Header */}
                <div className="panel-section">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <SpriteIcon iconId={selectedMachine.icon} size={34} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                        {selectedRecipe.name}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                        {selectedMachine.name} ·{' '}
                        <span className="mono">{formatMW(selectedSolved?.powerMW ?? 0)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ flex: 1 }}
                      onClick={() => onExpandInputs(selectedNode.id, false)}
                      title="Spawn immediate missing inputs"
                    >
                      <Wand2 size={12} /> Fill Inputs
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ flex: 1 }}
                      onClick={() => onExpandInputs(selectedNode.id, true)}
                      title="Expand full upstream chain down to raw ores"
                    >
                      <Sparkles size={12} /> Full Chain
                    </button>
                  </div>
                </div>

                {/* Scaling / Pin Mode */}
                <div className="panel-section">
                  <div className="section-label">
                    <span>Scaling Mode</span>
                    <span className="mono" style={{ color: 'var(--text-primary)' }}>
                      {formatRate(selectedSolved?.machines ?? 0)}× machines
                    </span>
                  </div>
                  <div className="segmented">
                    {(['auto', 'machines', 'output'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`segmented-btn ${selectedNode.pinMode === m ? 'active' : ''}`}
                        onClick={() => {
                          if (m === 'auto') {
                            onUpdateNode(selectedNode.id, { pinMode: 'auto' });
                          } else if (m === 'machines') {
                            onUpdateNode(selectedNode.id, {
                              pinMode: 'machines',
                              pinnedValue: Math.max(
                                0.1,
                                Number((selectedSolved?.machines ?? 1).toFixed(3)),
                              ),
                            });
                          } else {
                            const prim = getPrimaryOutputItemId(selectedRecipe);
                            const curOut = prim
                              ? selectedSolved?.outputs[prim]?.required ?? 10
                              : 10;
                            onUpdateNode(selectedNode.id, {
                              pinMode: 'output',
                              pinnedValue: Math.max(0.1, Number(curOut.toFixed(3))),
                            });
                          }
                        }}
                      >
                        {m === 'auto' ? 'Auto' : m === 'machines' ? 'Pin Count' : 'Pin Output'}
                      </button>
                    ))}
                  </div>

                  {selectedNode.pinMode !== 'auto' && (
                    <div className="control-row">
                      <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                        {selectedNode.pinMode === 'machines' ? 'Machines:' : 'Target /min:'}
                      </span>
                      <input
                        className="field-input mono"
                        style={{ width: 132, textAlign: 'right' }}
                        defaultValue={formatRate(selectedNode.pinnedValue)}
                        key={`${selectedNode.id}-${selectedNode.pinMode}-${selectedNode.pinnedValue}`}
                        onBlur={(e) => {
                          const v = evaluateMathExpr(e.target.value);
                          if (v !== null && v > 0) {
                            onUpdateNode(selectedNode.id, { pinnedValue: v });
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const v = evaluateMathExpr(e.currentTarget.value);
                            if (v !== null && v > 0) {
                              onUpdateNode(selectedNode.id, { pinnedValue: v });
                            }
                          }
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Machine Tier Selector (for Miners Mk.1 / Mk.2 / Mk.3 or Water/Oil Extractors) */}
                {selectedRecipe.producers.length > 1 && (
                  <div className="panel-section">
                    <div className="section-label">
                      <span>Building Tier</span>
                    </div>
                    <div className="segmented">
                      {selectedRecipe.producers.map((pid) => {
                        const pm = MACHINES[pid];
                        return (
                          <button
                            key={pid}
                            type="button"
                            className={`segmented-btn ${
                              selectedMachine.id === pid ? 'active' : ''
                            }`}
                            onClick={() => onUpdateNode(selectedNode.id, { machineId: pid })}
                          >
                            {pm?.name.replace('Miner ', '').replace(' Extractor', '') ?? pid}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Node Purity Selector */}
                {selectedMachine.supportsPurity && (
                  <div className="panel-section">
                    <div className="section-label">
                      <span>Resource Node Purity</span>
                    </div>
                    <div className="segmented">
                      {(['impure', 'normal', 'pure'] as NodePurity[]).map((p) => (
                        <button
                          key={p}
                          type="button"
                          className={`segmented-btn ${selectedNode.purity === p ? 'active' : ''}`}
                          onClick={() => onUpdateNode(selectedNode.id, { purity: p })}
                        >
                          {p === 'impure' ? 'Impure 0.5×' : p === 'normal' ? 'Normal 1×' : 'Pure 2×'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Overclocking Controls */}
                {selectedMachine.noOverclock ? (
                  <div className="panel-section">
                    <div className="section-label">
                      <span>Clock Speed</span>
                      <span className="mono" style={{ color: 'var(--text-muted)' }}>
                        Fixed 100%
                      </span>
                    </div>
                    <div
                      className="summary-row"
                      style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}
                    >
                      {selectedMachine.buildSomersloops
                        ? `Requires ${selectedMachine.buildSomersloops} Somersloops per unit · Cannot be overclocked`
                        : 'Output scales by geyser purity · Cannot be overclocked'}
                    </div>
                  </div>
                ) : (
                  <div className="panel-section">
                    <div className="section-label">
                      <span>Clock Speed</span>
                      <span className="mono" style={{ color: 'var(--warn)' }}>
                        {formatRate(selectedNode.clockSpeed)}%
                        {(selectedSolved?.powerShards ?? 0) > 0 &&
                          ` · ${selectedSolved?.powerShards} shards`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={250}
                      step={1}
                      className="range-slider"
                      value={selectedNode.clockSpeed}
                      onChange={(e) =>
                        onUpdateNode(selectedNode.id, { clockSpeed: Number(e.target.value) })
                      }
                    />
                    <div className="preset-row">
                      {CLOCK_PRESETS.map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          className={`preset-pill ${
                            Math.abs(selectedNode.clockSpeed - pct) < 0.1 ? 'active' : ''
                          }`}
                          onClick={() => onUpdateNode(selectedNode.id, { clockSpeed: pct })}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => onSnapWholeMachines(selectedNode.id)}
                      title="Auto-underclock so fractional machines become an exact integer count with identical total throughput"
                    >
                      <Sparkles size={12} /> Snap to Whole Machines (
                      {selectedSolved?.machinesCeil ?? 1}×)
                    </button>
                  </div>
                )}

                {/* Somersloop Production Amplification */}
                {selectedMachine.somersloopSlots > 0 && (
                  <div className="panel-section">
                    <div className="section-label">
                      <span>Somersloop Amplification</span>
                      <span className="mono" style={{ color: 'var(--sloop)' }}>
                        {formatRate(
                          (1 + selectedNode.somersloops / selectedMachine.somersloopSlots) * 100,
                        )}
                        % out ·{' '}
                        {formatRate(
                          Math.pow(
                            1 + selectedNode.somersloops / selectedMachine.somersloopSlots,
                            2,
                          ) * 100,
                        )}
                        % MW
                      </span>
                    </div>
                    <div className="sloop-slots">
                      {Array.from({ length: selectedMachine.somersloopSlots }, (_, idx) => {
                        const slotNum = idx + 1;
                        const filled = selectedNode.somersloops >= slotNum;
                        return (
                          <button
                            key={slotNum}
                            type="button"
                            className={`sloop-slot ${filled ? 'filled' : ''}`}
                            onClick={() =>
                              onUpdateNode(selectedNode.id, {
                                somersloops:
                                  selectedNode.somersloops === slotNum ? slotNum - 1 : slotNum,
                              })
                            }
                          >
                            S{slotNum}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Alternate Recipe Swapper */}
                {swapCandidates.length > 1 && (
                  <div className="panel-section">
                    <div className="section-label">
                      <span>Swap Recipe ({swapCandidates.length})</span>
                    </div>
                    <div className="summary-list">
                      {swapCandidates.map((cand) => {
                        const active = cand.id === selectedRecipe.id;
                        const cycles = 60 / cand.time;
                        const cm = MACHINES[cand.producers[0]];
                        return (
                          <button
                            key={cand.id}
                            type="button"
                            className={`recipe-option ${active ? 'active' : ''}`}
                            onClick={() => {
                              if (!active) onSwapNodeRecipe(selectedNode.id, cand.id);
                            }}
                          >
                            <div className="recipe-option-head">
                              <span className="recipe-option-name">{cand.name}</span>
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                {cand.isAlternate && <span className="alt-tag">ALT</span>}
                                {cm && <SpriteIcon iconId={cm.icon} size={16} />}
                              </div>
                            </div>
                            <div className="recipe-io-line">
                              {Object.entries(cand.in).length === 0 && cand.isGenerator ? (
                                <span style={{ color: 'var(--text-muted)' }}>No fuel</span>
                              ) : (
                                Object.entries(cand.in).map(([iid, q]) => (
                                  <span key={iid} className="recipe-io-chip">
                                    <SpriteIcon iconId={ITEMS[iid]?.icon ?? iid} size={13} />
                                    {formatRate(q * cycles)}
                                  </span>
                                ))
                              )}
                              <span style={{ color: 'var(--accent)' }}>→</span>
                              {cand.isGenerator && cm ? (
                                <span style={{ color: 'var(--ok)', fontWeight: 600 }}>
                                  +{formatMW(Math.abs(cand.powerMW ?? cm.basePowerMW))}
                                  {cand.powerBoostPct
                                    ? ` (+${Math.round(cand.powerBoostPct * 100)}% Grid)`
                                    : ''}
                                </span>
                              ) : (
                                Object.entries(cand.out).map(([oid, q]) => (
                                  <span key={oid} className="recipe-io-chip">
                                    <SpriteIcon iconId={ITEMS[oid]?.icon ?? oid} size={13} />
                                    {formatRate(q * cycles)}
                                  </span>
                                ))
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* Logistics / Input / Sink Node Inspector */
              <div className="panel-section">
                <div className="section-label">
                  <span>{selectedNode.kind.toUpperCase()} Node</span>
                </div>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Label</span>
                  <input
                    className="field-input"
                    value={selectedNode.label ?? ''}
                    placeholder="Optional custom label..."
                    onChange={(e) =>
                      onUpdateNode(selectedNode.id, { label: e.target.value })
                    }
                  />
                </label>

                {selectedNode.kind === 'splitter' && (
                  <div className="panel-section" style={{ marginTop: 6 }}>
                    <div className="section-label">
                      <span>Splitter Distribution Mode</span>
                    </div>
                    <div className="segmented">
                      {(['demand', 'even', 'priority'] as SplitterMode[]).map((sm) => (
                        <button
                          key={sm}
                          type="button"
                          className={`segmented-btn ${
                            (selectedNode.splitterMode ?? 'demand') === sm ? 'active' : ''
                          }`}
                          onClick={() => onUpdateNode(selectedNode.id, { splitterMode: sm })}
                        >
                          {sm === 'demand' ? 'Manifold' : sm === 'even' ? 'Even 1:1' : 'Overflow'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedNode.kind === 'input' && (
                  <>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                        Supply Rate (/min)
                      </span>
                      <input
                        className="field-input mono"
                        defaultValue={formatRate(selectedNode.ratePerMin ?? 60)}
                        key={`${selectedNode.id}-${selectedNode.ratePerMin}`}
                        onBlur={(e) => {
                          const v = evaluateMathExpr(e.target.value);
                          if (v !== null && v >= 0) {
                            onUpdateNode(selectedNode.id, { ratePerMin: v });
                          }
                        }}
                      />
                    </label>

                    <div className="section-label" style={{ marginTop: 6 }}>
                      <span>Import Item</span>
                    </div>
                    <input
                      className="field-input"
                      placeholder="Search item to import..."
                      value={itemSearch}
                      onChange={(e) => setItemSearch(e.target.value)}
                    />
                    <div className="summary-list" style={{ maxHeight: 220, overflowY: 'auto' }}>
                      {filteredInputItems.map((it) => (
                        <button
                          key={it.id}
                          type="button"
                          className={`recipe-option ${
                            selectedNode.itemId === it.id ? 'active' : ''
                          }`}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: '5px 8px' }}
                          onClick={() => onUpdateNode(selectedNode.id, { itemId: it.id })}
                        >
                          <SpriteIcon iconId={it.icon} size={18} />
                          <span style={{ fontSize: 12 }}>{it.name}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* ==================== FACTORY SUMMARY TAB ==================== */}
        {activeTab === 'summary' && (
          <>
            <div className="kpi-grid">
              <div className="kpi-tile">
                <div className="kpi-label">Net Power</div>
                <div
                  className={`kpi-value ${
                    solved.netPowerMW >= 0 ? 'ok' : 'accent'
                  }`}
                >
                  {solved.netPowerMW >= 0
                    ? `+${formatMW(solved.netPowerMW)}`
                    : `-${formatMW(-solved.netPowerMW)}`}
                </div>
              </div>
              <div className="kpi-tile">
                <div className="kpi-label">Total Buildings</div>
                <div className="kpi-value">{solved.totalMachines}</div>
              </div>
              <div className="kpi-tile">
                <div className="kpi-label">Power Shards</div>
                <div className="kpi-value">{solved.totalPowerShards}</div>
              </div>
              <div className="kpi-tile">
                <div className="kpi-label">Somersloops</div>
                <div
                  className="kpi-value"
                  style={{ color: solved.totalSomersloops > 0 ? 'var(--sloop)' : undefined }}
                >
                  {solved.totalSomersloops}
                </div>
              </div>
            </div>

            {solved.totalPowerGeneratedMW > 0 && (
              <div className="summary-list">
                <div className="summary-row">
                  <span className="summary-row-name">Power Split</span>
                  <span className="summary-row-val">
                    <span style={{ color: 'var(--ok)' }}>
                      +{formatMW(solved.totalPowerGeneratedMW)}
                    </span>{' '}
                    /{' '}
                    <span style={{ color: 'var(--text-secondary)' }}>
                      -{formatMW(solved.totalPowerConsumedMW)}
                    </span>
                  </span>
                </div>
                {solved.powerBoostPct > 0 && (
                  <div
                    className="summary-row"
                    style={{
                      borderColor: 'rgba(244, 114, 182, 0.35)',
                      background: 'rgba(244, 114, 182, 0.06)',
                    }}
                  >
                    <span className="summary-row-name" style={{ color: 'var(--sloop)' }}>
                      APA Grid Boost (+{Math.round(solved.powerBoostPct * 100)}%)
                    </span>
                    <span className="summary-row-val" style={{ color: 'var(--sloop)' }}>
                      +{formatMW(solved.powerBoostMW)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Build Checklist Progress */}
            <div className="panel-section">
              <div className="section-label">
                <span>
                  <CheckCircle2
                    size={11}
                    style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4 }}
                  />
                  Build Checklist ({solved.totalBuiltNodes}/{solved.totalNodes})
                </span>
                <span className="mono">{builtPct}%</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${builtPct}%` }} />
              </div>
              {solved.totalBuiltNodes > 0 && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={onClearAllBuilt}>
                  Reset Checklist
                </button>
              )}
            </div>

            {/* Alerts: Missing Inputs & Unhandled Byproducts */}
            {solved.missingInputs.length > 0 && (
              <div className="panel-section">
                <div className="section-label" style={{ color: 'var(--danger)' }}>
                  <span>
                    <AlertTriangle
                      size={11}
                      style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4 }}
                    />
                    Missing / Starved Inputs
                  </span>
                </div>
                <div className="summary-list">
                  {solved.missingInputs.map((item) => (
                    <div key={item.itemId} className="summary-row danger">
                      <div className="summary-row-left">
                        <SpriteIcon iconId={item.icon} size={18} />
                        <span className="summary-row-name">{item.name}</span>
                      </div>
                      <span className="summary-row-val" style={{ color: 'var(--danger)' }}>
                        -{formatRate(item.ratePerMin)}/m
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {solved.unhandledByproducts.length > 0 && (
              <div className="panel-section">
                <div className="section-label" style={{ color: 'var(--warn)' }}>
                  <span>Unhandled Byproducts (Sink or Loop!)</span>
                </div>
                <div className="summary-list">
                  {solved.unhandledByproducts.map((item) => (
                    <div key={item.itemId} className="summary-row warn">
                      <div className="summary-row-left">
                        <SpriteIcon iconId={item.icon} size={18} />
                        <span className="summary-row-name">{item.name}</span>
                      </div>
                      <span className="summary-row-val" style={{ color: 'var(--warn)' }}>
                        +{formatRate(item.ratePerMin)}/m
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Net Final Outputs */}
            {solved.netOutputs.length > 0 && (
              <div className="panel-section">
                <div className="section-label">
                  <span>Net Factory Outputs</span>
                </div>
                <div className="summary-list">
                  {solved.netOutputs.map((item) => (
                    <div key={item.itemId} className="summary-row">
                      <div className="summary-row-left">
                        <SpriteIcon iconId={item.icon} size={18} />
                        <span className="summary-row-name">{item.name}</span>
                      </div>
                      <span className="summary-row-val" style={{ color: 'var(--ok)' }}>
                        {formatRate(item.ratePerMin)}/m
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Raw Resources Required */}
            {solved.rawInputs.length > 0 && (
              <div className="panel-section">
                <div className="section-label">
                  <span>Raw Resources & Imports</span>
                </div>
                <div className="summary-list">
                  {solved.rawInputs.map((item) => (
                    <div key={item.itemId} className="summary-row">
                      <div className="summary-row-left">
                        <SpriteIcon iconId={item.icon} size={18} />
                        <span className="summary-row-name">{item.name}</span>
                      </div>
                      <span
                        className="summary-row-val"
                        style={{ color: item.isFluid ? 'var(--fluid)' : undefined }}
                      >
                        {formatRate(item.ratePerMin)}
                        {item.isFluid ? ' m³/m' : '/m'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Machine Shopping List */}
            {solved.buildings.length > 0 && (
              <div className="panel-section">
                <div className="section-label">
                  <span>Building Shopping List</span>
                </div>
                <div className="summary-list">
                  {solved.buildings.map((b) => (
                    <div key={b.machineId} className="summary-row">
                      <div className="summary-row-left">
                        <SpriteIcon iconId={b.icon} size={20} />
                        <div>
                          <div className="summary-row-name">{b.name}</div>
                          <div className="summary-row-sub">{formatMW(b.powerMW)}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="summary-row-val">{b.wholeCount}×</div>
                        {Math.abs(b.wholeCount - b.exactCount) > 0.02 && (
                          <div className="summary-row-sub">({formatRate(b.exactCount)})</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ==================== 1.2 RULES & ALTERNATES TAB ==================== */}
        {activeTab === 'settings' && (
          <>
            <div className="panel-section">
              <div className="section-label">
                <span>Workspace Theme</span>
              </div>
              <div className="theme-card-grid">
                {(
                  [
                    { id: 'ficsit', name: 'FICSIT Steel', bg: '#141412', card: '#262622', accent: '#e27620' },
                    { id: 'paper', name: 'Drafting', bg: '#efece4', card: '#ffffff', accent: '#cc5814' },
                    { id: 'blueprint', name: 'Blueprint', bg: '#0c1722', card: '#182f46', accent: '#ea8e34' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`theme-card ${(settings.theme ?? 'ficsit') === t.id ? 'active' : ''}`}
                    onClick={() => onUpdateSettings({ theme: t.id })}
                  >
                    <div className="theme-preview-bar">
                      <span style={{ flex: 2, background: t.bg }} />
                      <span style={{ flex: 2, background: t.card }} />
                      <span style={{ flex: 1, background: t.accent }} />
                    </div>
                    <span className="theme-card-name">{t.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="panel-section">
              <div className="section-label">
                <span>Logistics Caps</span>
              </div>
              <div className="control-row">
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Max Belt</span>
                <select
                  className="field-input"
                  style={{ width: 172 }}
                  value={settings.maxBeltTier}
                  onChange={(e) =>
                    onUpdateSettings({ maxBeltTier: Number(e.target.value) })
                  }
                >
                  {BELTS.map((b) => (
                    <option key={b.id} value={b.tier}>
                      {b.name} ({b.ratePerMin}/m)
                    </option>
                  ))}
                </select>
              </div>
              <div className="control-row">
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Max Pipeline</span>
                <select
                  className="field-input"
                  style={{ width: 172 }}
                  value={settings.maxPipeTier}
                  onChange={(e) =>
                    onUpdateSettings({ maxPipeTier: Number(e.target.value) })
                  }
                >
                  {PIPES.map((p) => (
                    <option key={p.id} value={p.tier}>
                      {p.name} ({p.ratePerMin} m³/m)
                    </option>
                  ))}
                </select>
              </div>
              <div className="control-row">
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Default Miner</span>
                <select
                  className="field-input"
                  style={{ width: 172 }}
                  value={settings.defaultMinerId}
                  onChange={(e) =>
                    onUpdateSettings({
                      defaultMinerId: e.target.value as PlanSettings['defaultMinerId'],
                    })
                  }
                >
                  <option value="miner-mk1">Miner Mk.1</option>
                  <option value="miner-mk2">Miner Mk.2</option>
                  <option value="miner-mk3">Miner Mk.3</option>
                </select>
              </div>
              <div className="control-row">
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Default Purity</span>
                <select
                  className="field-input"
                  style={{ width: 172 }}
                  value={settings.defaultPurity}
                  onChange={(e) =>
                    onUpdateSettings({
                      defaultPurity: e.target.value as NodePurity,
                    })
                  }
                >
                  <option value="impure">Impure (0.5×)</option>
                  <option value="normal">Normal (1×)</option>
                  <option value="pure">Pure (2×)</option>
                </select>
              </div>
            </div>

            {/* Satisfactory 1.2 Game Modes Multipliers */}
            <div className="panel-section">
              <div className="section-label">
                <span>Satisfactory 1.2 Game Modes</span>
              </div>
              <div>
                <div className="control-row" style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Recipe Cost Multiplier
                  </span>
                  <span className="mono" style={{ color: 'var(--accent)', fontWeight: 700 }}>
                    {settings.recipeCostMultiplier.toFixed(2)}×
                  </span>
                </div>
                <input
                  type="range"
                  min={0.25}
                  max={2}
                  step={0.25}
                  className="range-slider"
                  value={settings.recipeCostMultiplier}
                  onChange={(e) =>
                    onUpdateSettings({ recipeCostMultiplier: Number(e.target.value) })
                  }
                />
              </div>

              <div>
                <div className="control-row" style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Power Consumption Multiplier
                  </span>
                  <span className="mono" style={{ color: 'var(--accent)', fontWeight: 700 }}>
                    {settings.powerMultiplier.toFixed(2)}×
                  </span>
                </div>
                <input
                  type="range"
                  min={0.25}
                  max={5}
                  step={0.25}
                  className="range-slider"
                  value={settings.powerMultiplier}
                  onChange={(e) =>
                    onUpdateSettings({ powerMultiplier: Number(e.target.value) })
                  }
                />
              </div>
            </div>

            {/* Canvas Aesthetics & Routing */}
            <div className="panel-section">
              <div className="section-label">
                <span>Canvas Display</span>
              </div>
              <div className="segmented">
                <button
                  type="button"
                  className={`segmented-btn ${settings.edgeStyle === 'bezier' ? 'active' : ''}`}
                  onClick={() => onUpdateSettings({ edgeStyle: 'bezier' })}
                >
                  Curved Belts
                </button>
                <button
                  type="button"
                  className={`segmented-btn ${
                    settings.edgeStyle === 'orthogonal' ? 'active' : ''
                  }`}
                  onClick={() => onUpdateSettings({ edgeStyle: 'orthogonal' })}
                >
                  Bus Orthogonal
                </button>
              </div>
              <label className="summary-row" style={{ cursor: 'pointer' }}>
                <span className="summary-row-name">Snap Nodes to Grid (24px)</span>
                <input
                  type="checkbox"
                  checked={settings.snapToGrid}
                  onChange={(e) => onUpdateSettings({ snapToGrid: e.target.checked })}
                />
              </label>
              <label className="summary-row" style={{ cursor: 'pointer' }}>
                <span className="summary-row-name">Show Edge Belt/Rate Pills</span>
                <input
                  type="checkbox"
                  checked={settings.showBeltBadges}
                  onChange={(e) => onUpdateSettings({ showBeltBadges: e.target.checked })}
                />
              </label>
            </div>

            {/* Global Preferred Alternate Recipes for Auto-Plan */}
            <div className="panel-section">
              <div className="section-label">
                <span>Preferred Auto-Plan Recipes</span>
                {Object.keys(settings.preferredRecipes).length > 0 && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    style={{ height: 20, padding: '0 5px', fontSize: 10 }}
                    onClick={() => onUpdateSettings({ preferredRecipes: {} })}
                  >
                    Reset
                  </button>
                )}
              </div>
              <input
                className="field-input"
                placeholder="Filter item (e.g. screw, wire, fuel, steel)..."
                value={altSearch}
                onChange={(e) => setAltSearch(e.target.value)}
              />
              <div className="summary-list">
                {multiRecipeItems.map((it) => {
                  const recs = RECIPES_BY_OUTPUT[it.id] ?? [];
                  const chosen = settings.preferredRecipes[it.id] ?? recs[0]?.id ?? '';
                  return (
                    <div
                      key={it.id}
                      className="summary-row"
                      style={{ flexDirection: 'column', alignItems: 'stretch', gap: 5 }}
                    >
                      <div className="summary-row-left">
                        <SpriteIcon iconId={it.icon} size={16} />
                        <span className="summary-row-name">{it.name}</span>
                      </div>
                      <select
                        className="field-input"
                        style={{ height: 26, fontSize: 11.5 }}
                        value={chosen}
                        onChange={(e) => {
                          const next = { ...settings.preferredRecipes };
                          if (e.target.value === recs[0]?.id) {
                            delete next[it.id];
                          } else {
                            next[it.id] = e.target.value;
                          }
                          onUpdateSettings({ preferredRecipes: next });
                        }}
                      >
                        {recs.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                            {r.isAlternate ? ' [ALT]' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
};
