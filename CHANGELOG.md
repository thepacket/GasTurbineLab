# Changelog

All dates 2026-10-14 unless noted. Each entry is one pushed step.

## Round 1 — the lab
- Design-point cycle solver for turbojet, two-spool separate-flow turbofan and free-turbine turboprop on NASA CEA polynomials (frozen products), ISA-1976, per-spool shaft balances, statics and areas at every station.
- SVG cross-section coloured by Tt/Pt with station callouts; Three.js procedural cutaway; T–s and station diagrams; design-point parametric explorer.
- pyCycle design-point references (8 cases) and validation tab.
- PWA (manifest, service worker, icons), desktop/tablet/phone layouts, Dockerfile, nginx, Fly.io deployment, private GitHub repository.

## Round 2 — commercial engines, chemistry, off-design
- Catalogue of 59 commercial engines calibrated to published ratings, with provenance notes.
- Gibbs-minimisation equilibrium chemistry; agreement with pyCycle to 0.05 % (stations) and 0.01 % (thrust, fuel).
- Generic cycle core with pluggable providers; constant-area mixer; three-spool layout; fan drive and propeller gearboxes with explicit speeds.
- Scaled NPSS-style component maps from pyCycle; Newton off-design solver with continuation; off-design explorer; compressor map charts; web worker.
- Compare view, shareable links, CSV export, SI/US units, accessibility and Lighthouse 100s, Playwright layout suite, GitHub Actions CI.

## Round 3 — transients, missions, maps, estimates
- Spool transients with fuel schedules and ratio-unit limiter; running-line trajectory on the map.
- Mission analysis with aircraft polar, thrust-matching throttle and N1/N2/T4 ratings.
- Custom maps: JSON/CSV upload, parametric generator, per-component assignment.
- Customer and handling bleeds, variable-area nozzle, variable-stator gain; installed thrust; P3–T3 emissions; Lighthill jet noise.
- Learn tab with seven scenarios; phone More menu; catalogue envelope fuzz test; Dependabot.

## Round 4 — fidelity and design tools
- Sub-idle map extensions and start-up transients with starter, light-off and hung-start detection.
- Stage-stacking map generator with variable-stator schedule.
- Turbine cooling effectiveness model with computed cooling flow for a target metal temperature and creep-life estimate.
- Fuels (Jet-A, SAF, hydrogen, methane) and humidity through the equilibrium chemistry.
- Nelder–Mead optimiser with constraints and mission objective; Monte Carlo uncertainty with sensitivities; WATE-style weight and size.
- Gallery of saved designs; HTML engineering report; PNG export; touch controls and auto-orbit in 3D; English/French interface.

## Round 5 — control, thermal, secondary air, certification, validation
- FADEC: N1/N2/thrust PI loops, acceleration schedule, deceleration floor, bleed valve and VSV actuators.
- Compressor and turbine maps from blade geometry (mean-line triangles, Carter deviation, Lieblein losses; throat choking, Smith-chart efficiency).
- Heat soak and tip clearance with efficiency penalties in transients.
- Secondary air system as an orifice network with seal-reversal detection.
- ICAO LTO emissions cycle with CAEP/8 limits; Heidmann fan-noise estimate.
- pyCycle off-design (6 points) and mixed-flow references; mixer designed-stream convention; agreement to 0.05 %.
- CI timeout fix; Dependabot updates merged.

## Documentation (2026-10-15)
- README restructured; docs/methods.md, docs/validation.md, docs/user-guide.md, docs/development.md; this changelog.

## Review fixes (2026-10-15)
Following an external review of code, engineering and interface:
- Mission completion is a hard feasibility constraint: `MissionResult` carries `feasible`, `maxShortfall` and `unconvergedPoints`; the optimiser penalises infeasible missions in proportion to the shortfall instead of a 5 % surcharge; the Mission view states feasibility.
- Engineering reports escape every string; shared links are validated against the input schema (unknown keys dropped, non-finite numbers replaced, map ids pattern-checked); custom maps referenced by a design travel inside the link and are registered on load.
- Custom maps saved in the browser are registered in every new calculation worker before any request runs.
- The ICAO NOx limit uses the pressure ratio of the converged sea-level static rating point, not the cruise design OPR.
- Monte Carlo draws are truncated to physical bounds (efficiencies, recovery and velocity coefficients ≤ 1, losses and flows ≥ 0) with redraws counted; non-finite or failed solves are excluded and counted.
- CO₂ per hour was understated 1000×.
- Every analysis (LTO, optimisation, uncertainty, mission, transient) keeps a snapshot of its inputs and shows a stale banner when the design changes; "Apply best design" is disabled when stale.
- Outputs carry provenance badges: reference-checked, uncalibrated model, correlation estimate; the certification panel is named "Certification estimates"; a sticky status bar summarises the operating point and solver state.
- Advanced control sections collapse by default; segmented toggles expose `aria-pressed`; cross-section parts, callouts and station rows are keyboard operable.
