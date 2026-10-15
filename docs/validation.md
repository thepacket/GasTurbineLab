# Validation

The lab is checked against NASA's [pyCycle](https://github.com/OpenMDAO/pyCycle) (version 4.4.0 on OpenMDAO 3.41, CEA thermodynamics with the `janaf` data set, fuel `Jet-A(g)`). pyCycle solves chemical equilibrium at every station and models the same element conventions, so agreement is a strong check on the thermodynamics, the component models and the off-design solver. The comparison is visible in the app's **Validate** tab and enforced by `npm test`.

## Reference cases

### Design points (`src/data/pycycle_reference.json`, `reference/pycycle_reference.py`)

| Case | Condition | Design inputs |
|---|---|---|
| Turbojet SLS | 0 m, M 0 | PR 13.5, T4 1500 K, 50 kg/s |
| Turbojet cruise | 10 km, M 0.8 | PR 12, T4 1450 K, 22 kg/s |
| Turbojet supersonic | 15 km, M 2.0 | PR 8, T4 1600 K, 30 kg/s |
| HBPR turbofan SLS | 0 m, M 0 | FPR 1.6, BPR 6, OPR 33, T4 1650 K, 400 kg/s |
| HBPR turbofan cruise | 11 km, M 0.8 | FPR 1.65, BPR 8, OPR 40, T4 1550 K, 170 kg/s |
| LBPR turbofan | 9 km, M 0.9 | FPR 3.0, BPR 0.8, OPR 27, T4 1700 K, 80 kg/s |
| Turboprop SLS | 0 m, M 0 | PR 10, T4 1350 K, 1.4 MW, 7 kg/s |
| Turboprop cruise | 7.6 km, M 0.45 | PR 11, T4 1300 K, 0.9 MW, 4.5 kg/s |

Compared quantities: Pt and Tt at every station, mass flows, net thrust, fuel flow, FAR, TSFC, turbine pressure ratios, shaft power (turboprop).

### Off-design and mixed flow (`src/data/pycycle_offdesign.json`, `reference/pycycle_offdesign.py`)

pyCycle's multi-point model (`MPCycle`) with a design point and three off-design points sharing the same generic maps (HPCMap/HPTMap for the turbojet; FanMap, LPCMap, HPCMap, HPTMap, LPTMap for the turbofan):

| Engine | Design | Off-design points |
|---|---|---|
| Turbojet | SLS, PR 13.5, T4 1500 K | SLS T4 1350 K; 6 km M 0.6 T4 1450 K; 10 km M 0.8 T4 1300 K |
| HBPR turbofan | SLS, BPR 6, OPR 33, T4 1650 K | SLS T4 1450 K; 5 km M 0.6 T4 1550 K; 11 km M 0.8 T4 1450 K |

Compared quantities off-design: thrust, fuel flow, inlet mass flow, bypass ratio, both spool speeds, compressor R-lines, and Pt/Tt at every station.

A mixed-flow low-bypass turbofan design point (M 0.8, 9 km, FPR 2.8, BPR 0.8, OPR 27, T4 1650 K) uses pyCycle's constant-area `Mixer` with `designed_stream = 1`.

## Results

| Comparison | Tolerance in tests | Typical deviation |
|---|---|---|
| Design-point stations (Pt, Tt), equilibrium chemistry | 0.1 % | ≤ 0.005 % |
| Design-point thrust and fuel flow | 0.1 % | ≤ 0.01 % |
| Off-design thrust, flow, speeds, BPR | 0.1 % | ≤ 0.02 % |
| Off-design stations | 0.1 % | ≤ 0.03 % |
| Mixed-flow design point | 0.1 % | ≤ 0.002 % |
| Frozen chemistry, thrust and fuel flow | 1 % | 0.2–0.7 % low |

The frozen-chemistry deficit is the dissociation enthalpy that equilibrium absorbs above about 1500 K; it grows with T4.

## Known differences and conventions

* **Altitude.** pyCycle's US-1976 atmosphere treats altitude as geopotential. The reference inputs set `altIsGeopotential`; the app's default is geometric altitude, which differs by 0.1–0.5 % in ambient pressure at 10–15 km.
* **Fuel enthalpy.** pyCycle's combustor takes the fuel's absolute enthalpy as an input that defaults to 0 Btu/lbm. The lab's default is the same; the real formation enthalpy of Jet-A would lower the effective heating value by about 3 %.
* **Mixer.** pyCycle sizes the designed stream's area so that its static pressure matches the other stream, which is set by its own Mach number from the upstream element. The lab offers both conventions (`mixer.designedStream`).
* **Nozzle thrust.** Both apply C_v to the ideal exit velocity in the gross-thrust momentum term and add the pressure term on the actual exit area.
* **Speed of sound.** The lab uses the frozen speed of sound in static-state calculations; pyCycle uses the equilibrium value. This shows as the 0.1–0.3 % static-velocity difference at low-Mach stations and does not affect totals.
* **Maps.** Both interpolate the same tables linearly. The lab uses bounded extrapolation outside the tabulated R-lines and checks physical flow mismatch separately from the boundary penalty (see below); pyCycle extrapolates where `map_extrap` is set. Operating points inside the tables agree; sub-idle behaviour is not validated.

## Regenerating the references

pyCycle 4.4 needs Python 3.11 and numpy < 2:

```bash
uv venv --python 3.11 reference/venv
uv pip install --python reference/venv/bin/python "numpy<2" "scipy<1.14" om-pycycle
reference/venv/bin/python reference/pycycle_reference.py  > src/data/pycycle_reference.json
reference/venv/bin/python reference/pycycle_offdesign.py  > src/data/pycycle_offdesign.json
```

Both scripts verify that every pyCycle balance converged before writing a case; a non-converged case is recorded with an `error` field and skipped by the tests.

## Convergence is reported honestly

An off-design point is reported as converged only when the Newton residual norm **and** the physical flow-matching error of every compressor and turbine are below 10⁻⁶ and no nozzle rests on its back-pressure cap. Operation beyond the tabulated R-lines of a map is solved on a documented extrapolation (stall side: one R-line linear; choke side: saturating flow, falling pressure ratio, three R-lines) and flagged on the component, in `offDesign.mapViolations` and in the warnings. Before this rule (2026-10-15) a clamped R-line with a linear penalty could cancel a flow mismatch inside the residual vector and report convergence; the catalogue envelope sweep now reports 11 of 354 points as not converged (boosters of high-bypass engines at cruise part power, where the generic LPC map does not cover the engine) and 44 converged points on an extrapolated map, instead of 354 "converged" points of which some carried flow mismatches of 3–25 %.

## What is not validated

Transients, control, heat soak, the secondary air system, missions, optimisation and uncertainty use the validated cycle but have no external reference; their models are documented in [methods.md](methods.md). The sub-idle regime (start-up) uses the sub-idle map extension, dynamic-head scaling of the fixed pressure losses below 50 % corrected flow and an explicit starter-only regime where no through-flow solution exists; a high-bypass turbofan start-up does not get past that regime with the generic maps. Weight, emissions, noise, temperature-only life and installation drag are heuristic estimates; the independent magnitude checks below do not establish engine-specific calibration. The commercial-engine catalogue reproduces nominal preset ratings by construction; its internal temperatures and efficiencies are assumptions by generation.

## Engineering readiness pass (2026-10-15, local changes)

The initial pass preserved the interface. Following authorization for UI fixes, correctness changes were made within the existing controls and visual style: result labels and states, invalid actions, error reporting and chart units. No navigation or operating-paradigm redesign was made.

* Transients reject an unconverged initial operating point, transfer ignition fuel into PI control continuously, stop hung starts as incomplete, remove starter torque at cut-out, prevent integral wind-up into fuel limits, and end at the requested duration. Thermal lags use the exact first-order update for the held gas temperature. Unlit gas paths cannot burn afterburner fuel.
* Missions reject invalid segment geometry and mass depletion. Feasibility now requires compliance with all speed/temperature ratings and non-negative finite compressor surge margins, in addition to convergence and the existing 2% thrust tolerance. The tolerance is a numerical acceptance rule, not an aircraft certification criterion. Mission fuel remains a coarse profile integration rather than a flight-dynamics or take-off-distance calculation.
* Optimisation projects simplex coordinates into bounds, honours its evaluation budget, prefers a feasible evaluated candidate when available, and returns the same frozen-chemistry model used for the reported objective. Invalid or empty searches fail explicitly.
* Uncertainty inputs enforce physical bounds and non-negative sigma. Failed rejection sampling is counted as failure rather than replaced by the mean; a run with no valid samples returns an error.
* Maps require finite positive table values, efficiencies no greater than one, and strictly increasing axes. Generated overspeed efficiencies are finite; CSV reference speed is selected from its actual axis. Map snapshots include deletions and validate before replacing the registry. Corrupt saved maps do not discard valid neighbours.
* Worker crashes reject pending requests and permit recreation. Map changes are synchronized before requests even when a worker already exists. Saved state and Gallery imports are sanitized, duplicate Gallery ids are replaced, and oversized or corrupt compressed share payloads fail safely. Gallery saves/exports carry referenced custom-map snapshots and operating mode; loading restores the maps before the analysis runs.
* Design and off-design entry points validate numeric domains. A combustor target that cannot be reached with non-negative fuel now fails explicitly instead of returning a different temperature. Transient fuel limits are refined against the solved compressor pressure, including release of a previously active limit.
* LTO totals and margins are withheld when any mode fails. Rated-thrust overrides use the corresponding reference pressure ratio. Hydrogen HC is zero. The CAEP/8 high-pressure-ratio branch is `32 + 1.6 OPR` for both thrust classes, following the [EASA emissions databank introduction](https://www.easa.europa.eu/en/downloads/45576/en). Unsupported configurations have no compliance margin.

Automated checks cover the cycle references and catalogue, new boundary cases, worker failures, imports, stale optimisation results, keyboard activation and a simulated installed-service-worker upgrade. The upgrade fixture starts with an older worker, serves the current build, triggers the app's foreground update check, and checks for exactly one reload. It does not claim to reproduce every historical production cache state.

Final local regression: 152 unit tests passed across 22 files; 64 browser tests passed, with the duplicate tablet/phone upgrade fixtures intentionally skipped (the upgrade runs on desktop). TypeScript and the production build also passed.

The [NASA Heidmann report](https://ntrs.nasa.gov/citations/19750017876) includes spectral and directional source-noise modelling. This app's simplified overall-level correlation is not an implementation of the full method and has not been validated against measured spectra. Likewise, matching a few engine dry weights does not independently validate the weight correlation, and the temperature-only life proxy has no stress/material calibration. These features are suitable for indicative comparisons within their stated limits, not certification or hardware-life decisions.

### UI correctness follow-up

Implemented after authorization for UI fixes:

1. Disable “Apply best design” for infeasible results and distinguish constraint feasibility from numerical convergence.
2. Bind optimisation cards and trajectories to the submitted variable order, even after controls change; exclude unavailable variables from submission and the run-button check.
3. Show explicit incomplete and not-applicable LTO states without incorrectly attributing every unsupported case to low rated thrust.
4. Plot clearance (mm) and relative efficiency delta (% of reference efficiency) separately using the existing chart component. Preserve gaps in invalid/infeasible chart series.
5. Use returned Monte Carlo quantiles in histogram captions and default sigma values for newly available architecture inputs.
6. Report invalid shared links and map-storage failures through existing error styles. Do not display a prior off-design result as the current solution while its replacement is pending; invalidate callbacks when the operating state changes.
7. Correct the incomplete-transient message to account for hung starts, limit failures and starter-only samples.

Field-level numeric validation hints are deferred as an interface improvement; invalid values already receive engine-level errors. The existing layout, navigation, styling and compact controls remain the basis of the interface.

## Plot review (2026-10-15, local follow-up)

The review traced plotted quantities back to solver outputs across station diagrams, compressor maps, transient trajectories, mission profiles, parameter sweeps, optimisation, uncertainty histograms and the cross-section's quantitative colour overlays. It preserves the existing chart components and visual style. The 3D rendering is a schematic with approximate geometry, not a quantitative performance plot; its temperature colours and tooltip units were checked without changing its geometry or appearance.

Corrections:

* Shared axes now handle empty, invalid, constant and microscopic-range data without invalid SVG coordinates or unbounded tick generation. Invalid x or y values break paths; isolated valid points remain visible. Tick labels increase precision when rounding would otherwise make distinct ticks identical.
* Hover values use the actual common x coordinate rather than assuming matching sample indices. Station labels are separated where they overlap, with leader lines retaining their point association. Tooltip boxes accommodate longer family names.
* Station profiles use discrete station ticks. Comparisons align station identities across architectures rather than assigning B's data to A's station names. The bypass entropy path branches at the fan exit. Entropy comparisons use each engine's own inlet reference; these total-state diagrams are not closed-cycle work diagrams.
* Sweep data is hidden until it matches the current inputs and axis/family selection. Invalid ranges fail explicitly. Off-design sweeps preserve the selected throttle mode unless temperature itself is swept. Speed and surge-margin curves include every family with solved data; failed points remain gaps in charts and exported data.
* Compressor-map speed labels are normalized by the map's actual reference speed, including maps whose axes use percentages or rpm. All tabulated speed lines are drawn. Bounds include design/operating points, stall lines and pressure ratios below unity. Map trajectories retain gaps and can show a single valid point. Transient map axes now have numeric ticks. Map overlays identify the reference-map basis; variable-geometry/delta corrections are not represented by the background lines. Operating iterates and points outside tabulated R-line or speed ranges are identified.
* Transient labels, controller units, thermal visibility and trajectory background remain tied to the submitted run when controls change. Gas-path plots omit unsolved/starter-only gas-path values; mechanical spool histories still include the explicitly identified starter-only interval.
* Mission engine-performance plots omit unconverged solver points; prescribed altitude and integrated mass remain profile quantities. Spool selection remains tied to the submitted architecture. Optimisation axes retain the submitted objective and include signed objective units and dimensional variable units.
* Histograms display single samples and constant distributions on finite axes, identify counts, and use the returned quantiles. The pressure colour legend now matches the actual logarithmic bounds and ramp; temperature endpoints identify clipping.

Regression coverage includes server-rendered plot boundary cases, custom rpm-axis maps, differing station sets, trajectory gaps, browser SVG-coordinate checks, invalid sweep recovery, stale controller labels and off-design family legends across desktop, tablet and phone. Rendering correctness does not add experimental validation to the underlying transient, mission or estimate-grade models.

Plot-review verification: 160 tests passed across 23 unit-test files; 76 browser tests passed with two intentional duplicate PWA-upgrade skips. TypeScript and the production build passed. Temperature–entropy and controller plot screenshots were inspected on the regression build.


## Transient/control plausibility audit (2026-10-15)

This audit checks implementation and compares model scope with public research. It does **not** validate generic transients against engine-test data. Reproduce the trajectories with `node reference/run-transient-audit.mjs`; the checked-in [results](../reference/transient_audit_results.json) include initial conditions, extrema, completion and warnings. Frozen chemistry is used throughout.

[NASA/TM-2010-216811](https://ntrs.nasa.gov/api/citations/20100037768/downloads/20100037768.pdf) describes C-MAPSS40k's gain-scheduled PI, protection logic and sensor/actuator dynamics. Its sea-level static acceleration example reaches 95 % rated thrust in 4.07 s from a stabilized low-power condition (Figure 9). That is a useful scale comparison, not a target for this app's different engines. The report's ratio-unit limiter uses static compressor discharge pressure; this app uses total pressure. Its controller architecture and schedules cannot be transferred unchanged.

For the app, sea-level static rating uses each default engine's design T₄, fixed design geometry and a separately solved 15 %-rated-thrust initial condition. Fuel ramps to rated flow over 0.3 s, starting at t = 0.5 s; the default open-loop controller's acceleration limiter remains enabled. Times below are measured from that command start to the first sampled 95 %-thrust crossing.

| Engine | dt = 0.04 s | dt = 0.02 s | dt = 0.01 s |
| --- | ---: | ---: | ---: |
| Default turbojet | 0.66 s | 0.62 s | 0.61 s |
| Default turbofan | 1.74 s | 1.70 s | 1.67 s |

Refinement does not remove the much faster response than NASA's example. At dt = 0.01 s, peak T₄ is about 1604 K (turbojet) and 1701 K (turbofan), versus design values 1500/1550 K; minimum compressor/HPC map surge margins are about 4.42/1.42 %. Design T₄ is not itself a specified transient redline. These small margins and temperature excursions show why this simplified limiter must not be treated as validated engine protection. No gains or inertias were tuned to force agreement with a different engine.

[NASA/TM-2016-219146](https://ntrs.nasa.gov/api/citations/20170000885/downloads/20170000885.pdf) models turbine clearance using separate rotor, blade and shroud responses, including thermal and centrifugal effects. The app's two T₃-driven states lack those turbine-specific temperatures, cooling and geometry. Its former 0.6× transfer of compressor clearance loss to turbine efficiency was therefore removed. The remaining compressor model's time constants and magnitude are illustrative; this comparison does not validate them or establish a turbine pinch-point prediction.

The default cruise turbofan thermal run crosses the modeled LPC stall line (minimum about −0.34 %). It now reports that limitation even when numerical integration completes. Default high-bypass startup still fails to establish a through-flow solution: this is an explicitly unsupported map regime, not a validated start. The turbojet startup exercises ignition and starter cut-out but has no independent start-test calibration.

Implementation fixes preserve component overrides, use current speed feedback, integrate PI error over actual elapsed time, include minimum fuel in anti-windup, reject invalid controller/thermal/inertia inputs and stop on impossible component efficiency. Regression tests include the analytic constant-power rotor energy solution with second-order step refinement, fractional-step PI integration, ignition transfer, override preservation and compressor-only thermal coupling. The only visible change is correction of the efficiency plot's units; existing warnings carry the additional validity information.


## Estimate-model audit (2026-10-15)

Reproduce with `node reference/run-estimate-audit.mjs`. [Reference values](../reference/estimate_references.json) preserve EASA dataset edition, SHA-256, sheet, rows, columns and engine UIDs; [audit results](../reference/estimate_audit_results.json) preserve the model outputs. No empirical coefficient was adjusted to fit these samples.

### Emissions

The [EASA ICAO emissions databank, March 2026](https://www.easa.europa.eu/en/downloads/131424/en), sheet “Gaseous Emissions and Smoke”, supplies non-superseded entries 2CM014 (row 87), 3CM034 (146) and 07P27GE240 (372). The table compares integrated model values with databank **average**, not certification characteristic, Dp/Foo values in g/kN.

| Catalogue engine | NOx model / reference | CO model / reference | HC model / reference |
| --- | ---: | ---: | ---: |
| CFM56-5B4 | 45.10 / 49.70 | 31.04 / 47.30 | 3.78 / 5.70 |
| CFM56-7B27 | 49.02 / 55.27 | 33.27 / 28.30 | 4.08 / 2.76 |
| GE90-115B | 65.22 / 64.09 | 22.72 / 45.33 | 2.74 / 6.11 |

NOx is within roughly 12 % for these three integrated comparisons; that does not validate the correlation. At take-off, CFM56-7B27 CO is 1.68 versus 0.20 g/kg and GE90 CO is 1.14 versus 0.122 g/kg. The apparently reasonable integrated NOx masks much poorer species/mode agreement. Catalogue OPR differs from the selected entries (32.6/27.1, 32.7/28.63, 42/43.23), and internal temperatures, combustor configuration and fuel flow are not measured matches. Retain these as magnitude checks, not an engine-specific fit. CO and HC are only indicative. The model margins now explicitly disclose the absent certification characteristic-level adjustment. LTO always uses uninstalled thrust, independently of the design's installation toggle. Hydrogen/methane and afterburner extrapolations are explicitly warned; fuel-carbon CO₂ is a separate complete-oxidation calculation, not lifecycle emissions.

### Mass

| Engine | Model assembly, kg | Reference dry engine, kg | Difference |
| --- | ---: | ---: | ---: |
| CFM56-7B27 | 1939.6 | 2386 | −18.7 % |
| GE90-115B | 8859.0 | 8761 | +1.1 % |
| PT6A-67D | 252.4 | 233.5 | +8.1 % |

Sources: EASA type-certificate sheets [E.004, §III.5](https://www.easa.europa.eu/en/downloads/7795/en), [IM.E.002, §III.5](https://www.easa.europa.eu/en/downloads/7799/en), and [IM.E.008, dimensions/dry weight](https://www.easa.europa.eu/en/downloads/7787/en). These are approximate magnitude checks with different assembly boundaries: the turbofan estimate includes a nacelle/accessory allowance. The former “dry mass” label and blanket ±30 % calibration claim were unjustified. The report now also omits weight at off-design, where flow-derived areas would resize the engine. [NASA WATE](https://ntrs.nasa.gov/api/citations/20100000016/downloads/20100000016.pdf) uses geometry, material and structural design information absent from these simple correlations; its accuracy cannot be claimed for this app.

### Installation

Fixed hardware must remain fixed when throttle changes. Off-design installation and fan-tip radius now use the design inlet area. At the default turbofan cruise condition, reducing T₄ to 80 % changes flow-derived station area from 2.169 to 1.818 m², but nacelle drag correctly remains 627.6 N. Spillage increases with the reduced airflow. Thrust matching now inherits the design installation setting unless explicitly overridden. [NASA inlet guidance](https://www.grc.nasa.gov/WWW/BGH/inleth.html) supports a fixed capture area and engine-dependent flow, but its momentum/pressure formulation is more detailed than this app's area-deficit approximation. The 0.4 coefficient and drag magnitudes remain uncalibrated; no matched installation wind-tunnel dataset was established.

### Noise and life

[Heidmann's method](https://ntrs.nasa.gov/api/citations/19750017876/downloads/19750017876.pdf) predicts spectra and direction-dependent components using stage data. The app instead uses a fitted-form heuristic, including a 12-log temperature-rise term and fixed tone offsets. Renaming it avoids claiming an implementation of that method; replacing 12 by 20 alone would not implement it. [NASA's jet-noise review](https://ntrs.nasa.gov/api/citations/19740019374/downloads/19740019374.pdf) supports the eighth-power trend for subsonic jet sound power, not the app's arbitrary absolute normalization over every exhaust regime. No matched microphone-angle, distance and operating-condition measurements validate the absolute dB levels. Noise values are therefore indicative source trends only.

[NASA creep-rupture work](https://ntrs.nasa.gov/citations/19840011857) requires material-dependent data and strength/time-temperature relationships. The app has no stress, alloy, coating, fatigue or exposure-history inputs; the renamed temperature-only life proxy cannot predict component service life. A separate implementation defect was fixed: computed cooling previously grew beyond its intended supply limit and then abruptly dropped at a higher demand. It now saturates monotonically at 25 % inlet cooling and reports unreachable targets. Tests cover the full target-temperature sweep, insufficient coolant temperature, fixed installation geometry, inherited thrust settings and LTO isolation. No material-life or absolute acoustic calibration is claimed.

## Mission ratings and integration audit (2026-10-15)

Reproduce with `node reference/run-mission-audit.mjs`; [results](../reference/mission_audit_results.json) record the default engines, UI mass heuristic, rating calculation and 4/8/16/32-point refinement. These are numerical and plausibility checks, not aircraft mission validation.

The force balance follows NASA's [Forces in a Climb](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/forces-in-a-climb/) and [General Aircraft Motion](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/general-aircraft-motion/): thrust includes drag, the weight component and longitudinal acceleration; lift includes the normal acceleration. Within a constant-Mach, constant-vertical-speed segment, atmospheric temperature changes airspeed, so neither acceleration term can generally be set to zero. Fuel uses implicit trapezoidal integration with endpoint mass coupled to thrust demand. Horizontal distance uses trapezoidal horizontal speed. The altitude coordinate and vertical rate follow the selected geometric/geopotential convention; this remains a flat-Earth trajectory approximation.

Fallback rating solutions are independently calculated at N1 (turbofan), N2 and T4, then checked against every rating. Among converged candidates within all ratings, the greatest available thrust is selected; negative/undefined compressor surge margin still invalidates the mission. An unconverged explicit T4 command is not silently replaced. Failed engine solutions stop integration before the failed interval. Partial totals cannot be a low-fuel optimiser objective. A converged but thrust-limited profile may be evaluated throughout, but its totals describe a prescribed trajectory the engine cannot actually fly.

The 2% thrust tolerance is an application-level feasibility allowance, not a certification tolerance or solver accuracy claim. Excess thrust also invalidates matched segments when more than max(1 N, 2% of demand); negative thrust demand is retained so unmodeled braking cannot appear feasible. Explicit T4 segments are exempt from the excess-thrust test: they are fuel allowances at a prescribed condition, not a solved acceleration trajectory. The 2%-design-thrust numerical floor is not a calibrated engine idle schedule.

At 8 versus 32 points, block fuel is 20771.8/20757.5 kg (turbojet), 7187.3/7186.2 kg (turbofan), and 888.1/888.0 kg (turboprop). The turbojet profile passes the modeled constraints. Turbofan and turboprop profiles have about 30.4% and 29.3% maximum thrust shortfall and are explicitly infeasible; their fuel totals must not be interpreted as achievable mission fuel. No limits or aircraft parameters were tuned to remove these failures.

The mass heuristic gives 69500/65000/16500 kg for turbojet/turbofan/turboprop. Replacing pressure-scaled thrust with a solved design-T4 sea-level-static point gives 69500/73500 kg for the jets. Thus the former UI statement that its initializer *achieves* 0.28 sea-level thrust/weight was too strong: the turbofan initializer differs by about 12% in mass. It now says rough pressure-scaled estimate; the turboprop correctly states its 0.17 kW/kg design-power assumption. Fixed template wing area and drag polar do not constitute aircraft sizing. Small positive engines no longer round to a zero aircraft mass.

Scope exclusions: ground roll, rotation, stall/CLmax, Mach-transition acceleration between segments, airbrake capacity, fuel capacity/empty mass and reserves are not modeled. Take-off is a fixed-speed fuel allowance. Adjacent altitude discontinuities and non-level hold/cruise segments are rejected; the turbofan descent now ends at the following hold's 1500 m. “Feasible” means only the sampled engine/trajectory constraints above, not operational flight approval or complete aircraft performance validation.

Verification: 182 unit tests across 26 files passed, including 11 mission-audit regressions; 76 browser tests passed with two intentional PWA duplicate skips. TypeScript and the production build passed. UI structure is unchanged.

## Release workflow audit (2026-10-15)

Live checks on `aaf7bac` confirmed saved-design persistence, JSON export, shared-link restoration and generated-map assignment across reloads. Temporary Gallery and map entries were removed afterward. Corrections below were verified locally; this audit does not imply they have been deployed.

The previous PWA test exercised a focus event with a non-caching worker. The extended test caches an older HTML shell, changes the served worker/page, delays client claiming and checks both focus-triggered updates and a returning visit. The returning-visit case failed before an explicit startup `registration.update()` was added: it loaded the old shell without automatically refreshing. With the startup check, it reaches the new shell with one automatic refresh, then loads offline without an unhandled update rejection. The initial suspected activation/claim race did not reproduce, so no replacement of the registration mechanism was made. Already-open older clients must first obtain the new JavaScript before they benefit from its startup check; verify the visible version during rollout.

Browser regressions compare off-design CSV net thrust with the printable report and Gallery JSON summary, including actual operating T4 after reload. Previously Gallery recomputed design-point performance and parsing reset T4 to the design target. Saving now uses the current result and waits for pending off-design computation. Legacy summaries are not retroactively recalculated.

Portable-map tests carry a legacy custom ID containing spaces and Unicode through sharing, reload, worker recreation, Gallery export/import into a clean browser, and another reload. Imported filenames previously became IDs that the persistence sanitizer rejected. New imports use UUID-based IDs; valid legacy identifiers remain supported. Separate unit tests verify absent HP extraction/propeller-power overrides remain absent (inheritance is preserved) and `burnerLit: false` is retained. The off-design power-extraction control now also displays the inherited design value when no override exists, matching the solver.

Mission and Monte Carlo stale-banner checks supplement the existing optimiser stale-bound and transient provenance coverage. No UI redesign or new educational flow was introduced. Scientific calibration limits documented above remain unchanged: workflow correctness does not validate transient dynamics, aircraft performance or empirical estimates against engine-test data.

Verification: 185 unit tests passed. The full browser suite passed 86 tests with four intentional duplicate PWA lifecycle skips; after the final legacy-ID and inherited-control corrections, all 12 affected map/release checks and all three operating-result export checks passed again. Each browser run rebuilt production assets with TypeScript checking. `git diff --check` passed.

## Data-source reproducibility (2026-10-15)

All 11 selected species and nine generic map tables exactly match the pinned upstream pyCycle source recorded in [pycycle-data-provenance.json](../reference/pycycle-data-provenance.json). Run `python3 reference/verify-pycycle-data.py /path/to/pyCycle` against that checkout to repeat the comparison without executing upstream code. This establishes equivalent source data; it does not recover the unknown original extraction date or expand cycle-validation coverage.

The EASA workbook checksum and all 69 extracted cell values in the three-engine emissions reference are checked by `python3 reference/verify-emissions-reference.py /path/to/workbook.xlsx`. Reproduction terms and attribution are recorded in [third-party notices](../THIRD_PARTY_NOTICES.md).

The [catalogue source ledger](../reference/catalogue-provenance.json) covers all 59 entries and distinguishes verified numeric fields, independent comparisons, and unresolved legacy inputs. Different emissions certification entries may report different BPR, OPR or thrust for the same model identifier. These require configuration/rating-basis review; they have not been silently substituted into the presets.
