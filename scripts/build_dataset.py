#!/usr/bin/env python3
"""
Builds the Satisfactory 1.2 dataset for Satisplanner
from the FactorioLab Satisfactory 1.2 dataset + power generator specs.
"""
import json
from pathlib import Path

SRC = Path("/tmp/factoriolab/public/data/sfy/data.json")
OUT = Path(__file__).resolve().parent.parent / "src/data/satisfactoryData.json"
OUT.parent.mkdir(parents=True, exist_ok=True)

with SRC.open() as f:
    raw = json.load(f)

excluded_alts = set(raw.get("defaults", {}).get("excludedRecipes", []))
# Additional alternate recipes confirmed in Satisfactory 1.0 - 1.2
extra_alts = {
    "biocoal",
    "charcoal",
    "silica-cheap",
    "rocket-fuel-nitro",
    "turbo-rifle-ammo-blender",
}
all_alts = excluded_alts | extra_alts

# True fluid/gas items in Satisfactory 1.2
FLUID_IDS = {
    "water",
    "crude-oil",
    "nitrogen-gas",
    "fuel",
    "heavy-oil-residue",
    "liquid-biofuel",
    "alumina-solution",
    "sulfuric-acid",
    "nitric-acid",
    "excited-photonic-matter",
    "dark-matter-residue",
    "dissolved-silica",
    "turbofuel",
    "rocket-fuel",
    "ionized-fuel",
}

EXTRACTOR_IDS = {
    "miner-mk1",
    "miner-mk2",
    "miner-mk3",
    "water-extractor",
    "oil-extractor",
    "resource-well-extractor",
}

PURITY_MACHINES = {
    "miner-mk1",
    "miner-mk2",
    "miner-mk3",
    "oil-extractor",
    "resource-well-extractor",
}

GENERATOR_IDS = {
    "biomass-burner",
    "coal-generator",
    "fuel-generator",
    "geothermal-generator",
    "nuclear-power-plant",
    "alien-power-augmenter",
}

# Variable power (minMW, maxMW) -> average is (min+max)/2
VARIABLE_POWER_BUILDINGS = {
    "converter": (100, 400),
    "quantum-encoder": (0, 2000),
}

# Build icons map
icons = {}
for ic in raw["icons"]:
    icons[ic["id"]] = {
        "x": ic["x"],
        "y": ic["y"],
        "color": ic.get("color", "#FA9549"),
    }

# Build machines map
machines = {}
for it in raw["items"]:
    if "machine" not in it:
        continue
    mid = it["id"]
    m = it["machine"]
    usage_kw = m.get("usage", 0)
    base_mw = round(usage_kw / 1000.0, 4)
    is_ext = mid in EXTRACTOR_IDS
    is_gen = mid in GENERATOR_IDS
    # Somersloops only apply to production machines (not extractors, not packagers, not generators, not space elevator)
    somersloops = 0 if (is_ext or is_gen or mid in {"packager", "space-elevator"}) else int(m.get("modules", 0))
    machines[mid] = {
        "id": mid,
        "name": it["name"],
        "icon": it.get("icon", mid),
        "speed": m.get("speed", 1),
        "basePowerMW": base_mw,
        "somersloopSlots": somersloops,
        "isExtractor": is_ext,
        "supportsPurity": mid in PURITY_MACHINES,
        "isGenerator": is_gen,
    }
    if mid in VARIABLE_POWER_BUILDINGS:
        machines[mid]["variablePowerMW"] = list(VARIABLE_POWER_BUILDINGS[mid])

# First-class Power Generators (Satisfactory 1.0 - 1.2 exact values)
machines["biomass-burner"] = {
    "id": "biomass-burner",
    "name": "Biomass Burner",
    "icon": "biomass-burner",
    "speed": 1,
    "basePowerMW": -30,
    "somersloopSlots": 0,
    "isExtractor": False,
    "supportsPurity": False,
    "isGenerator": True,
}
machines["coal-generator"] = {
    "id": "coal-generator",
    "name": "Coal-Powered Generator",
    "icon": "coal-generator",
    "speed": 1,
    "basePowerMW": -75,
    "somersloopSlots": 0,
    "isExtractor": False,
    "supportsPurity": False,
    "isGenerator": True,
}
machines["fuel-generator"] = {
    "id": "fuel-generator",
    "name": "Fuel-Powered Generator",
    "icon": "fuel-generator",
    "speed": 1,
    "basePowerMW": -250,
    "somersloopSlots": 0,
    "isExtractor": False,
    "supportsPurity": False,
    "isGenerator": True,
}
machines["geothermal-generator"] = {
    "id": "geothermal-generator",
    "name": "Geothermal Generator",
    "icon": "geothermal-generator",
    "speed": 1,
    "basePowerMW": -200,
    "somersloopSlots": 0,
    "isExtractor": False,
    "supportsPurity": True,
    "isGenerator": True,
    "noOverclock": True,
    "variablePowerMW": [100, 300],
}
machines["alien-power-augmenter"] = {
    "id": "alien-power-augmenter",
    "name": "Alien Power Augmenter",
    "icon": "alien-power-matrix",
    "speed": 1,
    "basePowerMW": -500,
    "somersloopSlots": 0,
    "isExtractor": False,
    "supportsPurity": False,
    "isGenerator": True,
    "noOverclock": True,
    "buildSomersloops": 10,
}

# Build items map (real craftable/resource/equipment/project-assembly items)
items = {}
for it in raw["items"]:
    cat = it.get("category", "other")
    if cat == "other":
        continue
    iid = it["id"]
    items[iid] = {
        "id": iid,
        "name": it["name"],
        "category": cat,
        "icon": it.get("icon", iid),
        "isFluid": iid in FLUID_IDS,
        "row": it.get("row", 0),
    }

# Build recipes list
recipes = []
seen_recipe_ids = set()
for r in raw["recipes"]:
    rid = r["id"]
    if rid in seen_recipe_ids:
        continue
    seen_recipe_ids.add(rid)
    producers = r.get("producers", [])
    if not producers:
        continue
    flags = r.get("flags", [])
    is_mining = "mining" in flags
    is_gen = any(p in GENERATOR_IDS for p in producers)
    is_converter = producers == ["converter"] and r.get("category") == "resources"
    is_alt = (rid in all_alts) and not is_mining and not is_gen
    # Custom power override (e.g. Particle Accelerator recipes: 500 MW avg = 250-750, 1000 MW avg = 500-1500)
    power_mw = None
    if "usage" in r:
        power_mw = round(r["usage"] / 1000.0, 4)

    ins = r.get("in", {})
    outs = r.get("out", {})
    icon_id = r.get("icon") or (next(iter(outs.keys()), None) if outs else next(iter(ins.keys()), producers[0]))
    if icon_id not in icons:
        icon_id = producers[0] if producers[0] in icons else "iron-plate"

    rec_obj = {
        "id": rid,
        "name": r["name"],
        "category": r.get("category", "components"),
        "producers": producers,
        "time": r["time"],
        "in": ins,
        "out": outs,
        "icon": icon_id,
        "isAlternate": is_alt,
        "isExtractor": is_mining,
        "isGenerator": is_gen,
        "isConverter": is_converter,
        "noCostMultiplier": "noCostMultiplier" in flags or is_mining or is_gen,
    }
    if power_mw is not None:
        rec_obj["powerMW"] = power_mw
    recipes.append(rec_obj)

# Add Power Generator burn recipes (Satisfactory 1.0/1.2 exact burn rates)
generator_recipes = [
    {
        "id": "power-coal",
        "name": "Coal Power (75 MW)",
        "category": "power",
        "producers": ["coal-generator"],
        "time": 4,
        "in": {"coal": 1, "water": 3},
        "out": {},
        "icon": "coal-generator",
        "isAlternate": False,
        "isExtractor": False,
        "isGenerator": True,
        "isConverter": False,
        "noCostMultiplier": True,
    },
    {
        "id": "power-compacted-coal",
        "name": "Compacted Coal Power (75 MW)",
        "category": "power",
        "producers": ["coal-generator"],
        "time": 8.4,
        "in": {"compacted-coal": 1, "water": 6.3},
        "out": {},
        "icon": "coal-generator",
        "isAlternate": False,
        "isExtractor": False,
        "isGenerator": True,
        "isConverter": False,
        "noCostMultiplier": True,
    },
    {
        "id": "power-petroleum-coke",
        "name": "Petroleum Coke Power (75 MW)",
        "category": "power",
        "producers": ["coal-generator"],
        "time": 2.4,
        "in": {"petroleum-coke": 1, "water": 1.8},
        "out": {},
        "icon": "coal-generator",
        "isAlternate": False,
        "isExtractor": False,
        "isGenerator": True,
        "isConverter": False,
        "noCostMultiplier": True,
    },
    {
        "id": "power-fuel",
        "name": "Fuel Power (250 MW)",
        "category": "power",
        "producers": ["fuel-generator"],
        "time": 3,
        "in": {"fuel": 1},
        "out": {},
        "icon": "fuel-generator",
        "isAlternate": False,
        "isExtractor": False,
        "isGenerator": True,
        "isConverter": False,
        "noCostMultiplier": True,
    },
    {
        "id": "power-liquid-biofuel",
        "name": "Liquid Biofuel Power (250 MW)",
        "category": "power",
        "producers": ["fuel-generator"],
        "time": 3,
        "in": {"liquid-biofuel": 1},
        "out": {},
        "icon": "fuel-generator",
        "isAlternate": False,
        "isExtractor": False,
        "isGenerator": True,
        "isConverter": False,
        "noCostMultiplier": True,
    },
    {
        "id": "power-turbofuel",
        "name": "Turbofuel Power (250 MW)",
        "category": "power",
        "producers": ["fuel-generator"],
        "time": 8,
        "in": {"turbofuel": 1},
        "out": {},
        "icon": "fuel-generator",
        "isAlternate": False,
        "isExtractor": False,
        "isGenerator": True,
        "isConverter": False,
        "noCostMultiplier": True,
    },
    {
        "id": "power-rocket-fuel",
        "name": "Rocket Fuel Power (250 MW)",
        "category": "power",
        "producers": ["fuel-generator"],
        "time": 14.4,
        "in": {"rocket-fuel": 1},
        "out": {},
        "icon": "fuel-generator",
        "isAlternate": False,
        "isExtractor": False,
        "isGenerator": True,
        "isConverter": False,
        "noCostMultiplier": True,
    },
    {
        "id": "power-ionized-fuel",
        "name": "Ionized Fuel Power (250 MW)",
        "category": "power",
        "producers": ["fuel-generator"],
        "time": 20,
        "in": {"ionized-fuel": 1},
        "out": {},
        "icon": "fuel-generator",
        "isAlternate": False,
        "isExtractor": False,
        "isGenerator": True,
        "isConverter": False,
        "noCostMultiplier": True,
    },
    {
        "id": "power-ficsonium",
        "name": "Ficsonium Fuel Rod (Burning · 2500 MW)",
        "category": "power",
        "producers": ["nuclear-power-plant"],
        "time": 60,
        "in": {"ficsonium-fuel-rod": 1, "water": 240},
        "out": {},
        "icon": "nuclear-power-plant",
        "isAlternate": False,
        "isExtractor": False,
        "isGenerator": True,
        "isConverter": False,
        "noCostMultiplier": True,
    },
    # Biomass Burner (30 MW) - Satisfactory 1.0+ belt-fed fuels
    {
        "id": "power-solid-biofuel",
        "name": "Solid Biofuel Power (30 MW)",
        "category": "power",
        "producers": ["biomass-burner"],
        "time": 15,
        "in": {"solid-biofuel": 1},
        "out": {},
        "icon": "biomass-burner",
        "isAlternate": False,
        "isExtractor": False,
        "isGenerator": True,
        "isConverter": False,
        "noCostMultiplier": True,
    },
    {
        "id": "power-packaged-liquid-biofuel",
        "name": "Packaged Liquid Biofuel Power (30 MW)",
        "category": "power",
        "producers": ["biomass-burner"],
        "time": 25,
        "in": {"packaged-liquid-biofuel": 1},
        "out": {},
        "icon": "biomass-burner",
        "isAlternate": False,
        "isExtractor": False,
        "isGenerator": True,
        "isConverter": False,
        "noCostMultiplier": True,
    },
    {
        "id": "power-biomass",
        "name": "Biomass Power (30 MW)",
        "category": "power",
        "producers": ["biomass-burner"],
        "time": 6,
        "in": {"biomass": 1},
        "out": {},
        "icon": "biomass-burner",
        "isAlternate": False,
        "isExtractor": False,
        "isGenerator": True,
        "isConverter": False,
        "noCostMultiplier": True,
    },
    {
        "id": "power-wood",
        "name": "Wood Power (30 MW)",
        "category": "power",
        "producers": ["biomass-burner"],
        "time": 3.3333333,
        "in": {"wood": 1},
        "out": {},
        "icon": "biomass-burner",
        "isAlternate": False,
        "isExtractor": False,
        "isGenerator": True,
        "isConverter": False,
        "noCostMultiplier": True,
    },
    {
        "id": "power-leaves",
        "name": "Leaves Power (30 MW)",
        "category": "power",
        "producers": ["biomass-burner"],
        "time": 0.5,
        "in": {"leaves": 1},
        "out": {},
        "icon": "biomass-burner",
        "isAlternate": False,
        "isExtractor": False,
        "isGenerator": True,
        "isConverter": False,
        "noCostMultiplier": True,
    },
    {
        "id": "power-mycelia",
        "name": "Mycelia Power (30 MW)",
        "category": "power",
        "producers": ["biomass-burner"],
        "time": 0.6666667,
        "in": {"mycelia": 1},
        "out": {},
        "icon": "biomass-burner",
        "isAlternate": False,
        "isExtractor": False,
        "isGenerator": True,
        "isConverter": False,
        "noCostMultiplier": True,
    },
    # Geothermal Generator (100 / 200 / 400 MW avg by geyser purity)
    {
        "id": "power-geothermal",
        "name": "Geothermal Power (200 MW avg)",
        "category": "power",
        "producers": ["geothermal-generator"],
        "time": 60,
        "in": {},
        "out": {},
        "icon": "geothermal-generator",
        "isAlternate": False,
        "isExtractor": False,
        "isGenerator": True,
        "isConverter": False,
        "noCostMultiplier": True,
    },
    # Alien Power Augmenter (500 MW base + 10% unfueled / + 30% fueled grid boost)
    {
        "id": "power-alien-base",
        "name": "Alien Power Augmenter (+10% Grid)",
        "category": "power",
        "producers": ["alien-power-augmenter"],
        "time": 60,
        "in": {},
        "out": {},
        "icon": "somersloop",
        "isAlternate": False,
        "isExtractor": False,
        "isGenerator": True,
        "isConverter": False,
        "noCostMultiplier": True,
        "powerBoostPct": 0.10,
    },
    {
        "id": "power-alien-boosted",
        "name": "Alien Power Augmenter · Matrix (+30% Grid)",
        "category": "power",
        "producers": ["alien-power-augmenter"],
        "time": 12,
        "in": {"alien-power-matrix": 1},
        "out": {},
        "icon": "alien-power-matrix",
        "isAlternate": False,
        "isExtractor": False,
        "isGenerator": True,
        "isConverter": False,
        "noCostMultiplier": True,
        "powerBoostPct": 0.30,
    },
]
recipes.extend(generator_recipes)

belts = [
    {"id": "conveyor-belt-mk1", "tier": 1, "name": "Mk.1", "fullName": "Conveyor Belt Mk.1", "ratePerMin": 60, "icon": "conveyor-belt-mk1"},
    {"id": "conveyor-belt-mk2", "tier": 2, "name": "Mk.2", "fullName": "Conveyor Belt Mk.2", "ratePerMin": 120, "icon": "conveyor-belt-mk2"},
    {"id": "conveyor-belt-mk3", "tier": 3, "name": "Mk.3", "fullName": "Conveyor Belt Mk.3", "ratePerMin": 270, "icon": "conveyor-belt-mk3"},
    {"id": "conveyor-belt-mk4", "tier": 4, "name": "Mk.4", "fullName": "Conveyor Belt Mk.4", "ratePerMin": 480, "icon": "conveyor-belt-mk4"},
    {"id": "conveyor-belt-mk5", "tier": 5, "name": "Mk.5", "fullName": "Conveyor Belt Mk.5", "ratePerMin": 780, "icon": "conveyor-belt-mk5"},
    {"id": "conveyor-belt-mk6", "tier": 6, "name": "Mk.6", "fullName": "Conveyor Belt Mk.6", "ratePerMin": 1200, "icon": "conveyor-belt-mk6"},
]

pipes = [
    {"id": "pipeline-mk1", "tier": 1, "name": "Pipe Mk.1", "fullName": "Pipeline Mk.1", "ratePerMin": 300, "icon": "pipeline-mk1"},
    {"id": "pipeline-mk2", "tier": 2, "name": "Pipe Mk.2", "fullName": "Pipeline Mk.2", "ratePerMin": 600, "icon": "pipeline-mk2"},
]

dataset = {
    "gameVersion": "1.2",
    "spriteSheet": {"width": 960, "height": 960, "tileSize": 64},
    "items": items,
    "machines": machines,
    "recipes": recipes,
    "belts": belts,
    "pipes": pipes,
    "icons": icons,
}

with OUT.open("w") as f:
    json.dump(dataset, f, separators=(",", ":"))

print(f"Generated {OUT}")
print(f"  Items:    {len(items)}")
print(f"  Machines: {len(machines)}")
print(f"  Recipes:  {len(recipes)} (Alternates: {sum(1 for r in recipes if r['isAlternate'])})")
print(f"  Icons:    {len(icons)}")
print(f"  Size:     {OUT.stat().st_size / 1024:.1f} KB")
