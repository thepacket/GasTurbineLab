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

Transients, control, heat soak, the secondary air system, missions, optimisation and uncertainty use the validated cycle but have no external reference; their models are documented in [methods.md](methods.md). The sub-idle regime (start-up) uses the sub-idle map extension, dynamic-head scaling of the fixed pressure losses below 50 % corrected flow and an explicit starter-only regime where no through-flow solution exists; a high-bypass turbofan start-up does not get past that regime with the generic maps. Weight, emissions, noise, creep life and installation drag are correlations calibrated to published data where available and labelled as estimates in the interface. The commercial-engine catalogue reproduces published take-off ratings by construction; its internal temperatures and efficiencies are assumptions by generation.

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

The [NASA Heidmann report](https://ntrs.nasa.gov/citations/19750017876) includes spectral and directional source-noise modelling. This app's simplified overall-level correlation is not an implementation of the full method and has not been validated against measured spectra. Likewise, matching a few engine dry weights does not independently validate the weight correlation, and the creep-life rule has no stress/material calibration. These features are suitable for indicative comparisons within their stated limits, not certification or hardware-life decisions.

### UI correctness follow-up

Implemented after authorization for UI fixes:

1. Disable “Apply best design” for infeasible results and distinguish constraint feasibility from numerical convergence.
2. Bind optimisation cards and trajectories to the submitted variable order, even after controls change; exclude unavailable variables from submission and the run-button check.
3. Show explicit incomplete and not-applicable LTO states without incorrectly attributing every unsupported case to low rated thrust.
4. Plot clearance (mm) and efficiency delta (percentage points) separately using the existing chart component. Preserve gaps in invalid/infeasible chart series.
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
