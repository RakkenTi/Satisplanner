import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GitFork, Merge, PackagePlus, Search, Sparkles, Trash2, Zap } from 'lucide-react';
import {
  formatMW,
  formatRate,
  fuzzyScore,
  getPrimaryFuelItemId,
  ITEM_LIST,
  ITEMS,
  MACHINES,
  POWER_RECIPES,
  RECIPES_BY_OUTPUT,
  RECIPES_LIST,
} from '../data/catalog';
import type { PowerPlantPlanOptions } from '../engine/autoPlanner';
import { evaluateMathExpr } from '../engine/expr';
import {
  PURITY_MULTIPLIER,
  type GameItem,
  type GameRecipe,
  type NodeKind,
  type NodePurity,
} from '../engine/types';
import { SpriteIcon } from './SpriteIcon';

export type PaletteMode = 'chain' | 'power' | 'node';

interface QuickPaletteProps {
  open: boolean;
  initialMode: PaletteMode;
  onClose: () => void;
  onAutoBuildChain: (itemId: string, ratePerMin: number, splitOverloaded?: boolean) => void;
  onAutoBuildPower: (options: PowerPlantPlanOptions) => void;
  onAddRecipeNode: (recipeId: string) => void;
  onAddLogisticsNode: (kind: Exclude<NodeKind, 'recipe'>) => void;
}

type SearchEntry =
  | { type: 'item'; item: GameItem; score: number }
  | { type: 'recipe'; recipe: GameRecipe; score: number }
  | {
      type: 'logistics';
      kind: Exclude<NodeKind, 'recipe'>;
      name: string;
      sub: string;
      score: number;
    };

const LOGISTICS_ENTRIES: Array<{
  kind: Exclude<NodeKind, 'recipe'>;
  name: string;
  sub: string;
}> = [
  {
    kind: 'splitter',
    name: 'Splitter (Smart / Priority / Even)',
    sub: 'Divide 1 belt/pipe into multiple branches with demand or overflow priority',
  },
  {
    kind: 'merger',
    name: 'Merger / Junction',
    sub: 'Combine multiple belts or recycle byproduct fluid loops',
  },
  {
    kind: 'input',
    name: 'External Import / Supply Feed',
    sub: 'Inject any item at a fixed rate (e.g. from Train Station or another Outpost)',
  },
  {
    kind: 'sink',
    name: 'AWESOME Sink / Export Terminal',
    sub: 'Absorb overflow byproducts or mark factory export',
  },
];

const GENERATOR_GROUPS: Array<{
  machineId: string;
  shortName: string;
  mwLabel: string;
  icon: string;
}> = [
  { machineId: 'fuel-generator', shortName: 'Fuel Gen', mwLabel: '250 MW', icon: 'fuel-generator' },
  { machineId: 'coal-generator', shortName: 'Coal Gen', mwLabel: '75 MW', icon: 'coal-generator' },
  { machineId: 'nuclear-power-plant', shortName: 'Nuclear', mwLabel: '2.5 GW', icon: 'nuclear-power-plant' },
  { machineId: 'biomass-burner', shortName: 'Biomass', mwLabel: '30 MW', icon: 'biomass-burner' },
  { machineId: 'geothermal-generator', shortName: 'Geothermal', mwLabel: '100-400 MW', icon: 'geothermal-generator' },
  { machineId: 'alien-power-augmenter', shortName: 'Alien APA', mwLabel: '500 MW +%', icon: 'alien-power-matrix' },
];

const POWER_PRESETS: Array<{ label: string; value: string; unit: 'MW' | 'GW' }> = [
  { label: '15 MW', value: '15', unit: 'MW' },
  { label: '600 MW', value: '600', unit: 'MW' },
  { label: '2.5 GW', value: '2.5', unit: 'GW' },
  { label: '15 GW', value: '15', unit: 'GW' },
  { label: '30 GW', value: '30', unit: 'GW' },
];

type ApaOption = 'none' | '1-base' | '1-matrix' | '2-matrix';

export const QuickPalette: React.FC<QuickPaletteProps> = ({
  open,
  initialMode,
  onClose,
  onAutoBuildChain,
  onAutoBuildPower,
  onAddRecipeNode,
  onAddLogisticsNode,
}) => {
  const [mode, setMode] = useState<PaletteMode>(initialMode);
  const [query, setQuery] = useState('');
  const [rateDraft, setRateDraft] = useState('10');
  const [focusIdx, setFocusIdx] = useState(0);

  // Power Plant planner state
  const [powerDraft, setPowerDraft] = useState('1500');
  const [powerUnit, setPowerUnit] = useState<'MW' | 'GW'>('MW');
  const [powerTargetMode, setPowerTargetMode] = useState<'gross' | 'net'>('gross');
  const [selectedGenMachineId, setSelectedGenMachineId] = useState('fuel-generator');
  const [selectedGenRecipeId, setSelectedGenRecipeId] = useState('power-turbofuel');
  const [selectedFuelRecipeId, setSelectedFuelRecipeId] = useState<string>('turbofuel');
  const [geoPurity, setGeoPurity] = useState<NodePurity>('normal');
  const [apaOption, setApaOption] = useState<ApaOption>('none');
  const [autoSinkByproducts, setAutoSinkByproducts] = useState(true);
  const [splitOverloaded, setSplitOverloaded] = useState(true);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const powerInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        if (mode === 'power') powerInputRef.current?.focus();
        else inputRef.current?.focus();
      });
    }
  }, [open, mode]);

  // Generator burn recipes belonging to the selected generator machine
  const genRecipesForMachine = useMemo(
    () => POWER_RECIPES.filter((r) => r.producers.includes(selectedGenMachineId)),
    [selectedGenMachineId],
  );

  const activeGenRecipe = useMemo(
    () =>
      genRecipesForMachine.find((r) => r.id === selectedGenRecipeId) ??
      genRecipesForMachine[0],
    [genRecipesForMachine, selectedGenRecipeId],
  );

  const primaryFuelId = activeGenRecipe ? getPrimaryFuelItemId(activeGenRecipe) : undefined;

  // Crafting recipes that produce the selected fuel (e.g. Turbofuel, Turbo Blend Fuel, Turbo Heavy Fuel)
  const fuelCraftRoutes = useMemo(() => {
    if (!primaryFuelId) return [];
    const list = RECIPES_BY_OUTPUT[primaryFuelId] ?? [];
    // Hide unpackaging/converter clutter unless it's the only option
    const clean = list.filter(
      (r) => !r.id.startsWith('unpackage-') && !r.isConverter,
    );
    return clean.length > 0 ? clean : list;
  }, [primaryFuelId]);

  const activeFuelRouteId = useMemo(() => {
    if (fuelCraftRoutes.length === 0) return undefined;
    if (fuelCraftRoutes.some((r) => r.id === selectedFuelRecipeId)) {
      return selectedFuelRecipeId;
    }
    return fuelCraftRoutes[0].id;
  }, [fuelCraftRoutes, selectedFuelRecipeId]);

  // Compute parsed target MW (supports "15GW", "1500MW", "250*4", or unit toggle)
  const parsedTargetMW = useMemo(() => {
    const trimmed = powerDraft.trim().toLowerCase();
    let mult = powerUnit === 'GW' ? 1000 : 1;
    let expr = trimmed;
    if (expr.endsWith('gw')) {
      mult = 1000;
      expr = expr.slice(0, -2);
    } else if (expr.endsWith('mw')) {
      mult = 1;
      expr = expr.slice(0, -2);
    }
    const val = evaluateMathExpr(expr);
    if (val === null || val <= 0) return 250;
    return val * mult;
  }, [powerDraft, powerUnit]);

  // Quick live preview estimate for Power Plant mode
  const powerPreviewText = useMemo(() => {
    if (!activeGenRecipe) return '';
    const m = MACHINES[selectedGenMachineId];
    if (!m) return '';
    const purityFactor = m.supportsPurity ? PURITY_MULTIPLIER[geoPurity] : 1;
    const perGen = Math.abs(activeGenRecipe.powerMW ?? m.basePowerMW) * purityFactor;
    if (activeGenRecipe.powerBoostPct) {
      const b = activeGenRecipe.powerBoostPct;
      const n = Math.max(
        1,
        Math.ceil((-500 + Math.sqrt(500 * 500 + 4 * 500 * b * parsedTargetMW)) / (1000 * b)),
      );
      return `~${n}× ${m.name} (${formatMW(n * 500 * (1 + n * b))} total)`;
    }
    const apaBoost =
      apaOption === '1-base'
        ? 0.1
        : apaOption === '1-matrix'
          ? 0.3
          : apaOption === '2-matrix'
            ? 0.6
            : 0;
    const apaBase =
      apaOption === 'none' ? 0 : apaOption === '2-matrix' ? 1000 : 500;
    const approxGens = Math.max(
      0.01,
      (parsedTargetMW / (1 + apaBoost) - apaBase) / Math.max(1, perGen),
    );
    if (approxGens < 1 && !m.noOverclock && approxGens >= 0.01) {
      return `1× ${m.name} @ ${formatRate(approxGens * 100)}% clock`;
    }
    return `~${formatRate(approxGens)}× ${m.name}${
      powerTargetMode === 'net' ? ' (+ parasitic offset)' : ''
    }`;
  }, [activeGenRecipe, selectedGenMachineId, geoPurity, parsedTargetMW, apaOption, powerTargetMode]);

  const handleSelectGeneratorMachine = (machineId: string) => {
    setSelectedGenMachineId(machineId);
    const list = POWER_RECIPES.filter((r) => r.producers.includes(machineId));
    // Default to Turbofuel on Fuel Gen, Coal on Coal Gen, Solid Biofuel on Biomass
    const preferred =
      list.find((r) => r.id === 'power-turbofuel') ??
      list.find((r) => r.id === 'power-coal') ??
      list.find((r) => r.id === 'power-solid-biofuel') ??
      list[0];
    if (preferred) {
      setSelectedGenRecipeId(preferred.id);
      const fid = getPrimaryFuelItemId(preferred);
      const routes = fid ? (RECIPES_BY_OUTPUT[fid] ?? []).filter((r) => !r.id.startsWith('unpackage-')) : [];
      setSelectedFuelRecipeId(routes[0]?.id ?? '');
    }
  };

  const handleSelectGeneratorFuel = (recipe: GameRecipe) => {
    setSelectedGenRecipeId(recipe.id);
    const fid = getPrimaryFuelItemId(recipe);
    const routes = fid
      ? (RECIPES_BY_OUTPUT[fid] ?? []).filter(
          (r) => !r.id.startsWith('unpackage-') && !r.isConverter,
        )
      : [];
    setSelectedFuelRecipeId(routes[0]?.id ?? '');
  };

  const commitPowerPlant = () => {
    if (!activeGenRecipe) return;
    const alienAugmenters =
      apaOption === 'none'
        ? undefined
        : apaOption === '1-base'
          ? { count: 1, fueled: false }
          : apaOption === '1-matrix'
            ? { count: 1, fueled: true }
            : { count: 2, fueled: true };

    onAutoBuildPower({
      generatorRecipeId: activeGenRecipe.id,
      targetMW: parsedTargetMW,
      targetMode: powerTargetMode,
      fuelRecipeId: activeFuelRouteId,
      purity: geoPurity,
      alienAugmenters,
      autoSinkByproducts,
      splitOverloaded,
    });
    onClose();
  };

  const results = useMemo<SearchEntry[]>(() => {
    if (mode === 'power') return [];
    if (mode === 'chain') {
      const scored = ITEM_LIST.filter((it) => (RECIPES_BY_OUTPUT[it.id]?.length ?? 0) > 0)
        .map((item) => ({
          type: 'item' as const,
          item,
          score: query.trim()
            ? fuzzyScore(query, item.name, item.id)
            : item.category === 'components'
              ? 20
              : item.category === 'project-assembly'
                ? 15
                : 10,
        }))
        .filter((e) => e.score > 0)
        .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
      return scored.slice(0, 40);
    }

    // Single node mode: logistics + all recipes
    const logEntries: SearchEntry[] = LOGISTICS_ENTRIES.map((l) => ({
      type: 'logistics' as const,
      ...l,
      score: query.trim() ? fuzzyScore(query, l.name, l.kind) : 90,
    })).filter((e) => e.score > 0);

    const recEntries: SearchEntry[] = RECIPES_LIST.map((recipe) => ({
      type: 'recipe' as const,
      recipe,
      score: query.trim()
        ? Math.max(
            fuzzyScore(query, recipe.name, recipe.id),
            ...Object.keys(recipe.out).map((oid) =>
              ITEMS[oid] ? fuzzyScore(query, ITEMS[oid].name, oid) * 0.85 : 0,
            ),
          )
        : recipe.isGenerator
          ? 22
          : recipe.isAlternate
            ? 8
            : 15,
    })).filter((e) => e.score > 0);

    return [...logEntries, ...recEntries]
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);
  }, [mode, query]);

  const clampedFocusIdx = Math.min(focusIdx, Math.max(0, results.length - 1));

  if (!open) return null;

  const commitEntry = (entry: SearchEntry | undefined) => {
    if (!entry) return;
    if (entry.type === 'item') {
      const parsed = evaluateMathExpr(rateDraft);
      const rate = parsed && parsed > 0 ? parsed : 10;
      onAutoBuildChain(entry.item.id, rate, splitOverloaded);
      onClose();
    } else if (entry.type === 'recipe') {
      onAddRecipeNode(entry.recipe.id);
      onClose();
    } else {
      onAddLogisticsNode(entry.kind);
      onClose();
    }
  };

  const cycleMode = () => {
    setMode((m) => (m === 'chain' ? 'power' : m === 'power' ? 'node' : 'chain'));
    setFocusIdx(0);
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="quick-palette-modal"
        className="palette-card"
        style={{ width: mode === 'power' ? 620 : 560 }}
        role="dialog"
        aria-modal="true"
        aria-label="Quick Factory & Power Plant Planner"
      >
        <div className="palette-mode-bar">
          <div className="segmented" style={{ maxWidth: 440 }}>
            <button
              id="palette-tab-chain"
              type="button"
              className={`segmented-btn ${mode === 'chain' ? 'active' : ''}`}
              onClick={() => {
                setMode('chain');
                setFocusIdx(0);
              }}
            >
              Auto-Build Item
            </button>
            <button
              id="palette-tab-power"
              type="button"
              className={`segmented-btn ${mode === 'power' ? 'active' : ''}`}
              onClick={() => {
                setMode('power');
                setFocusIdx(0);
              }}
            >
              <Zap size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 3 }} />
              Power Plant
            </button>
            <button
              id="palette-tab-node"
              type="button"
              className={`segmented-btn ${mode === 'node' ? 'active' : ''}`}
              onClick={() => {
                setMode('node');
                setFocusIdx(0);
              }}
            >
              Single Node
            </button>
          </div>
          <span className="kbd">Tab</span>
        </div>

        {/* ==================== POWER PLANT AUTO-PLANNER MODE ==================== */}
        {mode === 'power' ? (
          <div
            className="power-planner-body"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              } else if (e.key === 'Tab') {
                e.preventDefault();
                cycleMode();
              } else if (e.key === 'Enter') {
                e.preventDefault();
                commitPowerPlant();
              }
            }}
          >
            {/* Target Power Row */}
            <div className="power-target-row">
              <div className="power-input-group">
                <Zap size={15} style={{ color: 'var(--ok)' }} />
                <input
                  ref={powerInputRef}
                  id="power-target-input"
                  className="power-target-input mono"
                  value={powerDraft}
                  onChange={(e) => setPowerDraft(e.target.value)}
                  placeholder="15, 600, 15000..."
                  aria-label="Target power output"
                />
                <div className="segmented" style={{ width: 92 }}>
                  <button
                    type="button"
                    className={`segmented-btn ${powerUnit === 'MW' ? 'active' : ''}`}
                    style={{ height: 24, fontSize: 11 }}
                    onClick={() => setPowerUnit('MW')}
                  >
                    MW
                  </button>
                  <button
                    type="button"
                    className={`segmented-btn ${powerUnit === 'GW' ? 'active' : ''}`}
                    style={{ height: 24, fontSize: 11 }}
                    onClick={() => setPowerUnit('GW')}
                  >
                    GW
                  </button>
                </div>
              </div>

              <div className="segmented" style={{ width: 158 }}>
                <button
                  id="power-mode-gross"
                  type="button"
                  className={`segmented-btn ${powerTargetMode === 'gross' ? 'active' : ''}`}
                  title="Generator output equals target MW"
                  onClick={() => setPowerTargetMode('gross')}
                >
                  Gross MW
                </button>
                <button
                  id="power-mode-net"
                  type="button"
                  className={`segmented-btn ${powerTargetMode === 'net' ? 'active' : ''}`}
                  title="Net grid export equals target MW AFTER subtracting refineries, miners & extractors"
                  onClick={() => setPowerTargetMode('net')}
                >
                  Net MW
                </button>
              </div>
            </div>

            {/* Quick Presets */}
            <div className="preset-row" style={{ gap: 6 }}>
              {POWER_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={`preset-pill ${
                    powerDraft === p.value && powerUnit === p.unit ? 'active' : ''
                  }`}
                  onClick={() => {
                    setPowerDraft(p.value);
                    setPowerUnit(p.unit);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Generator Type Grid */}
            <div>
              <div className="section-label" style={{ marginBottom: 6 }}>
                <span>1. Generator Facility</span>
              </div>
              <div className="gen-grid">
                {GENERATOR_GROUPS.map((g) => (
                  <button
                    key={g.machineId}
                    type="button"
                    className={`gen-card ${selectedGenMachineId === g.machineId ? 'active' : ''}`}
                    onClick={() => handleSelectGeneratorMachine(g.machineId)}
                  >
                    <SpriteIcon iconId={g.icon} size={24} />
                    <div className="gen-card-info">
                      <span className="gen-card-name">{g.shortName}</span>
                      <span className="gen-card-mw mono">{g.mwLabel}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Fuel / Mode Selector */}
            {selectedGenMachineId === 'geothermal-generator' ? (
              <div>
                <div className="section-label" style={{ marginBottom: 6 }}>
                  <span>2. Geyser Purity</span>
                </div>
                <div className="segmented">
                  {(['impure', 'normal', 'pure'] as NodePurity[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`segmented-btn ${geoPurity === p ? 'active' : ''}`}
                      onClick={() => setGeoPurity(p)}
                    >
                      {p === 'impure'
                        ? 'Impure (100 MW avg)'
                        : p === 'normal'
                          ? 'Normal (200 MW avg)'
                          : 'Pure (400 MW avg)'}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <div className="section-label" style={{ marginBottom: 6 }}>
                  <span>2. Fuel / Operating Mode</span>
                </div>
                <div className="fuel-chip-wrap">
                  {genRecipesForMachine.map((r) => {
                    const fuelId = getPrimaryFuelItemId(r);
                    const fuelItem = fuelId ? ITEMS[fuelId] : undefined;
                    const label =
                      r.id === 'power-alien-base'
                        ? 'Unfueled (+10% Grid)'
                        : r.id === 'power-alien-boosted'
                          ? 'Alien Power Matrix (+30% Grid)'
                          : fuelItem?.name ?? r.name;
                    const active = activeGenRecipe?.id === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        className={`fuel-chip ${active ? 'active' : ''}`}
                        onClick={() => handleSelectGeneratorFuel(r)}
                      >
                        <SpriteIcon iconId={fuelItem?.icon ?? r.icon} size={17} />
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Fuel Production Recipe Route (e.g. Turbofuel vs Turbo Blend Fuel vs Turbo Heavy Fuel!) */}
            {fuelCraftRoutes.length > 1 && (
              <div>
                <div className="section-label" style={{ marginBottom: 6 }}>
                  <span>
                    3. {ITEMS[primaryFuelId ?? '']?.name ?? 'Fuel'} Production Recipe
                  </span>
                </div>
                <div className="route-grid">
                  {fuelCraftRoutes.map((route) => {
                    const active = activeFuelRouteId === route.id;
                    const cycles = 60 / route.time;
                    return (
                      <button
                        key={route.id}
                        type="button"
                        className={`recipe-option ${active ? 'active' : ''}`}
                        style={{ padding: '7px 9px' }}
                        onClick={() => setSelectedFuelRecipeId(route.id)}
                      >
                        <div className="recipe-option-head">
                          <span className="recipe-option-name" style={{ fontSize: 11.5 }}>
                            {route.name}
                          </span>
                          {route.isAlternate && <span className="alt-tag">ALT</span>}
                        </div>
                        <div className="recipe-io-line" style={{ fontSize: 10 }}>
                          {Object.entries(route.in).map(([iid, q]) => (
                            <span key={iid} className="recipe-io-chip">
                              <SpriteIcon iconId={ITEMS[iid]?.icon ?? iid} size={12} />
                              {formatRate(q * cycles)}
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Optional Alien Power Augmenter Grid Boost */}
            {selectedGenMachineId !== 'alien-power-augmenter' && (
              <div>
                <div className="section-label" style={{ marginBottom: 6 }}>
                  <span>Optional Alien Power Augmenter Boost</span>
                </div>
                <div className="segmented">
                  {(
                    [
                      { id: 'none', label: 'None' },
                      { id: '1-base', label: '+1 APA (+10%)' },
                      { id: '1-matrix', label: '+1 Matrix (+30%)' },
                      { id: '2-matrix', label: '+2 Matrix (+60%)' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`segmented-btn ${apaOption === opt.id ? 'active' : ''}`}
                      onClick={() => setApaOption(opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Bottom Action Bar */}
            <div className="power-action-footer">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11.5,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={autoSinkByproducts}
                    onChange={(e) => setAutoSinkByproducts(e.target.checked)}
                  />
                  <span>Auto-sink byproducts</span>
                </label>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11.5,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                  title="Split machines into parallel nodes when any pipe or belt exceeds your max tier"
                >
                  <input
                    type="checkbox"
                    checked={splitOverloaded}
                    onChange={(e) => setSplitOverloaded(e.target.checked)}
                  />
                  <span>Split overloaded pipes & belts</span>
                </label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ok)' }}>
                  {powerPreviewText}
                </span>
                <button
                  id="btn-generate-power-plant"
                  type="button"
                  className="btn btn-primary"
                  onClick={commitPowerPlant}
                >
                  <Sparkles size={13} />
                  <span>Build {formatMW(parsedTargetMW)} Plant</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* ==================== AUTO-BUILD ITEM & SINGLE NODE MODES ==================== */
          <>
            <div className="palette-search-row">
              <Search size={15} style={{ color: 'var(--accent)' }} />
              <input
                ref={inputRef}
                id="palette-search-input"
                className="palette-input"
                value={query}
                placeholder={
                  mode === 'chain'
                    ? 'Target item (e.g. Heavy Modular Frame, hmf, Ballistic Warp Drive)...'
                    : 'Search any recipe, alt, power generator, APA, splitter, merger...'
                }
                onChange={(e) => {
                  setQuery(e.target.value);
                  setFocusIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    onClose();
                  } else if (e.key === 'Tab') {
                    e.preventDefault();
                    cycleMode();
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setFocusIdx((i) => Math.min(results.length - 1, i + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setFocusIdx((i) => Math.max(0, i - 1));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    commitEntry(results[clampedFocusIdx]);
                  }
                }}
              />

              {mode === 'chain' && (
                <label
                  className="palette-rate-box"
                  title="Target output rate per minute (supports math like 60/2)"
                >
                  <input
                    id="palette-rate-input"
                    className="palette-rate-input"
                    value={rateDraft}
                    onChange={(e) => setRateDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitEntry(results[clampedFocusIdx]);
                      }
                    }}
                  />
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    /min
                  </span>
                </label>
              )}
            </div>

            {mode === 'chain' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 14px',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'var(--bg-surface)',
                }}
              >
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11.5,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                  title="Split machines into parallel nodes when any pipe or belt exceeds your max tier"
                >
                  <input
                    type="checkbox"
                    checked={splitOverloaded}
                    onChange={(e) => setSplitOverloaded(e.target.checked)}
                  />
                  <span>Split overloaded pipes & belts</span>
                </label>
              </div>
            )}

            <div className="palette-results">
              {results.length === 0 ? (
                <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)' }}>
                  No matching items or recipes found for "{query}".
                </div>
              ) : (
                results.map((entry, idx) => {
                  const focused = idx === clampedFocusIdx;
                  if (entry.type === 'item') {
                    const recCount = RECIPES_BY_OUTPUT[entry.item.id]?.length ?? 0;
                    return (
                      <button
                        key={`item-${entry.item.id}`}
                        type="button"
                        className={`palette-row ${focused ? 'focused' : ''}`}
                        onMouseEnter={() => setFocusIdx(idx)}
                        onClick={() => commitEntry(entry)}
                      >
                        <div className="palette-row-left">
                          <SpriteIcon iconId={entry.item.icon} size={26} />
                          <div>
                            <div className="palette-row-title">
                              <span>{entry.item.name}</span>
                              {entry.item.isFluid && (
                                <span
                                  className="alt-tag"
                                  style={{
                                    background: 'var(--fluid-dim)',
                                    color: 'var(--fluid)',
                                  }}
                                >
                                  FLUID
                                </span>
                              )}
                            </div>
                            <div className="palette-row-sub">
                              Build full chain · {recCount}{' '}
                              {recCount === 1 ? 'recipe' : 'recipes'} available
                            </div>
                          </div>
                        </div>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>
                          Build →
                        </span>
                      </button>
                    );
                  }

                  if (entry.type === 'logistics') {
                    const Icon =
                      entry.kind === 'splitter'
                        ? GitFork
                        : entry.kind === 'merger'
                          ? Merge
                          : entry.kind === 'input'
                            ? PackagePlus
                            : Trash2;
                    return (
                      <button
                        key={`log-${entry.kind}`}
                        type="button"
                        className={`palette-row ${focused ? 'focused' : ''}`}
                        onMouseEnter={() => setFocusIdx(idx)}
                        onClick={() => commitEntry(entry)}
                      >
                        <div className="palette-row-left">
                          <div
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: 6,
                              background: 'rgba(255,255,255,0.07)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'var(--accent)',
                              flexShrink: 0,
                            }}
                          >
                            <Icon size={15} />
                          </div>
                          <div>
                            <div className="palette-row-title">{entry.name}</div>
                            <div className="palette-row-sub">{entry.sub}</div>
                          </div>
                        </div>
                        <span className="dropdown-tier-badge">Logistics</span>
                      </button>
                    );
                  }

                  const r = entry.recipe;
                  const machine = MACHINES[r.producers[0]];
                  const cycles = 60 / r.time;
                  const outSummary = Object.entries(r.out)
                    .map(([id, q]) => `${formatRate(q * cycles)}/m ${ITEMS[id]?.name ?? id}`)
                    .join(' + ');
                  return (
                    <button
                      key={`rec-${r.id}`}
                      type="button"
                      className={`palette-row ${focused ? 'focused' : ''}`}
                      onMouseEnter={() => setFocusIdx(idx)}
                      onClick={() => commitEntry(entry)}
                    >
                      <div className="palette-row-left">
                        <SpriteIcon iconId={r.icon} size={26} />
                        <div>
                          <div className="palette-row-title">
                            <span>{r.name}</span>
                            {r.isAlternate && <span className="alt-tag">ALT</span>}
                            {r.isGenerator && (
                              <span className="gen-tag">
                                <Zap
                                  size={9}
                                  style={{ display: 'inline', verticalAlign: '-1px' }}
                                />{' '}
                                POWER
                              </span>
                            )}
                          </div>
                          <div className="palette-row-sub">
                            {machine?.name ?? r.producers[0]}
                            {outSummary ? ` · ${outSummary}` : ''}
                          </div>
                        </div>
                      </div>
                      {machine && (
                        <SpriteIcon iconId={machine.icon} size={20} title={machine.name} />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}

        <div className="palette-footer">
          <span>
            {mode === 'power'
              ? 'Tip: Type math or units like 15, 600, 15GW, or 250*8 · Switch Gross vs Net MW'
              : 'Tip: Shorthand works (hmf, rip, apa, geo, tf, rf, bwd)'}
          </span>
          <span>Tab Switch · Enter Build · Esc Close</span>
        </div>
      </div>
    </div>
  );
};
