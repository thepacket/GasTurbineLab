# User guide

Open https://gas-turbine-lab.fly.dev/ (or `npm run dev` locally). The app installs as a PWA and works offline after the first visit.

## Layouts

* **Desktop** (≥ 1180 px): controls on the left, cross-section and 3D view in the centre, results on the right. The header switches the centre to Explore, Compare, Learn or Validate, and the **Tools** selector opens Transient, Mission, Optimise, Uncertainty, Maps and Gallery.
* **Tablet** (760–1179 px): controls on the left, a view selector in the header for everything else.
* **Phone** (< 760 px): bottom tabs for Build, Section, 3D, Results, Explore, Learn and a **More** menu for the rest.

Header buttons: language (EN/FR), report, PNG export of the cross-section, units (SI/US), share link, theme.

## Build

**Architecture.** Turbojet, turbofan or turboprop. Switching loads sensible defaults for that type. **Generic presets** cover typical designs and the pyCycle reference cases; **Commercial engine** loads one of 59 catalogue engines calibrated to its published take-off rating, with a note stating which figures are published and which are estimated. Any later change marks the note as modified.

**Operating point.** *Design point* means every slider defines the engine: pressure ratios and efficiencies are specified, turbine pressure ratios are solved for the shaft balance, and nozzle and mixer areas follow. *Off-design* freezes that geometry and maps and lets you set altitude, Mach, ΔT ISA, the throttle (T4, fuel flow or HP speed), power extraction, propeller load (turboprop), nozzle area and bleeds; speeds, flows and bypass ratio are solved. Off-design solves run in a worker; the results pane shows the solver status and unknowns.

**Sections.** Basic sections are open; advanced ones (variable geometry and bleeds, secondary air, installation, inertia, shaft speeds, cooling, fuel and gas model, afterburner) are collapsed by default and remember their state. Flight condition; inlet; layout (spools, separate or mixed exhaust, fan gear ratio, mixer sizing); fan and bypass; compressors; combustor; turbines (efficiencies, mechanical efficiency, power extraction); afterburner (turbojet and mixed turbofan); propeller and gearbox; nozzles; variable geometry and bleeds; secondary air system (turbofan); installation; spool inertia; design shaft speeds; turbine cooling (fixed fractions or a target metal temperature); fuel and gas model (fuel type, humidity, chemistry, fuel enthalpy, heating value).

Number fields accept typed values; sliders snap to their step.

## Section and 3D

The cross-section is drawn from the solved flow areas and coloured by total temperature or pressure (toggle at top left). Station callouts show the value at each station; hover for the full state, click to highlight the station in the table. The 3D cutaway rotates its blade rows, can be orbited with the mouse or touch, toggled between cutaway and full casing, set to auto-orbit, reset, and exported as PNG. On touch devices, buttons rotate, tilt and zoom.

## Results

Performance cards (thrust, TSFC, specific thrust, efficiencies, shaft power for turboprops, installed thrust when enabled), warnings, the off-design solver summary, shaft balances with speeds, the T–s diagram and station profiles, compressor maps with design and operating points, the station table (CSV export), component details including cooling flows, metal temperature and creep life, the weight and size estimate, the secondary air system when enabled, the certification panel (noise estimate and the ICAO LTO cycle on request), and emissions.

## Explore

Sweeps one parameter, optionally over a family of a second parameter. *Design sweeps* re-design the engine at each point; *off-design sweeps* fly the fixed engine (throttle, altitude, Mach, ΔT, propeller load) and also show spool speeds, surge margins, inlet flow, bypass ratio and T4. Chemistry defaults to frozen for speed. CSV export of the sweep.

## Compare

Pins the current design as B, or loads B from the generic presets or the catalogue, and shows a delta table with overlaid T–s and station profiles.

## Transient

Choose the start T4, the final fuel fraction, the ramp, the limiter settings and the duration, then **Run**. Options: *start from shutdown* (starter torque, cut-out, light-off speed and fuel, friction; enabling it moves the ramp to light-off, stretches it to 20 s and caps the final fuel at half the design flow), the **FADEC** (open loop, N1, N2 or thrust control with gains, acceleration schedule, deceleration floor, bleed valve and VSV gain), and *heat soak and tip clearance* (time constants, clearances, blade height, casing radius, growth, efficiency sensitivity). The **limiter** selector decides which Wf/P3 limits are in force: the FADEC schedule and floor, or the manual limit and floor of the fuel schedule (0 = off); the inactive set is greyed out.

Only converged gas-path solutions are plotted. If a step cannot be solved the run stops early, a red banner states the stop time and the warning names the components outside their maps; the cards then describe the last converged state. In a start-up, samples before a through-flow solution exists are in the *starter-only regime* (no fuel, no thrust, no gas-path quantities) and the cards say so; a start whose gas path cannot be established ends as a hung start with that reason. Surge margins below zero mean the compressor is past its stall line (the map is extrapolated and flagged). With heat soak on, the *Min tip clearance* card turns red when the computed clearance reaches zero (contact) and the warning marks the clearance model as outside its range. Charts: spool speeds, demand vs measured, fuel command vs delivered, thrust, surge margins, temperatures, metal temperatures, clearance and efficiency penalty, and the running-line trajectory on the compressor map.

## Mission

Edit the aircraft (mass, wing area, CD₀, k, engine count, installed thrust) and the segment table (kind, altitudes, Mach, duration/distance/rate, optional fixed T4 fraction), set the ratings (N1, N2, T4 limits), and **Fly mission**. Output: block fuel, time and distance, per-segment fuel, profile charts, and a point table with any rating limits that applied.

## Optimise

Pick design variables and bounds, an objective (TSFC, mission block fuel, specific thrust, thrust, thermal efficiency), constraints (T3 max, minimum thrust, optional surge-margin check at a chosen off-design condition) and an evaluation budget. The convergence history and variable traces are plotted; **Apply best design** loads the result into Build.

## Uncertainty

Select the uncertain inputs and their standard deviations, the sample count, and run. Histograms with percentiles for thrust, TSFC, fuel flow and T3, plus one-at-a-time sensitivities.

## Maps

Assign a built-in or custom map to each compressor and turbine. Upload JSON (the structure in `src/data/maps.json`) or CSV grids, generate a parametric map, stack stages with a variable-stator schedule, or build maps from blade geometry (per-stage radii, heights, angles, solidity) and from turbine nozzle geometry. Custom maps stay in the browser's local storage.

## Gallery and sharing

**Gallery** saves named designs in the browser with JSON export/import, share links, loading and comparison. The header **share** button copies a link that encodes the whole design, operating point and comparison. **Report** opens a self-contained HTML engineering report for printing or saving as PDF.

## Learn

Seven guided scenarios load a design, open the relevant view and explain what to look for: bypass ratio and propulsive efficiency, T4 and take-off thrust, pressure ratio and thermal efficiency, altitude effects, part power and the TSFC bucket, acceleration and surge margin, and block fuel.

## Validate

Every station and performance figure against pyCycle for the design-point, off-design and mixed-flow reference cases, with deviations and status markers.

## Provenance and stale results

Every result area carries a badge: **reference-checked** (agrees with pyCycle on the validation cases: design point, off-design, mixer), **uncalibrated model** (physically based but without an external reference: transients, control, thermal, secondary air, mission, optimisation, uncertainty) or **correlation estimate** (weight, emissions, noise, creep life, installation drag, certification). Analyses that run on request keep a snapshot of their inputs; if you change the design afterwards, a banner marks the old result as stale and, for the optimiser, disables applying it until it is rerun. The status bar at the top of Results shows the operating mode, condition, fuel, chemistry and solver state.

## Units and conventions

Inputs are SI. The units toggle changes the display of results, tables and callouts to US customary (lbf, psi, °R, lb/s, hp, lb/(lbf·h), ft/s, in²). Station numbers follow SAE ARP 755A. Temperatures are total unless marked static. Efficiencies are isentropic. Fuel/air ratio is fuel mass per air mass at the combustor.
