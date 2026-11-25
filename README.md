# Satisplanner

Visual factory and power planner for Satisfactory 1.2.

## Features

- **Satisfactory 1.2 Data**: 179 items, 24 machines, 314 recipes (including 127 alternates, Tier 9 chains, and all power generators), plus 1.2 game mode recipe cost and power multipliers.
- **Drag-from-Port**: Drag any input or output handle onto empty space to spawn and connect compatible recipes, splitters, mergers, external imports, or AWESOME Sinks.
- **Quick Planner**:
  - `Space` / `/`: Build an item production chain (`hmf`, `rip`, `eib`, `rcu`, `bwd`) or add single nodes.
  - `P`: Plan power facilities by gross or net MW/GW across Fuel, Coal, Nuclear, Biomass, Geothermal, and Alien Power Augmenters (+10% / +30% grid boost) with selectable fuel recipe routes.
- **Bidirectional Flow Solver**: Pull, push, pinned machine counts, closed-loop byproduct recycling, splitter modes (Manifold / Even / Overflow), overclocking (`clock^1.321928`), Somersloop amplification, and Mk.1-Mk.6 belt and Mk.1-Mk.2 pipe bottleneck warnings.
- **Themes**: FICSIT Steel, Drafting Paper, and Blueprint.

## Development

```bash
npm install
npm run dev      # Start local dev server
npm test         # Run unit tests
npm run lint     # Run oxlint
npm run build    # Type-check and build into dist/
```

## Deployment

Deployed via GitHub Actions (`.github/workflows/deploy.yml`) to GitHub Pages at `satisplanner.markmartinez.ca`.
