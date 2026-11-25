# SATISPLAN — Satisfactory 1.2 Factory & Power Planner

Interactive visual factory and power-plant layout planner for **Satisfactory 1.2**, designed for speed, precision, and clean CAD aesthetics.

## Features

- **Official Satisfactory 1.2 Data**: 179 items, 24 machines, 314 recipes (127 alternates, Tier 9 Quantum/SAM/Dark Matter/Ficsonium chains, and all power generators), plus 1.2 Game Mode Recipe Cost & Power Multipliers.
- **Drag-from-Port to Spawn**: Drag any input or output handle into empty space to spawn and auto-connect compatible recipes, Splitters, Mergers, External Imports, or AWESOME Sinks.
- **2-Keystroke Auto-Chain & Power Plant Planner**:
  - `Space` / `/` — Auto-synthesize any item chain (`hmf`, `rip`, `eib`, `rcu`, `bwd`) or add single nodes.
  - `P` — Plan complete power facilities by **Gross or Net MW/GW** across Fuel, Coal, Nuclear, Biomass, Geothermal, and **Alien Power Augmenters** (+10% / +30% grid boost), choosing any fuel production recipe route (e.g. Turbofuel, Turbo Blend Fuel, Nitro Rocket Fuel).
- **Live Bidirectional Flow Solver**: Pull, push, pinned machine counts, closed-loop byproduct recycling, Splitter modes (Manifold / Even / Overflow), overclocking (`clock^1.321928`), Somersloop amplification, and Mk.1–Mk.6 belt & Mk.1–Mk.2 pipe bottleneck detection.
- **Three Engineering Themes**: **FICSIT Steel**, **Drafting Paper**, and **Blueprint Cyan** with `IBM Plex Sans` & `IBM Plex Mono`.

## Development

```bash
npm install
npm run dev      # Start local dev server
npm test         # Run solver & power planner unit tests
npm run lint     # Run oxlint static analysis
npm run build    # Type-check and build production bundle into dist/
```

## Deployment

Deployed via GitHub Actions (`.github/workflows/deploy.yml`) to GitHub Pages at `satisplanner.markmartinez.ca`.
