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
* **Maps.** Both interpolate the same tables linearly. The lab clamps R-lines to the tabulated range with a penalty and extends maps below the lowest speed line for start-up; pyCycle extrapolates where `map_extrap` is set. Operating points inside the tables agree; sub-idle behaviour is not validated.

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
