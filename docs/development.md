# Development

## Stack

Vite 8, React 19, TypeScript 6, Three.js, vite-plugin-pwa (Workbox). Tests with Vitest (unit, solver and validation) and Playwright (end-to-end across three layouts). No runtime dependencies beyond React and Three.js; no server.

## Running

```bash
npm install
npm run dev          # Vite dev server on :5173
npm test             # vitest run
npm run test:e2e     # playwright test (builds, serves dist on :4173, three projects)
npm run build        # tsc -b && vite build → dist/
npm run preview      # serve dist on :4173
node scripts/icons.mjs   # regenerate PWA icons from public/icons/icon.svg
```

The Playwright run needs the Chromium build (`npx playwright install chromium`). Lighthouse can be run against the preview with `npm run lighthouse`; the last audit scored 100/100/100/100.

## Code layout

```
src/engine/            physics and numerics (no UI imports)
  gas.ts               species polynomials, composition, fuels, humidity, Gas class
  equilibrium.ts       Gibbs-minimisation solver
  atmosphere.ts        ISA 1976
  flow.ts              total/static state conversions
  components.ts        compressor, turbine, burner, nozzle, mixer
  core.ts              generic station-by-station evaluation with a Provider; cooling model; installation, emissions, noise; orifice law
  cycle.ts             solveEngine (design point)
  maps.ts              map tables, scaling, corrected parameters, custom-map registry
  offdesign.ts         DesignPoint, off-design provider, Newton solver, continuation, debug helpers
  transient.ts         spool dynamics, start-up, FADEC, thermal/clearance
  mission.ts           profile integration with ratings
  optimize.ts          Nelder–Mead with penalties
  montecarlo.ts        uncertainty propagation
  weight.ts            weight and size estimate
  certification.ts     ICAO LTO cycle, CAEP/8 limit, fan noise
  custommaps.ts        map parsing and generators (parametric, stage stacking, geometry)
  engines.ts           commercial catalogue and calibration
  presets.ts           generic presets
  reference.ts / reference_od.ts   inputs reproducing the pyCycle cases
  worker.ts / client.ts            web worker protocol
  types.ts / defaults.ts           EngineInputs, EngineResult, defaults
  __tests__/           vitest suites
src/data/              janaf.json, maps.json, pycycle_reference.json, pycycle_offdesign.json
src/ui/                React views and helpers (Controls, Results, Explore, Compare, Transient, Mission, Optimise, Uncertainty, Maps, Gallery, Learn, Validation, Report, share, csv, units, i18n)
src/viz/               SVG cross-section, shared parametric geometry, charts, map charts
src/three/             Three.js cutaway (Engine3D.tsx)
src/state/store.ts     reducer, persistence, worker-backed off-design result
e2e/                   Playwright specs
reference/             pyCycle scripts (Python)
deploy/nginx.conf, Dockerfile, fly.toml
.github/workflows/ci.yml, .github/dependabot.yml
```

Engine code must stay free of DOM and React imports so it runs unchanged in the worker and in tests.

## Conventions

* SI internally; display units converted in `ui/units.ts`.
* `EngineInputs` is the single source of design truth; it is persisted to `localStorage`, encoded into share links and stored in the gallery. New fields need a default in `defaults.ts` and, if nested, an entry in the store's deep-merge list so old saved states load.
* Component results are `{ id, kind, name, values }` with numeric values whose keys carry a unit suffix (`_W`, `_N`, `_kgs`, `_m2`, `_Pa`, `_pct`, `_rpm`) that `Results` formats automatically.
* Off-design unknown names are `W`, `BPR`, `N_LP`, `N_IP`, `N_HP`, `FAR`, `Rl_<comp>`, `PR_<turb>`; residual names are `<comp>_flow`, `<turb>_flow`, `<shaft>_power`, `<nozzle>_area`, `mixer_ps`, `burner`. The system must stay square: adding a component means adding its unknown and its residual.
* Chemistry: tests and heavy loops use `chemistry: 'frozen'` (0.6 ms per solve); the interactive design point uses equilibrium (16 ms).

## Adding things

**A map.** Add a table to `src/data/maps.json` (compressor: `defaults`, `RlineStall`, `alphaMap`, `NcMap`, `RlineMap`, `WcMap[a][n][r]`, `PRmap`, `effMap`; turbine: `defaults`, `alphaMap`, `NpMap`, `PRmap`, `WpMap`, `effMap`), or register one at runtime with `registerCustomMap`. Assign through `inputs.mapIds`.

**A preset.** Append to `PRESETS` in `presets.ts`. **A catalogue engine**: append an `EngineSpec` to `ENGINES` in `engines.ts` with published figures only; `calibrateEngine` finds T4 (or airflow) and `engines.test.ts` checks the rating is reproduced.

**A scenario.** Append to `SCENARIOS` in `ui/scenarios.ts` with a setup function, the target view and steps.

**A new architecture or component.** Extend `EngineInputs`, add the gas-path branch in `core.ts` (stations, components, shafts, residual names), the unknowns in `offdesign.ts` (`unknownNames`, `designUnknowns`, `MAP_FOR`, `INLET_STATION`), the geometry in `viz/geometry.ts`, and the controls. Add a design-point test and an off-design round-trip test (the off-design solve at the design condition must reproduce the design point).

## Testing

`npm test` runs: pyCycle design-point comparison (equilibrium and frozen), pyCycle off-design and mixed-flow comparison, catalogue calibration, off-design round trips and throttling for every architecture, transient and mission behaviour, FADEC, start-up, thermal, secondary air, fuels and cooling, optimiser, Monte Carlo, weight, map generators, certification, and a 354-point envelope fuzz over the catalogue. Solver-heavy tests have a 120 s timeout because CI runners are several times slower than a laptop.

`npm run test:e2e` runs 15 specs on desktop, tablet and phone: layouts, overflow, architecture switching, off-design in the worker, PWA manifest and service worker, share links, transient, transient start-up from shutdown, mission, maps, learn, optimise, uncertainty, gallery and the language toggle.

## CI and dependencies

GitHub Actions (`ci.yml`) runs type-check, unit tests, build, Chromium install and the Playwright suite on every push and pull request, and uploads screenshots. Dependabot opens weekly grouped npm PRs and monthly GitHub Actions PRs; merge them when CI is green.

## Deployment

`fly deploy --build-arg GIT_SHA=$(git rev-parse --short HEAD)` builds the multi-stage `Dockerfile` (the hash appears in the header as the build version) (Node 22 build, nginx 1.27 runtime) and updates the single machine in region `yyz`. `deploy/nginx.conf` serves `index.html` for all routes, caches hashed assets for a year, and never caches the service worker or manifest.

## Regenerating validation data

See [validation.md](validation.md). The Python environment is not part of the repository.
