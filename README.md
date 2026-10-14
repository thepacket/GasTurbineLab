# Gas Turbine Lab

A design-point gas-turbine cycle laboratory that runs entirely in the browser (installable PWA, no server-side code). Assemble a **turbojet**, **two-spool separate-flow turbofan** or **free-turbine turboprop**, then explore altitude, Mach number, bypass ratio, pressure ratios, turbine inlet temperature and component efficiencies. Results are shown on an engine cross-section, on a procedurally generated 3D cutaway, in station tables, T–s diagrams and parametric sweeps.

## Thermodynamic model

* **Gas properties**: NASA CEA 9-coefficient polynomials (the `janaf` set shipped with pyCycle) for Ar, CO₂, H₂O, N₂, O₂. Composition is carried as element amounts per kg (pyCycle's `b0` convention); products are frozen and fully oxidised. Air composition and Jet-A (C₁₂H₂₃) definitions are identical to pyCycle's.
* **Absolute enthalpies** (including formation enthalpy) so combustion is an enthalpy-conserving mix. Fuel enthalpy defaults to 0 kJ/kg, pyCycle's convention; it is adjustable.
* **Components**: ISA-1976 atmosphere, inlet ram recovery, compressors with isentropic efficiency and exit bleeds, combustor with ΔP/P and combustion efficiency, turbines with per-stream cooling-flow expansion (pyCycle's bleed model), convergent or convergent–divergent nozzles with velocity coefficient, afterburner (turbojet), actuator-disc propeller with gearbox and profile efficiency (turboprop).
* **Shaft balances** are solved for each spool: turbine pressure ratio is found such that turbine power × mechanical efficiency equals compressor power plus power extraction (or the requested shaft power for the power turbine).
* **Statics** at every station are computed for the sizing Mach numbers, which gives flow areas; the cross-section and 3D geometry scale with those areas.

## Commercial engine catalogue

`src/engine/engines.ts` lists 59 airline, regional and business engines (CFM56 and LEAP, CF6, GE90, GEnx, GE9X, JT8D, JT9D, PW2000/PW4000, PW1000G, V2500, GP7200, Conway, Spey, Tay, RB211, Trent, BR715, AE 3007, TFE731, HTF7000, FJ44; the Avon, JT3C, JT4A, CJ805, CJ610 and Olympus 593 turbojets; and the Dart, 501-D13, TPE331, PT6A, PW100/PW150, CT7, AE 2100, 250 and Catalyst turboprops). Only publicly published nominal figures are used: take-off thrust or shaft power, bypass ratio, overall pressure ratio, fan or propeller diameter and airflow where the manufacturer quotes it. Turbine inlet temperature, the pressure-ratio split, cooling flows and component efficiencies are not public; they are assigned by generation and T4 (or airflow, when T4 would fall below a plausible floor) is calibrated so the model reproduces the published rating at sea-level static ISA conditions. The note shown under the preset menu states exactly which values are published and which are estimated. `npm test` checks that every catalogue entry reproduces its rating within 0.5 %.

## Validation against pyCycle

`reference/pycycle_reference.py` builds the same three architectures in NASA's [pyCycle](https://github.com/OpenMDAO/pyCycle) (CEA equilibrium thermodynamics) and writes `src/data/pycycle_reference.json`. The app's **Validate** tab compares every station and performance figure. Agreement is within 0.4 % on thrust and 0.7 % on fuel flow for eight cases spanning sea-level static to Mach 2 at 15 km; the residual is dissociation enthalpy that equilibrium chemistry absorbs at high turbine inlet temperature. `npm test` enforces these tolerances.

To regenerate the reference (needs Python ≤ 3.11 and numpy < 2 for pyCycle 4.4):

```bash
uv venv --python 3.11 reference/venv
uv pip install --python reference/venv/bin/python "numpy<2" "scipy<1.14" om-pycycle
reference/venv/bin/python reference/pycycle_reference.py > src/data/pycycle_reference.json
```

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest: pyCycle comparison
npm run build      # static bundle + service worker in dist/
node scripts/icons.mjs   # regenerate PWA icons from public/icons/icon.svg
```

Layouts: desktop (three panes), tablet (controls + tabbed content), phone (bottom tab bar). Theme follows a toggle in the header.

## Deployment (Fly.io)

The `Dockerfile` builds the bundle and serves it with nginx; `fly.toml` runs one shared-CPU machine that stops when idle.

```bash
fly deploy
```

## Project layout

```
src/engine/      thermodynamics and cycle solver (gas.ts, components.ts, cycle.ts)
src/data/        janaf polynomial coefficients, pyCycle reference results
src/viz/         SVG cross-section, shared parametric geometry, charts, explorer
src/three/       Three.js procedural cutaway model
src/ui/          controls, results, validation, formatting
reference/       pyCycle reference-case generator
deploy/          nginx configuration
```
