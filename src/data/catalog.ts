import rawData from './satisfactoryData.json';
import type {
  BeltSpec,
  GameItem,
  GameMachine,
  GameRecipe,
  IconSprite,
  SatisfactoryDataset,
} from '../engine/types';

export const DATASET = rawData as unknown as SatisfactoryDataset;

export const ITEMS: Record<string, GameItem> = DATASET.items;
export const ITEM_LIST: GameItem[] = Object.values(ITEMS).sort((a, b) =>
  a.name.localeCompare(b.name),
);

export const MACHINES: Record<string, GameMachine> = DATASET.machines;
export const BELTS: BeltSpec[] = DATASET.belts;
export const PIPES: BeltSpec[] = DATASET.pipes;
export const ICONS: Record<string, IconSprite> = DATASET.icons;

export const RECIPES_LIST: GameRecipe[] = DATASET.recipes;
export const RECIPES: Record<string, GameRecipe> = Object.fromEntries(
  RECIPES_LIST.map((r) => [r.id, r]),
);

// Index recipes by output item & input item
export const RECIPES_BY_OUTPUT: Record<string, GameRecipe[]> = {};
export const RECIPES_BY_INPUT: Record<string, GameRecipe[]> = {};

for (const r of RECIPES_LIST) {
  for (const outId of Object.keys(r.out)) {
    if (!RECIPES_BY_OUTPUT[outId]) RECIPES_BY_OUTPUT[outId] = [];
    RECIPES_BY_OUTPUT[outId].push(r);
  }
  for (const inId of Object.keys(r.in)) {
    if (!RECIPES_BY_INPUT[inId]) RECIPES_BY_INPUT[inId] = [];
    RECIPES_BY_INPUT[inId].push(r);
  }
}

// Sort recipes per item: Default recipes first, then Alternates, then Unpackage/Converter last
function recipeSortRank(r: GameRecipe, targetItemId?: string): number {
  if (r.isExtractor) return 0;
  if (r.id === targetItemId) return 1;
  if (!r.isAlternate && !r.id.startsWith('unpackage-') && !r.isConverter) return 2;
  if (r.isAlternate && !r.isConverter) return 3;
  if (r.id.startsWith('unpackage-')) return 4;
  return 5;
}

for (const [itemId, list] of Object.entries(RECIPES_BY_OUTPUT)) {
  list.sort(
    (a, b) =>
      recipeSortRank(a, itemId) - recipeSortRank(b, itemId) ||
      a.name.localeCompare(b.name),
  );
}
for (const list of Object.values(RECIPES_BY_INPUT)) {
  list.sort((a, b) => {
    const altDiff = Number(a.isAlternate) - Number(b.isAlternate);
    if (altDiff !== 0) return altDiff;
    const genDiff = Number(a.isGenerator) - Number(b.isGenerator);
    if (genDiff !== 0) return genDiff;
    return a.name.localeCompare(b.name);
  });
}

export const RAW_RESOURCE_IDS = new Set<string>([
  'iron-ore',
  'copper-ore',
  'limestone',
  'coal',
  'water',
  'crude-oil',
  'caterium-ore',
  'bauxite',
  'raw-quartz',
  'sulfur',
  'uranium',
  'nitrogen-gas',
  'sam-ore',
  'wood',
  'leaves',
  'mycelia',
]);

// Common Satisfactory player shorthand acronyms for instant search
const ACRONYMS: Record<string, string[]> = {
  hmf: ['heavy-modular-frame', 'heavy-modular-frame-encased', 'heavy-modular-frame-flexible'],
  fmf: ['fused-modular-frame', 'fused-modular-frame-heat'],
  rip: ['reinforced-iron-plate', 'reinforced-iron-plate-stitched', 'reinforced-iron-plate-bolted', 'reinforced-iron-plate-adhered'],
  eib: ['encased-industrial-beam', 'encased-industrial-beam-pipe'],
  hor: ['heavy-oil-residue'],
  rcu: ['radio-control-unit', 'radio-control-unit-system', 'radio-control-unit-connection'],
  hsc: ['high-speed-connector', 'high-speed-connector-silicon'],
  ads: ['assembly-director-system'],
  mfg: ['magnetic-field-generator'],
  tpr: ['thermal-propulsion-rocket'],
  bwd: ['ballistic-warp-drive'],
  nqp: ['neural-quantum-processor'],
  dmr: ['dark-matter-residue'],
  dmc: ['dark-matter-crystal'],
  epm: ['excited-photonic-matter'],
  ecr: ['electromagnetic-control-rod'],
  pcc: ['pressure-conversion-cube'],
  acu: ['adaptive-control-unit'],
  ufr: ['uranium-fuel-rod'],
  pfr: ['plutonium-fuel-rod'],
  ffr: ['ficsonium-fuel-rod'],
  apm: ['alien-power-matrix'],
  ai: ['ai-limiter', 'ai-expansion-server'],
  sam: ['sam-ore', 'reanimated-sam', 'sam-fluctuator'],
  df: ['fuel-diluted', 'packaged-fuel-diluted'],
  nrf: ['rocket-fuel-nitro'],
  apa: ['power-alien-base', 'power-alien-boosted', 'alien-power-matrix'],
  geo: ['power-geothermal'],
  tf: ['power-turbofuel', 'turbofuel', 'turbofuel-blend', 'turbofuel-heavy'],
  rf: ['power-rocket-fuel', 'rocket-fuel', 'rocket-fuel-nitro'],
  bio: ['power-solid-biofuel', 'power-biomass', 'power-liquid-biofuel'],
};

export const POWER_RECIPES: GameRecipe[] = RECIPES_LIST.filter((r) => r.isGenerator);

/**
 * Returns the primary fuel item consumed by a generator recipe (excluding water),
 * or undefined for fuel-free generators (Geothermal, unfueled Alien Power Augmenter).
 */
export function getPrimaryFuelItemId(recipe: GameRecipe): string | undefined {
  const ins = Object.keys(recipe.in);
  if (ins.length === 0) return undefined;
  return ins.find((id) => id !== 'water') ?? ins[0];
}

/**
 * Fast, forgiving search score supporting exact prefix, substring,
 * word-initials acronym matching (e.g. "hmf" -> "Heavy Modular Frame"),
 * and community shorthand.
 */
export function fuzzyScore(query: string, name: string, id: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const n = name.toLowerCase();
  const idLow = id.toLowerCase();

  // Shorthand acronym exact hit
  const mapped = ACRONYMS[q];
  if (mapped && mapped.includes(idLow)) return 120;

  if (n === q || idLow === q) return 110;
  if (n.startsWith(q)) return 95;

  // Word-start acronym match (e.g. "rip" matches "Reinforced Iron Plate")
  const words = n.split(/[\s\-()]+/).filter(Boolean);
  const initials = words.map((w) => w[0]).join('');
  if (initials.startsWith(q)) return 88;

  // Multi-token substring match (e.g. "iron plate" or "dil fuel")
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((t) => n.includes(t) || idLow.includes(t))) {
    return 80;
  }

  const idx = n.indexOf(q);
  if (idx !== -1) return 75 - Math.min(idx, 20);

  if (idLow.includes(q)) return 55;

  // Subsequence fuzzy match
  let qi = 0;
  for (let i = 0; i < n.length && qi < q.length; i++) {
    if (n[i] === q[qi]) qi++;
  }
  if (qi === q.length) return 30;

  return 0;
}

export function getDefaultRecipeForItem(
  itemId: string,
  preferredRecipes?: Record<string, string>,
): GameRecipe | undefined {
  if (preferredRecipes?.[itemId] && RECIPES[preferredRecipes[itemId]]) {
    return RECIPES[preferredRecipes[itemId]];
  }
  const candidates = RECIPES_BY_OUTPUT[itemId];
  if (!candidates || candidates.length === 0) return undefined;
  // Prefer extractor for raw resources
  const ext = candidates.find((r) => r.isExtractor);
  if (ext) return ext;
  // Exact id default recipe
  const exact = candidates.find((r) => r.id === itemId && !r.isAlternate);
  if (exact) return exact;
  // First non-alternate non-unpackage recipe
  const def = candidates.find(
    (r) => !r.isAlternate && !r.id.startsWith('unpackage-') && !r.isConverter,
  );
  return def ?? candidates[0];
}

export function getDefaultMachineForRecipe(
  recipe: GameRecipe,
  defaultMinerId: 'miner-mk1' | 'miner-mk2' | 'miner-mk3' = 'miner-mk2',
): string {
  if (recipe.producers.includes(defaultMinerId)) return defaultMinerId;
  return recipe.producers[0];
}

export function getPrimaryOutputItemId(recipe: GameRecipe): string | undefined {
  const keys = Object.keys(recipe.out);
  if (keys.length === 0) return undefined;
  if (recipe.out[recipe.id] !== undefined) return recipe.id;
  return keys[0];
}

export function getBeltForRate(ratePerMin: number, isFluid: boolean): BeltSpec {
  const list = isFluid ? PIPES : BELTS;
  for (const b of list) {
    if (ratePerMin <= b.ratePerMin + 1e-6) return b;
  }
  return list[list.length - 1];
}

export function getMaxBeltSpec(tier: number, isFluid: boolean): BeltSpec {
  const list = isFluid ? PIPES : BELTS;
  return list.find((b) => b.tier === tier) ?? list[list.length - 1];
}

export function formatRate(val: number): string {
  if (!Number.isFinite(val)) return '0';
  if (Math.abs(val) < 1e-4) return '0';
  if (Math.abs(val - Math.round(val)) < 0.005) return String(Math.round(val));
  if (Math.abs(val) >= 100) return val.toFixed(1).replace(/\.0$/, '');
  return val.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatMW(mw: number): string {
  const abs = Math.abs(mw);
  const sign = mw < -1e-4 ? '+' : '';
  if (abs >= 1000) {
    return `${sign}${(abs / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} GW`;
  }
  return `${sign}${formatRate(abs)} MW`;
}
