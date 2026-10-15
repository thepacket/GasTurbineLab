# Gas Turbine Lab

A gas-turbine engine laboratory that runs entirely in the browser. It is an installable progressive web app with no server-side code: the static bundle is served by nginx on Fly.io and every calculation, including the solvers, runs on the device.

**Live:** https://gas-turbine-lab.fly.dev/

Build a **turbojet** (optionally afterburning), a **turbofan** (two or three spools, separate or mixed flow, direct-drive or geared fan) or a **free-turbine turboprop**, solve its design point, then run the fixed engine **off-design**, through **transients** with a control system, over a **mission**, through **optimisation** and **uncertainty** studies, and check **emissions and noise**. Results appear on an engine cross-section, a 3D cutaway, station tables, cycle diagrams, component maps and parametric sweeps. Everything can be compared, saved, shared as a link, exported to CSV or PNG, or written up as an engineering report.

The thermodynamics are validated against NASA's pyCycle to better than 0.05 % at design and off-design; see [docs/validation.md](docs/validation.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/user-guide.md](docs/user-guide.md) | How to use each view, inputs and outputs, layouts, units, sharing |
| [docs/methods.md](docs/methods.md) | The physics: gas model, components, design and off-design solvers, transients, control, thermal, secondary air, mission, optimisation, estimates |
| [docs/validation.md](docs/validation.md) | pyCycle reference cases, tolerances, how to regenerate the references, known differences |
| [docs/development.md](docs/development.md) | Code layout, running and testing, CI, deployment, how to add an architecture, a map, a preset or a scenario |
| [CHANGELOG.md](CHANGELOG.md) | What was added, in order |

## Capabilities at a glance

**Cycle model.** NASA CEA polynomials with Gibbs-minimisation equilibrium chemistry (frozen mode available); Jet-A, SAF, hydrogen and methane; humid air; ISA-1976 atmosphere. Inlet, compressors with bleeds, combustor, turbines with cooling streams, afterburner, constant-area mixer, convergent and convergent–divergent nozzles, gearboxes, actuator-disc propeller. Shaft balances per spool. Statics and flow areas at every station.

**Off-design.** Component maps (pyCycle's generic NPSS-style maps, uploaded maps, parametric, stage-stacked or geometry-based maps) scaled through the design point; Newton solution for flows, speeds, bypass ratio, R-lines and turbine pressure ratios at fixed geometry; throttle by T4, fuel flow, spool speed or thrust; variable geometry, bleeds and a secondary air system; sub-idle map extensions.

**Dynamics.** Spool transients with inertias, fuel schedules and ratio-unit limiters, start-up with a starter and light-off, a FADEC with N1/N2/thrust loops and actuator schedules, heat soak and tip-clearance effects.

**Design studies.** Mission analysis against an aircraft polar with ratings, Nelder–Mead optimisation with constraints, Monte Carlo uncertainty, weight and size estimates, installed performance, emissions (P3–T3 and ICAO LTO with CAEP/8 limits) and noise (jet and fan).

**Catalogue.** 59 commercial engines calibrated to published take-off ratings, with provenance notes.

**Interface.** Desktop, tablet and phone layouts; SI or US units; English or French; dark or light theme; guided teaching scenarios.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit and validation tests (vitest)
npm run test:e2e   # layout and feature tests in a headless browser (Playwright)
npm run build      # production bundle with service worker in dist/
```

Deployment: `fly deploy --build-arg GIT_SHA=$(git rev-parse --short HEAD)` builds the `Dockerfile` (Node build stage, nginx runtime) and runs one shared-CPU machine in Toronto that stops when idle.

## Status and limits

The design-point thermodynamics, the fixed-geometry off-design solver and the mixer match pyCycle to the stated tolerances. Everything else is physically based but not validated against an external reference: transients, control, thermal, secondary air, mission, optimisation and uncertainty use the validated cycle but their own models and defaults. Weight, emissions, noise, creep life and installation drag are correlation estimates and are labelled as such in the interface. The generic maps are not the catalogue engines' real maps, so off-design trends for a named engine are representative rather than engine-specific.

## Licence and acknowledgements

Thermodynamic coefficients and component maps are taken from NASA's open-source [pyCycle](https://github.com/OpenMDAO/pyCycle) (Apache-2.0). The catalogue uses only manufacturer-published nominal figures. No licence file has been added to this repository yet; it is private.
