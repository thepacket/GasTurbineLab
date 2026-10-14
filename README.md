# Gas Turbine Lab

A gas-turbine cycle laboratory that runs entirely in the browser (installable PWA, no server-side code). Assemble a **turbojet** (with afterburner), a **turbofan** (two or three spools, separate or mixed flow, direct-drive or geared fan) or a **free-turbine turboprop** (with reduction gearbox and propeller), solve the design point, then run the fixed engine **off-design** across throttle, altitude and Mach number on scaled component maps. Results are shown on an engine cross-section, on a procedurally generated 3D cutaway, in station tables, T–s diagrams, compressor maps and parametric sweeps, and can be compared, shared by link and exported to CSV.

## Thermodynamic model

* **Gas properties**: NASA CEA 9-coefficient polynomials (the `janaf` set shipped with pyCycle). Composition is carried as element amounts per kg (pyCycle's `b0` convention). Above 1000 K the composition is solved by **Gibbs-free-energy minimisation** over N₂, O₂, Ar, CO₂, H₂O, CO, H₂, OH, NO, O and H (CEA's element-potential iteration); a frozen complete-combustion mode is available. Air composition and Jet-A (C₁₂H₂₃) definitions are identical to pyCycle's.
* **Absolute enthalpies** (including formation enthalpy) so combustion is an enthalpy-conserving mix. Fuel enthalpy defaults to 0 kJ/kg, pyCycle's convention; it is adjustable.
* **Components**: ISA-1976 atmosphere, inlet ram recovery, compressors with isentropic efficiency and exit bleeds, combustor with ΔP/P and combustion efficiency, turbines with per-stream cooling-flow expansion (pyCycle's bleed model), convergent or convergent–divergent nozzles with velocity coefficient, afterburner (turbojet and mixed turbofan), constant-area **mixer** (mass, impulse and energy conservation), **fan drive gearbox** and **propeller reduction gearbox** with explicit speeds, actuator-disc propeller with profile efficiency and tip-Mach warning.
* **Shaft balances** are solved for each spool (LP, IP, HP, power turbine): turbine pressure ratio is found such that turbine power × mechanical efficiency equals compressor power plus power extraction (or the requested shaft power for the power turbine).
* **Statics** at every station are computed for the sizing Mach numbers, which gives flow areas; the cross-section and 3D geometry scale with those areas.

## Off-design operation

The design point fixes nozzle throat and mixer areas and scales the NPSS-style component maps distributed with pyCycle (fan, LPC, HPC, HPT, LPT) so that each passes through its design flow, pressure ratio, efficiency and corrected speed. Off-design, the unknowns are inlet mass flow, bypass ratio, spool speeds, fuel/air ratio, compressor R-lines and turbine pressure ratios; the residuals are map-flow continuity at every compressor and turbine, shaft power balances, nozzle throat and mixer static-pressure matching, and the throttle target (T4, fuel flow or HP spool speed). A Newton solver with finite-difference Jacobian, backtracking and continuation from the design throttle solves 5 (turbojet) to 12 (three-spool turbofan) unknowns in a web worker. Results include corrected speeds, surge margins and the operating point drawn on each compressor map. Turboprops run with a constant-speed power turbine and a propeller load setting.

## Transients, missions, installation, emissions

* **Transient** (Transient tab): spool dynamics `I ω dω/dt = P_turbine − P_load` integrated with a Heun scheme while the gas path is solved quasi-steadily at each step with speeds held as states. A fuel ramp is applied, optionally limited by a ratio-unit (Wf/P3) acceleration schedule and deceleration floor. Outputs: spool speeds, fuel command vs delivered, thrust, surge margins, T4/T5 and the running-line trajectory on the compressor map. Inertias are inputs (Build → Spool inertia).
* **Mission** (Mission tab): a segment profile (take-off, climb, cruise, descent, hold) flown with the fixed engine against a simple aircraft (mass, wing area, parabolic polar, engine count). Thrust required sets the throttle through a thrust-matching solve; N1, N2 and T4 ratings cap it and shortfalls are flagged. Fuel burn and mass are integrated; block fuel, time and distance are reported per segment.
* **Variable geometry and bleeds**: customer bleed at HPC exit, handling bleed from the booster/compressor exit (to the bypass duct, or overboard), variable-area exhaust nozzle (A8 multiplier off-design) and a variable-stator flow gain on the fan and HPC maps.
* **Installed performance**: additive inlet drag from the capture ratio, nacelle skin friction from the computed geometry, and afterbody drag; installed thrust and TSFC are reported and can drive the mission.
* **Emissions and noise**: NOx and CO emission indices from P3–T3 correlations, CO₂ from fuel flow, and jet mixing noise from Lighthill V⁸ scaling (overall sound pressure level at 1 m). All are estimates and labelled as such.
* **Custom maps** (Maps tab): assign any built-in or uploaded map to each compressor and turbine. Upload JSON (same structure as `src/data/maps.json`) or a CSV grid, or generate a parametric elliptical compressor map. Maps are kept in the browser's local storage.
* **Learn** (Learn tab): seven guided scenarios (bypass ratio, T4, OPR, altitude, part power, acceleration and surge margin, block fuel) that load a design, open the right view and explain what to look for.

## Views

* **Build**: architecture, layout, presets, catalogue, operating point (design / off-design) and every component parameter; SI inputs with a SI / US display-unit toggle in the header.
* **Section**: parametric SVG cross-section coloured by total temperature or pressure with station callouts; **3D**: Three.js cutaway with rotating blade rows and click-to-inspect parts.
* **Results**: performance cards, shaft balances with speeds, T–s and station profiles, compressor maps, station table (CSV export), component details.
* **Explore**: design-point sweeps (new design per point) or off-design sweeps (fixed engine) with optional parameter families, computed in a worker; CSV export.
* **Compare**: the live design against a pinned snapshot or any catalogue engine, with overlaid diagrams.
* **Transient**, **Mission**, **Maps**, **Learn**: see above.
* **Validate**: every station and performance figure against pyCycle.
* **Share**: the link button encodes the complete design, operating point and comparison in the URL (`#d=`).

## Commercial engine catalogue

`src/engine/engines.ts` lists 59 airline, regional and business engines (CFM56 and LEAP, CF6, GE90, GEnx, GE9X, JT8D, JT9D, PW2000/PW4000, PW1000G, V2500, GP7200, Conway, Spey, Tay, RB211, Trent, BR715, AE 3007, TFE731, HTF7000, FJ44; the Avon, JT3C, JT4A, CJ805, CJ610 and Olympus 593 turbojets; and the Dart, 501-D13, TPE331, PT6A, PW100/PW150, CT7, AE 2100, 250 and Catalyst turboprops). Only publicly published nominal figures are used: take-off thrust or shaft power, bypass ratio, overall pressure ratio, fan or propeller diameter and airflow where the manufacturer quotes it. Turbine inlet temperature, the pressure-ratio split, cooling flows and component efficiencies are not public; they are assigned by generation and T4 (or airflow, when T4 would fall below a plausible floor) is calibrated so the model reproduces the published rating at sea-level static ISA conditions. The note shown under the preset menu states exactly which values are published and which are estimated. `npm test` checks that every catalogue entry reproduces its rating within 0.5 %.

## Validation against pyCycle

`reference/pycycle_reference.py` builds the same three architectures in NASA's [pyCycle](https://github.com/OpenMDAO/pyCycle) (CEA equilibrium thermodynamics) and writes `src/data/pycycle_reference.json`. The app's **Validate** tab compares every station and performance figure. With equilibrium chemistry the agreement is within 0.05 % on every station and 0.01 % on thrust and fuel flow for eight cases spanning sea-level static to Mach 2 at 15 km; the frozen model stays within 1 %. `npm test` enforces these tolerances.

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
npm test           # vitest: pyCycle comparison, engine catalogue, off-design, transient, mission, catalogue envelope fuzz
npm run test:e2e   # Playwright: desktop, tablet and phone layouts, off-design worker, PWA, share links
npm run build      # static bundle + service worker in dist/
node scripts/icons.mjs   # regenerate PWA icons from public/icons/icon.svg
```

Layouts: desktop (three panes), tablet (controls + tabbed content), phone (bottom tab bar). Theme and display units follow toggles in the header. GitHub Actions runs type-check, unit tests, build and the Playwright suite on every push.

## Deployment (Fly.io)

The `Dockerfile` builds the bundle and serves it with nginx; `fly.toml` runs one shared-CPU machine that stops when idle.

```bash
fly deploy
```

## Project layout

```
src/engine/      gas model (gas.ts, equilibrium.ts), components, generic core (core.ts),
                 design wrapper (cycle.ts), maps and off-design solver (maps.ts, offdesign.ts),
                 transient.ts, mission.ts, custommaps.ts, engine catalogue (engines.ts), worker (worker.ts)
src/data/        janaf polynomial coefficients, component maps, pyCycle reference results
e2e/             Playwright layout and PWA tests
src/viz/         SVG cross-section, shared parametric geometry, charts, explorer
src/three/       Three.js procedural cutaway model
src/ui/          controls, results, validation, formatting
reference/       pyCycle reference-case generator
deploy/          nginx configuration
```
