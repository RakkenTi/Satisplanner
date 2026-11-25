export type NodePurity = 'impure' | 'normal' | 'pure';

export const PURITY_MULTIPLIER: Record<NodePurity, number> = {
  impure: 0.5,
  normal: 1.0,
  pure: 2.0,
};

export interface GameItem {
  id: string;
  name: string;
  category: 'resources' | 'components' | 'equipment' | 'project-assembly';
  icon: string;
  isFluid: boolean;
  row: number;
}

export interface GameMachine {
  id: string;
  name: string;
  icon: string;
  speed: number;
  basePowerMW: number; // positive = consumption, negative = generation
  somersloopSlots: number;
  isExtractor: boolean;
  supportsPurity: boolean;
  isGenerator: boolean;
  noOverclock?: boolean;
  buildSomersloops?: number; // e.g. 10 Somersloops to construct an Alien Power Augmenter
  variablePowerMW?: [number, number];
}

export interface GameRecipe {
  id: string;
  name: string;
  category: string;
  producers: string[];
  time: number; // seconds per cycle at 1.0x speed
  in: Record<string, number>;
  out: Record<string, number>;
  icon: string;
  isAlternate: boolean;
  isExtractor: boolean;
  isGenerator: boolean;
  isConverter: boolean;
  noCostMultiplier: boolean;
  powerMW?: number;
  powerBoostPct?: number; // e.g. 0.10 or 0.30 for Alien Power Augmenter
}

export interface BeltSpec {
  id: string;
  tier: number;
  name: string;
  fullName: string;
  ratePerMin: number;
  icon: string;
}

export interface IconSprite {
  x: number;
  y: number;
  color: string;
}

export interface SatisfactoryDataset {
  gameVersion: string;
  spriteSheet: { width: number; height: number; tileSize: number };
  items: Record<string, GameItem>;
  machines: Record<string, GameMachine>;
  recipes: GameRecipe[];
  belts: BeltSpec[];
  pipes: BeltSpec[];
  icons: Record<string, IconSprite>;
}

export type NodeKind = 'recipe' | 'splitter' | 'merger' | 'input' | 'sink';

export type PinMode = 'auto' | 'machines' | 'output';

export type SplitterMode = 'demand' | 'even' | 'priority';

export interface FactoryNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  // Recipe node properties
  recipeId?: string;
  machineId?: string;
  clockSpeed: number; // 1 to 250 (%)
  somersloops: number; // 0 to machine.somersloopSlots
  purity: NodePurity;
  pinMode: PinMode;
  pinnedValue: number; // machines count if pinMode='machines', primary output/min if pinMode='output'
  // Logistics / Input / Sink node properties
  itemId?: string; // for splitter, merger, input, sink (optional for auto-detect)
  ratePerMin?: number; // for 'input' node (supply rate) or 'sink' optional cap
  splitterMode?: SplitterMode;
  label?: string;
  built: boolean;
}

export interface FactoryEdge {
  id: string;
  sourceNodeId: string;
  sourceItemId: string;
  targetNodeId: string;
  targetItemId: string;
  priority?: number; // used by priority splitters (lower = higher priority)
}

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export interface Outpost {
  id: string;
  name: string;
  accent: string;
  nodes: FactoryNode[];
  edges: FactoryEdge[];
  viewport: ViewportState;
}

export type ThemeId = 'ficsit' | 'paper' | 'blueprint';

export interface PlanSettings {
  theme: ThemeId;
  maxBeltTier: number; // 1..6
  maxPipeTier: number; // 1..2
  recipeCostMultiplier: number; // Satisfactory 1.2 Game Mode: 0.25..2.0
  powerMultiplier: number; // Satisfactory 1.2 Game Mode: 0.25..5.0
  edgeStyle: 'bezier' | 'orthogonal';
  snapToGrid: boolean;
  showBeltBadges: boolean;
  defaultMinerId: 'miner-mk1' | 'miner-mk2' | 'miner-mk3';
  defaultPurity: NodePurity;
  preferredRecipes: Record<string, string>; // itemId -> recipeId
}

export interface FactoryPlan {
  version: number;
  activeOutpostId: string;
  outposts: Outpost[];
  settings: PlanSettings;
}

// --- Solver Output Types ---

export type PortStatus = 'balanced' | 'starved' | 'surplus' | 'disconnected';

export interface SolvedPort {
  itemId: string;
  required: number; // items/min needed (input) or produced (output)
  actual: number; // items/min actually flowing via edges
  status: PortStatus;
  connectedEdgeIds: string[];
}

export interface SolvedNode {
  nodeId: string;
  machines: number; // fractional machine count (e.g. 2.667)
  machinesCeil: number;
  effectiveClock: number; // %
  powerMW: number; // positive = consumed, negative = generated
  powerShards: number;
  somersloopsTotal: number;
  inputs: Record<string, SolvedPort>;
  outputs: Record<string, SolvedPort>;
  efficiency: number; // 0..1 ratio of supplied inputs vs required
  isBottlenecked: boolean;
  hasSurplus: boolean;
}

export interface SolvedEdge {
  edgeId: string;
  itemId: string;
  isFluid: boolean;
  flowRate: number; // items/min or m3/min
  minTierName: string; // e.g. 'Mk.3' or 'Pipe Mk.1'
  minTierRate: number;
  beltCountAtMax: number; // how many belts of maxBeltTier needed
  loadRatioAtMax: number; // flowRate / maxTierRate
  overLimit: boolean; // exceeds user's maxBeltTier / maxPipeTier
  status: 'ok' | 'warning' | 'overlimit' | 'idle';
}

export interface BuildingSummaryItem {
  machineId: string;
  name: string;
  icon: string;
  exactCount: number;
  wholeCount: number;
  builtCount: number;
  powerMW: number;
  shards: number;
  somersloops: number;
}

export interface ResourceFlowSummary {
  itemId: string;
  name: string;
  icon: string;
  isFluid: boolean;
  ratePerMin: number;
}

export interface SolvedFactory {
  nodes: Record<string, SolvedNode>;
  edges: Record<string, SolvedEdge>;
  totalPowerConsumedMW: number;
  basePowerGeneratedMW: number;
  powerBoostPct: number; // e.g. 0.10 for +10%, 0.30 for +30%
  powerBoostMW: number;
  totalPowerGeneratedMW: number;
  netPowerMW: number;
  totalMachines: number;
  totalBuiltNodes: number;
  totalNodes: number;
  totalPowerShards: number;
  totalSomersloops: number;
  buildings: BuildingSummaryItem[];
  rawInputs: ResourceFlowSummary[];
  netOutputs: ResourceFlowSummary[];
  unhandledByproducts: ResourceFlowSummary[];
  missingInputs: ResourceFlowSummary[];
}
