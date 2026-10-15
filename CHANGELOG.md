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

## Review fixes, second pass (2026-10-15)
- Shared links keep every valid optional setting: mixer designed stream and bypass Mach, geopotential altitude flag, chemistry and fuel, and off-design geometry, installation and component-delta overrides.
- Custom-map packaging moved into the share function, so Gallery links and header links both carry the maps a design references.
- The optimiser's stale check covers bounds, evaluation budget, the operating point and the architecture.
- One-at-a-time sensitivities are clipped to the physical bounds and the perturbation actually applied is shown.
- A worker-registration test exercises the request handler directly: an off-design request with a custom map fails before registration and succeeds after.
- The build version (commit · time) is shown in the header; the service worker claims clients immediately and checks for updates hourly and on every return to the tab, so installed copies pick up new deployments without a second reload.

## Review fixes, fourth pass — transients and control (2026-10-15)
Following an external review of the transient/control implementation:
- **Honest convergence.** The off-design solver tracks the physical flow-matching error of every compressor and turbine apart from the R-line / expansion-ratio clamp penalty; a point is converged only when both are below 10⁻⁶ and no nozzle rests on its back-pressure cap. Operation beyond the tabulated R-lines is solved on a documented extrapolation (stall side linear, choke side with saturating flow) and flagged on the component, in `mapViolations` and in the warnings; surge margin is no longer clipped at 0 %. The catalogue sweep now reports 11/354 points as not converged instead of hiding flow mismatches of up to 25 %.
- **Sub-idle physics.** Burner, duct, mixer and inlet pressure-loss fractions scale with dynamic head below 50 % corrected flow; the sub-idle map extension's windmilling loss scales with flow²; the nozzle back-pressure cap is 0.9999·Pt and flagged. A validated-case mixed design with an unbalanced mixer now warns at the design point.
- **Start-up.** The burner is explicitly unlit before light-off (zero fuel, zero heat release); no limiter floor applies while unlit; the fuel schedule and the controller demand are referenced to light-off; where no through-flow solution exists the spool is integrated in an explicit starter-only regime marked on every sample. The UI stretches the ramp to 20 s from light-off when start-up is enabled. Known limitation: a high-bypass turbofan start does not get past the starter-only regime with the generic maps.
- **Failed steps.** Each fixed-speed solve retries from the last converged state, a sub-idle guess and the design guess; an unconverged corrector stops the trajectory (`complete = false`, `stoppedAt_s`, red banner), an unconverged predictor falls back to explicit Euler from the converged corrector and is counted. The limiter is applied before the first solve of a step, from the last converged P3.
- **Limiter precedence.** `Controller.limiter` selects the FADEC schedule or the manual Wf/P3 limit and floor; the view disables the inactive set. The default acceleration schedule gains a start-up branch (1.0× at 20 %, 1.2× at 40 % corrected speed).
- **Clearance.** The computed tip clearance is reported as is, contact (δ ≤ 0) is flagged per sample and on the result with a warning; the 0.05 mm floor only protects the efficiency correlation.
- Tests: `review_fixes3.test.ts` covers flow matching past the stall line, penalty-only "convergence" rejected, unlit burner, UI start-up schedule, starter-only regime, truncation, limiter precedence both ways, contact detection; the fuzz test reports extrapolated points.

## Review fixes, third pass (2026-10-15)
- The comparison design B is validated by the same complete `sanitizeInputs` as design A (mixer settings, geopotential flag, chemistry, fuel, map assignments); a round-trip test checks B solves identically after sharing.
- A test stubs the browser `Worker` and checks that a new worker receives the saved custom maps before its first request.

## Transient/control physics audit — 2026-10-15 (unreleased)
- Preserve off-design component modifiers during transient integration; compose compressor thermal corrections with them and remove the unsupported compressor-temperature correction to turbine efficiency.
- Use current spool-speed feedback, integrate PI error over elapsed time including fractional final steps, and include minimum-fuel saturation in anti-windup.
- Reject invalid inertia, controller, starter and thermal settings; stop on impossible component efficiencies. Report negative surge margins and unsupported turbofan startup through existing warnings.
- Correct the efficiency plot's relative units without changing its layout. Document model scope, NASA comparisons, reproducible trajectories and time-step refinement; engine-specific calibration remains unvalidated.

## Estimate-model audit — 2026-10-15 (unreleased)
- Hold nacelle dimensions and acoustic fan radius fixed at design geometry off-design; inherit the installation toggle during thrust matching and explicitly isolate uninstalled LTO calculations.
- Saturate computed cooling continuously at its inlet supply limit and flag unreachable targets, including insufficient coolant temperature.
- Stop estimating hardware mass from off-design flow areas. Correct dry-mass, Heidmann and creep-life claims to assembly mass, heuristic source noise and temperature-only life proxy; preserve existing layout.
- Add reproducible EASA emissions/type-certificate magnitude comparisons, reference provenance and regression tests. Document the remaining CO/HC, acoustic, installation and life-model calibration limits without tuning to the small reference sample.
- Validation: 171 unit tests and 76 browser checks pass; two intentional browser skips. TypeScript and production build pass.
