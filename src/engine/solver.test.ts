import { describe, expect, it } from 'vitest';
import { buildPowerPlant, buildProductionChain, createRecipeNode } from './autoPlanner';
import { evaluateMathExpr } from './expr';
import { solveFactory } from './solver';
import type { FactoryEdge, FactoryNode, PlanSettings } from './types';

const DEFAULT_SETTINGS: PlanSettings = {
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

describe('evaluateMathExpr', () => {
  it('evaluates basic and nested arithmetic expressions', () => {
    expect(evaluateMathExpr('480/2')).toBe(240);
    expect(evaluateMathExpr('3 * 60 + 15')).toBe(195);
    expect(evaluateMathExpr('(120 + 60) / 3')).toBe(60);
    expect(evaluateMathExpr('7.5 * 4')).toBe(30);
    expect(evaluateMathExpr('10 / 0')).toBeNull();
    expect(evaluateMathExpr('abc')).toBeNull();
  });
});

describe('solveFactory', () => {
  it('solves a Reinforced Iron Plate 10/min pull chain accurately', () => {
    const { nodes, edges } = buildProductionChain(
      'reinforced-iron-plate',
      10,
      DEFAULT_SETTINGS,
    );
    const solved = solveFactory(nodes, edges, DEFAULT_SETTINGS);

    // 10/min RIP = 2 Assemblers (5/min each)
    const ripNode = nodes.find((n) => n.recipeId === 'reinforced-iron-plate')!;
    expect(solved.nodes[ripNode.id].machines).toBeCloseTo(2, 4);
    expect(solved.nodes[ripNode.id].outputs['reinforced-iron-plate'].required).toBeCloseTo(10, 4);

    // Needs 60/min Iron Plates (3 Constructors @ 20/min) + 120/min Screws (3 Constructors @ 40/min)
    const plateNode = nodes.find((n) => n.recipeId === 'iron-plate')!;
    const screwNode = nodes.find((n) => n.recipeId === 'screw')!;
    const rodNode = nodes.find((n) => n.recipeId === 'iron-rod')!;
    const ingotNode = nodes.find((n) => n.recipeId === 'iron-ingot')!;
    const oreNode = nodes.find((n) => n.recipeId === 'iron-ore')!;

    expect(solved.nodes[plateNode.id].machines).toBeCloseTo(3, 4);
    expect(solved.nodes[screwNode.id].machines).toBeCloseTo(3, 4);
    // 120/min screws need 30/min rods = 2 Constructors @ 15/min
    expect(solved.nodes[rodNode.id].machines).toBeCloseTo(2, 4);
    // 60/min plates need 90/min ingots; 30/min rods need 30/min ingots => 120/min ingots = 4 Smelters
    expect(solved.nodes[ingotNode.id].machines).toBeCloseTo(4, 4);
    // 120/min Iron Ore = 1 Normal Miner Mk.2
    expect(solved.nodes[oreNode.id].machines).toBeCloseTo(1, 4);
    expect(solved.missingInputs).toHaveLength(0);
  });

  it('computes exact Satisfactory 1.0/1.2 overclocking and Somersloop power & output scaling', () => {
    // Assembler base power = 15 MW, 2 Somersloop slots
    const n = createRecipeNode('reinforced-iron-plate', 0, 0, DEFAULT_SETTINGS, {
      pinMode: 'machines',
      pinnedValue: 1,
      clockSpeed: 200, // 2.0^1.321928 = 2.5x power, 2 power shards
      somersloops: 2, // 2x output, 4x power
    });
    const solved = solveFactory([n], [], DEFAULT_SETTINGS);
    const sn = solved.nodes[n.id];

    // Base output = 5/min * 2 (clock) * 2 (sloops) = 20/min
    expect(sn.outputs['reinforced-iron-plate'].required).toBeCloseTo(20, 4);
    // Base iron plate input = 30/min * 2 (clock) * 1 (sloops don't multiply inputs!) = 60/min
    expect(sn.inputs['iron-plate'].required).toBeCloseTo(60, 4);
    // Power = 15 * 2.5 * 4 = 150 MW
    expect(sn.powerMW).toBeCloseTo(150, 1);
    expect(sn.powerShards).toBe(2);
    expect(sn.somersloopsTotal).toBe(2);
  });

  it('applies Satisfactory 1.2 Game Mode Recipe Cost Multiplier to recipe inputs only', () => {
    const settings2x: PlanSettings = {
      ...DEFAULT_SETTINGS,
      recipeCostMultiplier: 2,
    };
    const { nodes, edges } = buildProductionChain('iron-plate', 20, settings2x);
    const solved = solveFactory(nodes, edges, settings2x);

    const plateNode = nodes.find((n) => n.recipeId === 'iron-plate')!;
    const ingotNode = nodes.find((n) => n.recipeId === 'iron-ingot')!;
    const oreNode = nodes.find((n) => n.recipeId === 'iron-ore')!;

    // 1 Constructor makes 20/min plates, now needing 60/min ingots (2x normal 30/min)
    expect(solved.nodes[plateNode.id].inputs['iron-ingot'].required).toBeCloseTo(60, 4);
    // 2 Smelters make 60/min ingots, needing 120/min Iron Ore (2x normal 60/min)
    expect(solved.nodes[ingotNode.id].inputs['iron-ore'].required).toBeCloseTo(120, 4);
    // Extractor has noCostMultiplier -> still 1 Normal Mk.2 for 120/min
    expect(solved.nodes[oreNode.id].machines).toBeCloseTo(1, 4);
  });

  it('solves closed-loop Aluminum water recycling with exact fresh water top-up', () => {
    // 1 Refinery Sloppy Alumina: 200 Bauxite + 200 Water -> 240 Alumina Solution
    // 1 Refinery Electrode Aluminum Scrap: 180 Alumina + 60 Coke -> 300 Scrap + 105 Water
    // At 180/min Alumina (0.75 Sloppy Alumina): needs 150 Water total.
    // Scrap recycles 105 Water -> Fresh Water Extractor only needs 45 Water (0.375 extractors)!
    const waterExt = createRecipeNode('water', 0, 0, DEFAULT_SETTINGS);
    const merger: FactoryNode = {
      id: 'm_water',
      kind: 'merger',
      x: 200,
      y: 0,
      clockSpeed: 100,
      somersloops: 0,
      purity: 'normal',
      pinMode: 'auto',
      pinnedValue: 1,
      itemId: 'water',
      built: false,
    };
    const alumina = createRecipeNode('alumina-solution-sloppy', 400, 0, DEFAULT_SETTINGS);
    const scrap = createRecipeNode('aluminum-scrap-electrode', 700, 0, DEFAULT_SETTINGS, {
      pinMode: 'machines',
      pinnedValue: 1,
    });

    const edges: FactoryEdge[] = [
      { id: 'e1', sourceNodeId: waterExt.id, sourceItemId: 'water', targetNodeId: merger.id, targetItemId: 'water' },
      { id: 'e2', sourceNodeId: scrap.id, sourceItemId: 'water', targetNodeId: merger.id, targetItemId: 'water' },
      { id: 'e3', sourceNodeId: merger.id, sourceItemId: 'water', targetNodeId: alumina.id, targetItemId: 'water' },
      { id: 'e4', sourceNodeId: alumina.id, sourceItemId: 'alumina-solution', targetNodeId: scrap.id, targetItemId: 'alumina-solution' },
    ];

    const solved = solveFactory([waterExt, merger, alumina, scrap], edges, DEFAULT_SETTINGS);
    expect(solved.nodes[alumina.id].machines).toBeCloseTo(0.75, 3);
    // Total water needed = 0.75 * 200 = 150. Recycled = 105. Fresh water = 45 (45 / 120 = 0.375 extractors)
    expect(solved.nodes[waterExt.id].outputs['water'].required).toBeCloseTo(45, 2);
    expect(solved.nodes[waterExt.id].machines).toBeCloseTo(0.375, 3);
  });

  it('handles Splitter priority overflow mode accurately', () => {
    const src: FactoryNode = {
      id: 'src',
      kind: 'input',
      x: 0,
      y: 0,
      clockSpeed: 100,
      somersloops: 0,
      purity: 'normal',
      pinMode: 'auto',
      pinnedValue: 1,
      itemId: 'iron-ingot',
      ratePerMin: 100,
      built: false,
    };
    const split: FactoryNode = {
      id: 'spl',
      kind: 'splitter',
      x: 200,
      y: 0,
      clockSpeed: 100,
      somersloops: 0,
      purity: 'normal',
      pinMode: 'auto',
      pinnedValue: 1,
      itemId: 'iron-ingot',
      splitterMode: 'priority',
      built: false,
    };
    // Priority 0 consumer needs 60/min ingots (2 iron-plate constructors)
    const plates = createRecipeNode('iron-plate', 400, -100, DEFAULT_SETTINGS, {
      pinMode: 'machines',
      pinnedValue: 2,
    });
    // Priority 1 overflow sink absorbs remainder = 40/min
    const sink: FactoryNode = {
      id: 'snk',
      kind: 'sink',
      x: 400,
      y: 100,
      clockSpeed: 100,
      somersloops: 0,
      purity: 'normal',
      pinMode: 'auto',
      pinnedValue: 1,
      itemId: 'iron-ingot',
      built: false,
    };
    const edges: FactoryEdge[] = [
      { id: 'e1', sourceNodeId: src.id, sourceItemId: 'iron-ingot', targetNodeId: split.id, targetItemId: 'iron-ingot' },
      { id: 'e2', sourceNodeId: split.id, sourceItemId: 'iron-ingot', targetNodeId: plates.id, targetItemId: 'iron-ingot', priority: 0 },
      { id: 'e3', sourceNodeId: split.id, sourceItemId: 'iron-ingot', targetNodeId: sink.id, targetItemId: 'iron-ingot', priority: 1 },
    ];
    const solved = solveFactory([src, split, plates, sink], edges, DEFAULT_SETTINGS);
    expect(solved.edges['e2'].flowRate).toBeCloseTo(60, 2);
    expect(solved.edges['e3'].flowRate).toBeCloseTo(40, 2);
  });

  it('auto-plans Tier 9 Ballistic Warp Drive cleanly without cycles or NaN', () => {
    const { nodes, edges } = buildProductionChain('ballistic-warp-drive', 1, DEFAULT_SETTINGS);
    expect(nodes.length).toBeGreaterThan(15);
    const solved = solveFactory(nodes, edges, DEFAULT_SETTINGS);
    expect(Number.isFinite(solved.totalPowerConsumedMW)).toBe(true);
    expect(solved.totalPowerConsumedMW).toBeGreaterThan(1000);
    const bwd = nodes.find((n) => n.recipeId === 'ballistic-warp-drive')!;
    expect(solved.nodes[bwd.id].outputs['ballistic-warp-drive'].required).toBeCloseTo(1, 3);
  });
});

describe('Power Facilities & Alien Power Augmenter', () => {
  it('plans a 15 MW Gross Fuel Generator plant using Turbofuel (underclocked 1x @ 6%)', () => {
    const { nodes, edges } = buildPowerPlant(
      {
        generatorRecipeId: 'power-turbofuel',
        targetMW: 15,
        targetMode: 'gross',
        fuelRecipeId: 'turbofuel',
      },
      DEFAULT_SETTINGS,
    );
    const solved = solveFactory(nodes, edges, DEFAULT_SETTINGS);
    const gen = nodes.find((n) => n.recipeId === 'power-turbofuel')!;
    expect(gen.pinnedValue).toBe(1);
    expect(gen.clockSpeed).toBeCloseTo(6, 2);
    expect(solved.totalPowerGeneratedMW).toBeCloseTo(15, 2);
    expect(solved.missingInputs).toHaveLength(0);
    expect(solved.unhandledByproducts).toHaveLength(0);
  });

  it('plans a 15 GW Net Fuel Generator plant using Turbo Blend Fuel [ALT]', () => {
    const { nodes, edges } = buildPowerPlant(
      {
        generatorRecipeId: 'power-turbofuel',
        targetMW: 15000,
        targetMode: 'net',
        fuelRecipeId: 'turbofuel-blend',
      },
      DEFAULT_SETTINGS,
    );
    const solved = solveFactory(nodes, edges, DEFAULT_SETTINGS);
    expect(nodes.some((n) => n.recipeId === 'turbofuel-blend')).toBe(true);
    // Net power after subtracting refineries, blenders, oil & water extractors hits 15,000 MW!
    expect(solved.netPowerMW).toBeCloseTo(15000, 0);
    expect(solved.missingInputs).toHaveLength(0);
  });

  it('computes exact Satisfactory 1.0-1.2 Alien Power Augmenter grid boost (including self-boost)', () => {
    // 1 standalone unfueled APA: 500 MW * 1.10 = 550 MW, 10 Somersloops
    const soloApa = createRecipeNode('power-alien-base', 0, 0, DEFAULT_SETTINGS, {
      pinMode: 'machines',
      pinnedValue: 1,
    });
    const soloSolved = solveFactory([soloApa], [], DEFAULT_SETTINGS);
    expect(soloSolved.basePowerGeneratedMW).toBeCloseTo(500, 2);
    expect(soloSolved.powerBoostPct).toBeCloseTo(0.1, 4);
    expect(soloSolved.powerBoostMW).toBeCloseTo(50, 2);
    expect(soloSolved.totalPowerGeneratedMW).toBeCloseTo(550, 2);
    expect(soloSolved.totalSomersloops).toBe(10);

    // 68 Coal Generators (5100 MW) + 6 unfueled APAs (3000 MW) = 8100 base + 60% (+4860) = 12,960 MW
    const coalGens = createRecipeNode('power-coal', 0, 0, DEFAULT_SETTINGS, {
      pinMode: 'machines',
      pinnedValue: 68,
    });
    const sixApas = createRecipeNode('power-alien-base', 0, 0, DEFAULT_SETTINGS, {
      pinMode: 'machines',
      pinnedValue: 6,
    });
    const gridSolved = solveFactory([coalGens, sixApas], [], DEFAULT_SETTINGS);
    expect(gridSolved.basePowerGeneratedMW).toBeCloseTo(8100, 2);
    expect(gridSolved.powerBoostMW).toBeCloseTo(4860, 2);
    expect(gridSolved.totalPowerGeneratedMW).toBeCloseTo(12960, 2);

    // 10 Fuel Generators (2500 MW) + 1 Fueled APA (500 MW + 30% boost) = 3000 * 1.3 = 3900 MW
    const fuelGens = createRecipeNode('power-fuel', 0, 0, DEFAULT_SETTINGS, {
      pinMode: 'machines',
      pinnedValue: 10,
    });
    const fueledApa = createRecipeNode('power-alien-boosted', 0, 0, DEFAULT_SETTINGS, {
      pinMode: 'machines',
      pinnedValue: 1,
    });
    const fueledSolved = solveFactory([fuelGens, fueledApa], [], DEFAULT_SETTINGS);
    expect(fueledSolved.basePowerGeneratedMW).toBeCloseTo(3000, 2);
    expect(fueledSolved.powerBoostPct).toBeCloseTo(0.3, 4);
    expect(fueledSolved.totalPowerGeneratedMW).toBeCloseTo(3900, 2);
  });

  it('scales Geothermal Generator by purity (100/200/400 MW) and ignores overclocking', () => {
    const impureGeo = createRecipeNode('power-geothermal', 0, 0, DEFAULT_SETTINGS, {
      pinMode: 'machines',
      pinnedValue: 1,
      purity: 'impure',
      clockSpeed: 250, // must be ignored since Geothermal cannot be overclocked
    });
    const pureGeo = createRecipeNode('power-geothermal', 0, 0, DEFAULT_SETTINGS, {
      pinMode: 'machines',
      pinnedValue: 2,
      purity: 'pure',
    });
    const s1 = solveFactory([impureGeo], [], DEFAULT_SETTINGS);
    expect(s1.totalPowerGeneratedMW).toBeCloseTo(100, 2);
    expect(s1.totalPowerShards).toBe(0);

    const s2 = solveFactory([pureGeo], [], DEFAULT_SETTINGS);
    expect(s2.totalPowerGeneratedMW).toBeCloseTo(800, 2);
  });

  it('auto-plans a 120 MW Biomass Burner facility with Solid Biofuel and zero missing inputs', () => {
    const { nodes, edges } = buildPowerPlant(
      {
        generatorRecipeId: 'power-solid-biofuel',
        targetMW: 120,
        targetMode: 'gross',
      },
      DEFAULT_SETTINGS,
    );
    const solved = solveFactory(nodes, edges, DEFAULT_SETTINGS);
    expect(solved.totalPowerGeneratedMW).toBeCloseTo(120, 2);
    expect(solved.missingInputs).toHaveLength(0);
  });
});
