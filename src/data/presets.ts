import {
  autoLayoutNodes,
  buildPowerPlant,
  buildProductionChain,
  createId,
  createRecipeNode,
} from '../engine/autoPlanner';
import type { FactoryEdge, FactoryNode, FactoryPlan, Outpost, PlanSettings } from '../engine/types';

export const DEFAULT_SETTINGS: PlanSettings = {
  theme: 'ficsit',
  maxBeltTier: 5,
  maxPipeTier: 2,
  recipeCostMultiplier: 1,
  powerMultiplier: 1,
  edgeStyle: 'bezier',
  snapToGrid: true,
  showBeltBadges: true,
  defaultMinerId: 'miner-mk2',
  defaultPurity: 'normal',
  preferredRecipes: {},
};

export interface FactoryTemplate {
  id: string;
  name: string;
  subtitle: string;
  tierLabel: string;
  accent: string;
  build: (settings: PlanSettings) => { nodes: FactoryNode[]; edges: FactoryEdge[] };
}

export const FACTORY_TEMPLATES: FactoryTemplate[] = [
  {
    id: 'starter-rip',
    name: 'Reinforced Iron Plates',
    subtitle: '10/min · Starter line with Cast Screws',
    tierLabel: 'Tier 1',
    accent: '#FA9549',
    build: (settings) =>
      buildProductionChain('reinforced-iron-plate', 10, {
        ...settings,
        preferredRecipes: {
          ...settings.preferredRecipes,
          screw: 'screw-cast',
        },
      }),
  },
  {
    id: 'hmf-alt',
    name: 'Heavy Modular Frames',
    subtitle: '10/min · Encased Pipe + Stitched Plate + Solid Steel',
    tierLabel: 'Tier 5',
    accent: '#F59E0B',
    build: (settings) =>
      buildProductionChain('heavy-modular-frame', 10, {
        ...settings,
        preferredRecipes: {
          ...settings.preferredRecipes,
          'heavy-modular-frame': 'heavy-modular-frame-encased',
          'encased-industrial-beam': 'encased-industrial-beam-pipe',
          'steel-ingot': 'steel-ingot-solid',
          'reinforced-iron-plate': 'reinforced-iron-plate-stitched',
          wire: 'wire-iron',
        },
      }),
  },
  {
    id: 'rocket-fuel-power',
    name: 'Nitro Rocket Fuel Power',
    subtitle: '30 GW · Diluted Fuel → Nitro Rocket Fuel → 120 Generators',
    tierLabel: 'Tier 8',
    accent: '#38BDF8',
    build: (settings) => {
      const oil = createRecipeNode('crude-oil', 0, 0, settings, {
        machineId: 'oil-extractor',
        purity: 'pure',
      });
      const hor = createRecipeNode('heavy-oil-residue', 0, 0, settings);
      const water = createRecipeNode('water', 0, 0, settings, {
        machineId: 'water-extractor',
      });
      const dilFuel = createRecipeNode('fuel-diluted', 0, 0, settings);
      const nitrogen = createRecipeNode('nitrogen-gas', 0, 0, settings, {
        machineId: 'resource-well-extractor',
        purity: 'pure',
      });
      const sulfur = createRecipeNode('sulfur', 0, 0, settings, {
        machineId: 'miner-mk3',
        purity: 'pure',
      });
      const coal = createRecipeNode('coal', 0, 0, settings, {
        machineId: 'miner-mk3',
        purity: 'pure',
      });
      const nitro = createRecipeNode('rocket-fuel-nitro', 0, 0, settings);
      const gens = createRecipeNode('power-rocket-fuel', 0, 0, settings, {
        pinMode: 'machines',
        pinnedValue: 120,
      });
      const resinSink: FactoryNode = {
        id: createId('n'),
        kind: 'sink',
        x: 0,
        y: 0,
        clockSpeed: 100,
        somersloops: 0,
        purity: 'normal',
        pinMode: 'auto',
        pinnedValue: 1,
        itemId: 'polymer-resin',
        label: 'Sink Resin',
        built: false,
      };
      const coalSink: FactoryNode = {
        id: createId('n'),
        kind: 'sink',
        x: 0,
        y: 0,
        clockSpeed: 100,
        somersloops: 0,
        purity: 'normal',
        pinMode: 'auto',
        pinnedValue: 1,
        itemId: 'compacted-coal',
        label: 'Sink Byproduct',
        built: false,
      };

      const nodes = [oil, hor, water, dilFuel, nitrogen, sulfur, coal, nitro, gens, resinSink, coalSink];
      const edges: FactoryEdge[] = [
        { id: createId('e'), sourceNodeId: oil.id, sourceItemId: 'crude-oil', targetNodeId: hor.id, targetItemId: 'crude-oil' },
        { id: createId('e'), sourceNodeId: hor.id, sourceItemId: 'heavy-oil-residue', targetNodeId: dilFuel.id, targetItemId: 'heavy-oil-residue' },
        { id: createId('e'), sourceNodeId: hor.id, sourceItemId: 'polymer-resin', targetNodeId: resinSink.id, targetItemId: 'polymer-resin' },
        { id: createId('e'), sourceNodeId: water.id, sourceItemId: 'water', targetNodeId: dilFuel.id, targetItemId: 'water' },
        { id: createId('e'), sourceNodeId: dilFuel.id, sourceItemId: 'fuel', targetNodeId: nitro.id, targetItemId: 'fuel' },
        { id: createId('e'), sourceNodeId: nitrogen.id, sourceItemId: 'nitrogen-gas', targetNodeId: nitro.id, targetItemId: 'nitrogen-gas' },
        { id: createId('e'), sourceNodeId: sulfur.id, sourceItemId: 'sulfur', targetNodeId: nitro.id, targetItemId: 'sulfur' },
        { id: createId('e'), sourceNodeId: coal.id, sourceItemId: 'coal', targetNodeId: nitro.id, targetItemId: 'coal' },
        { id: createId('e'), sourceNodeId: nitro.id, sourceItemId: 'rocket-fuel', targetNodeId: gens.id, targetItemId: 'rocket-fuel' },
        { id: createId('e'), sourceNodeId: nitro.id, sourceItemId: 'compacted-coal', targetNodeId: coalSink.id, targetItemId: 'compacted-coal' },
      ];
      return { nodes: autoLayoutNodes(nodes, edges), edges };
    },
  },
  {
    id: 'aluminum-loop',
    name: 'Closed-Loop Aluminum',
    subtitle: '360/min Ingots · Sloppy Alumina + Water Recycling Loop',
    tierLabel: 'Tier 7',
    accent: '#34D399',
    build: (settings) => {
      const bauxite = createRecipeNode('bauxite', 0, 0, settings, {
        machineId: 'miner-mk3',
        purity: 'pure',
      });
      const waterExt = createRecipeNode('water', 0, 0, settings, {
        machineId: 'water-extractor',
      });
      const waterMerger: FactoryNode = {
        id: createId('n'),
        kind: 'merger',
        x: 0,
        y: 0,
        clockSpeed: 100,
        somersloops: 0,
        purity: 'normal',
        pinMode: 'auto',
        pinnedValue: 1,
        itemId: 'water',
        label: 'Water Loop',
        built: false,
      };
      const oil = createRecipeNode('crude-oil', 0, 0, settings, {
        machineId: 'oil-extractor',
        purity: 'normal',
      });
      const hor = createRecipeNode('heavy-oil-residue', 0, 0, settings);
      const coke = createRecipeNode('petroleum-coke', 0, 0, settings);
      const alumina = createRecipeNode('alumina-solution-sloppy', 0, 0, settings);
      const scrap = createRecipeNode('aluminum-scrap-electrode', 0, 0, settings);
      const ingot = createRecipeNode('aluminum-ingot-pure', 0, 0, settings, {
        pinMode: 'output',
        pinnedValue: 360,
      });
      const resinSink: FactoryNode = {
        id: createId('n'),
        kind: 'sink',
        x: 0,
        y: 0,
        clockSpeed: 100,
        somersloops: 0,
        purity: 'normal',
        pinMode: 'auto',
        pinnedValue: 1,
        itemId: 'polymer-resin',
        label: 'Sink Resin',
        built: false,
      };

      const nodes = [bauxite, waterExt, waterMerger, oil, hor, coke, alumina, scrap, ingot, resinSink];
      const edges: FactoryEdge[] = [
        { id: createId('e'), sourceNodeId: bauxite.id, sourceItemId: 'bauxite', targetNodeId: alumina.id, targetItemId: 'bauxite' },
        { id: createId('e'), sourceNodeId: waterExt.id, sourceItemId: 'water', targetNodeId: waterMerger.id, targetItemId: 'water' },
        { id: createId('e'), sourceNodeId: scrap.id, sourceItemId: 'water', targetNodeId: waterMerger.id, targetItemId: 'water' },
        { id: createId('e'), sourceNodeId: waterMerger.id, sourceItemId: 'water', targetNodeId: alumina.id, targetItemId: 'water' },
        { id: createId('e'), sourceNodeId: alumina.id, sourceItemId: 'alumina-solution', targetNodeId: scrap.id, targetItemId: 'alumina-solution' },
        { id: createId('e'), sourceNodeId: oil.id, sourceItemId: 'crude-oil', targetNodeId: hor.id, targetItemId: 'crude-oil' },
        { id: createId('e'), sourceNodeId: hor.id, sourceItemId: 'heavy-oil-residue', targetNodeId: coke.id, targetItemId: 'heavy-oil-residue' },
        { id: createId('e'), sourceNodeId: hor.id, sourceItemId: 'polymer-resin', targetNodeId: resinSink.id, targetItemId: 'polymer-resin' },
        { id: createId('e'), sourceNodeId: coke.id, sourceItemId: 'petroleum-coke', targetNodeId: scrap.id, targetItemId: 'petroleum-coke' },
        { id: createId('e'), sourceNodeId: scrap.id, sourceItemId: 'aluminum-scrap', targetNodeId: ingot.id, targetItemId: 'aluminum-scrap' },
      ];
      return { nodes: autoLayoutNodes(nodes, edges), edges };
    },
  },
  {
    id: 'turbofuel-15gw',
    name: 'Turbofuel Power (15 GW)',
    subtitle: '15 GW Gross · 60 Fuel Generators via Turbo Blend Fuel',
    tierLabel: 'Tier 6',
    accent: '#E27620',
    build: (settings) =>
      buildPowerPlant(
        {
          generatorRecipeId: 'power-turbofuel',
          targetMW: 15000,
          targetMode: 'gross',
          fuelRecipeId: 'turbofuel-blend',
          autoSinkByproducts: true,
        },
        settings,
      ),
  },
  {
    id: 'nuclear-apa-grid',
    name: 'Nuclear + Alien Power Grid',
    subtitle: '33.15 GW · 10 Uranium Plants + Fueled Alien Power Augmenter (+30%)',
    tierLabel: 'Tier 9',
    accent: '#B083CC',
    build: (settings) =>
      buildPowerPlant(
        {
          generatorRecipeId: 'uranium-waste',
          targetMW: 33150,
          targetMode: 'gross',
          alienAugmenters: { count: 1, fueled: true },
          autoSinkByproducts: true,
        },
        settings,
      ),
  },
  {
    id: 'tier9-quantum',
    name: 'Neural-Quantum Processor',
    subtitle: '3/min · Tier 9 Quantum Encoder & Dark Matter chain',
    tierLabel: 'Tier 9',
    accent: '#B083CC',
    build: (settings) =>
      buildProductionChain('neural-quantum-processor', 3, settings),
  },
  {
    id: 'empty',
    name: 'Blank Blueprint',
    subtitle: 'Empty canvas. Press Space to add nodes.',
    tierLabel: 'Empty',
    accent: '#76736A',
    build: () => ({ nodes: [], edges: [] }),
  },
];

export function createInitialPlan(): FactoryPlan {
  const starter = FACTORY_TEMPLATES[0].build(DEFAULT_SETTINGS);
  const aluminum = FACTORY_TEMPLATES[3].build(DEFAULT_SETTINGS);

  const outpost1: Outpost = {
    id: 'outpost_main',
    name: 'Reinforced Plates',
    accent: '#E27620',
    nodes: starter.nodes,
    edges: starter.edges,
    viewport: { x: 48, y: 120, zoom: 0.92 },
  };
  const outpost2: Outpost = {
    id: 'outpost_aluminum',
    name: 'Aluminum Loop',
    accent: '#4EA36D',
    nodes: aluminum.nodes,
    edges: aluminum.edges,
    viewport: { x: 40, y: 110, zoom: 0.72 },
  };

  return {
    version: 1,
    activeOutpostId: outpost1.id,
    outposts: [outpost1, outpost2],
    settings: DEFAULT_SETTINGS,
  };
}
