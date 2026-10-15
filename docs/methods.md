# Methods

This document describes the physics and numerics implemented in `src/engine/`. Equations are given in the form used by the code. SI units throughout.

## 1. Gas model (`gas.ts`, `equilibrium.ts`)

**Species data.** NASA CEA 9-coefficient polynomials for Cp°/R, H°/RT and S°/R of Ar, CO₂, H₂O, N₂, O₂, CO, H₂, OH, NO, O and H, taken from pyCycle's `janaf` set (`src/data/janaf.json`). Two temperature ranges per species (200–1000 K, 1000–6000 K).

**Composition.** Element amounts b = {N, O, Ar, C, H} in kmol per kg of mixture, identical to pyCycle's `b0` vector. Dry air is pyCycle's `CEA_AIR_COMPOSITION`; humid air adds H₂O at the water/air ratio from relative humidity (Magnus saturation pressure). Fuels are defined by their elemental formula, lower heating value and absolute enthalpy as supplied: Jet-A as C₁₂H₂₃ (pyCycle's definition), SAF as C₁₂H₂₆, hydrogen H₂, methane CH₄. Mixing with fuel is a mass-weighted sum of element amounts.

**Frozen mode.** Complete lean combustion: CO₂ = C, H₂O = H/2, O₂ = (O − 2C − H/2)/2, N₂ = N/2, Ar. Mixture h(T) and s(T,P) are mole-weighted sums with the ideal-gas mixing entropy and −R ln(P/P₀).

**Equilibrium mode** (default, used when T ≥ 1000 K). Gibbs free energy is minimised with the element-potential formulation of Gordon & McBride (NASA RP-1311): species moles nᵢ = n·exp(Σⱼ aᵢⱼ πⱼ − cᵢ) with cᵢ = μᵢ°/RT + ln(P/P₀); Newton iteration on the element potentials πⱼ and ln n with element-balance and mole-sum residuals, damped steps, converged to 10⁻¹¹. The frozen composition is the initial guess and inactive elements/species are dropped. Below 1000 K dissociation is below 10⁻⁸ and the frozen result is used. Results are memoised per (T, P).

**Derived properties.** h(T,P), s(T,P), frozen cp and γ, local gas constant R·n, speed of sound (frozen), equilibrium cp = ∂h/∂T|P by central difference. Inversions (T from h, T from s, P from s, isentropic end states) use damped Newton with halving line search.

## 2. Atmosphere and flow states (`atmosphere.ts`, `flow.ts`)

US Standard Atmosphere 1976 to 86 km with geometric-to-geopotential conversion (pyCycle treats altitude as geopotential; the reference cases set that flag). ΔT from ISA shifts temperature at constant pressure.

A flow is (gas, Pt, Tt, ht, W). Static states are obtained at a given Mach number (solve ht − h(Ts,Ps) = ½(M a)² along the isentrope), at a given static pressure (isentropic expansion), or at a given area (subsonic branch, bisection; returns the sonic state when the area is below the choking area). Totals from statics iterate T from h and P from s.

## 3. Components (`components.ts`)

* **Compressor.** Pt₂ = PR·Pt₁; ideal exit on the isentrope; ht₂ = ht₁ + (h_ideal − ht₁)/η. Bleeds are extracted at exit conditions (pyCycle `frac_P = frac_work = 1`); power = W_in·(ht₂ − ht₁). Polytropic efficiency reported from the entropy rise.
* **Turbine.** Main flow and each cooling stream expand separately from their own entry pressure (entry pressure = Pt_out + f·(Pt_in − Pt_out)) to Pt_out with the same isentropic efficiency, then mix by enthalpy (pyCycle's `EnthalpyAndPower`). Design mode finds PR for a required power by bisection on ln PR.
* **Combustor.** Fuel at FAR relative to the air mass; exit enthalpy = (W h_in + W_f h_fuel − (1−η_b) W_f LHV)/(W + W_f); Pt loss ΔP/P. Design mode solves FAR for a target Tt₄ by Newton; off-design burns a given FAR.
* **Nozzle.** Convergent: choked when P_amb is below the sonic static pressure, exit at M = 1 and Ps₉ > P_amb; otherwise expanded to ambient. Convergent–divergent: fully expanded. Gross thrust Fg = W·V₉·C_v + (Ps₉ − P_amb)·A₉ with the ideal exit velocity (pyCycle's convention). The back pressure is capped at 0.995·Pt so areas stay finite in sub-ambient transients.
* **Mixer.** Constant-area mixing of core and bypass streams. One stream's Mach is specified; the other is expanded to the same static pressure (pyCycle's `designed_stream`). Mixed state from mass, impulse (Σ Ps A + W V) and energy in the summed area, subsonic branch by bisection on exit static pressure; then a pressure loss. Off-design holds both areas and reports the static-pressure mismatch as a residual.
* **Propeller.** Actuator disc: P_avail = T·(V₀ + w), w = ½(−V₀ + √(V₀² + 2T/ρA)), solved for T; profile efficiency, gearbox efficiency and gear ratio applied; helical tip Mach reported.
* **Cooling model.** Effectiveness ε(m) = ε_max·m/(m + 0.03) per cooled row with m the row flow fraction; ε_req = (T₄ − T_metal)/(T₄ − T_coolant), T_coolant = T₃ + ΔT_pre-swirl. Inlet (working) flow 1.6 m and exit (non-working) flow 0.6 m. Creep life rule of thumb: 25 000 h at 1200 K, halving every 20 K.

## 4. Design point (`core.ts`, `cycle.ts`)

`evaluate(inputs, provider)` walks the gas path station by station for each architecture. A **provider** supplies component operating points: at the design point compressors use the given PR and η and each turbine's PR is solved for the shaft balance (turbine power × η_mech = compressor power + extraction, or the demanded shaft power for a power turbine). Statics are computed at the sizing Mach numbers, which produces areas that drive the cross-section, 3D geometry and the off-design areas.

Station numbering follows SAE ARP 755A: 0, 2, 21, 13, 22, 25, 3, 4, 45, (47), 5, 6, 7, 9, 17, 19. Performance: net thrust, TSFC, specific thrust, OPR, FAR, efficiencies (thermal from effective jet kinetic power, propulsive 2V₀/(V_eff + V₀) generalised through Fg/W), installed figures, emissions, noise.

## 5. Off-design (`maps.ts`, `offdesign.ts`)

**Maps.** NPSS-style tables (α, Nc, R-line) → (Wc, PR, η) for compressors and (α, Np, PR) → (Wp, η) for turbines, bilinear in the first α slice, scaled through the design point by s_Nc, s_PR = (PR−1)/(PR_map−1), s_η, s_Wc (and s_Np, s_Wp). Corrected flow W√θ/δ and speed N/√θ for compressors; W√Tt/Pt and N/√Tt for turbines (pyCycle's forms). Surge margin = (PR_stall/PR · Wc/Wc_stall − 1)·100 along the speed line. Below the lowest tabulated speed line the map is extended with Wc ∝ Nc, PR−1 ∝ Nc² and falling efficiency; turbines unchoke below the tabulated PR range with Wp ∝ √(1 − 1/PR²).

**Unknowns and residuals.** Inlet flow W, bypass ratio, spool speeds N_LP (N_IP) N_HP, FAR, one R-line per compressor, one PR per turbine. Residuals: scaled map flow / actual flow − 1 at every compressor and turbine, shaft power balances, nozzle throat area / design area − 1, mixer static-pressure match, and the throttle target (T4, fuel flow, N_HP, N_LP or thrust). Five unknowns for a turbojet, six for a turboprop (constant-speed power turbine), ten for a two-spool turbofan, twelve for three spools.

**Solver.** Newton with forward-difference Jacobian, step limiting to 50 % of each variable's scale, backtracking line search, rejection of non-finite residuals; a retry from the design guess when a warm start fails; then continuation in throttle, altitude and Mach from the design point in six steps. R-lines are clamped to the tabulated range with a linear penalty so the system stays square.

**Geometry and bleeds off-design.** Nozzle area multiplier A8, customer bleed, handling bleed (to the bypass duct, or overboard), variable-stator flow gain (map flow × (1 + g(Nc/Nc,des − 1))), and per-component efficiency/flow multipliers used by the thermal model.

**Secondary air system.** At the design point, orifices are sized (Cd·A from the compressible orifice law, choked or unchoked) to pass the design cooling, customer and leakage flows between P3 and their sinks (P4, P45, a fixed customer manifold, ambient). Off-design each flow follows the same law on the current pressures, cooling fractions and customer bleed are recomputed, and the interstage seal (feed between P25 and P3 against the turbine cavity at a fraction of P45) is checked for reversal.

## 6. Transients (`transient.ts`)

Spool dynamics I·ω·dω/dt = P_turbine − P_load with I per spool. At each step the gas path is solved quasi-steadily with speeds held as states (power residuals become the reported imbalance), fuel from the schedule or controller, limited by a ratio-unit Wf/P3 ceiling and floor. Heun (RK2) integration. **Start-up** adds a starter torque until cut-out, windage/friction ∝ N², a windmilling speed fraction at forward speed, light-off when N₂ and T₃ pass thresholds, and hung-start detection.

**FADEC.** Demand (N₁, N₂ or thrust) ramped to a target; PI on the relative error, WfCmd = Wf_base + Wf_des(Kp·e + Ki∫e), anti-windup with back-off while limited; acceleration schedule of Wf/P3 against corrected HP speed; deceleration floor; handling bleed valve open below a set N₂; variable-stator gain.

**Heat soak and clearance.** Casing and disc temperatures follow T₃ as first-order lags (τ_casing, τ_disc). Clearance δ = δ_cold + α(T_c − T₀)r − [α(T_d − T₀)·0.92 r + δ_cf (N/N_des)²]. Efficiency delta Δη = −k·(δ − δ_des)/h on the HPC (and 0.6× on the HPT), flow capacity 0.3Δη, relative to the design clearance so the design point carries no penalty.

## 7. Mission (`mission.ts`)

Segments: take-off and hold (duration), cruise (distance), climb and descent (rate). Aircraft: mass, wing area, CD₀, induced factor k, engine count, installed thrust option. Thrust required per engine = (D + m g·ROC/V)/n with D = q S (CD₀ + k C_L²). Throttle is solved for thrust; if the solution exceeds the N₁, N₂ or T₄ rating the point is re-solved at the limit and the shortfall is reported. Fuel and mass are integrated segment by segment; the aircraft mass defaults to a thrust/weight ratio of 0.28 at sea level for the current engine.

## 8. Design studies

* **Optimiser** (`optimize.ts`): Nelder–Mead over chosen inputs with bound clipping, quadratic penalties for T₃, T₄, minimum thrust, metal temperature and an off-design surge-margin check; objectives TSFC, specific thrust, thrust, thermal efficiency or mission block fuel.
* **Monte Carlo** (`montecarlo.ts`): independent normal perturbations (Mulberry32 PRNG, Box–Muller) of efficiencies, losses and coefficients; distributions of thrust, TSFC, fuel flow, T₃ and thermal efficiency; one-at-a-time +1σ sensitivities.
* **Weight** (`weight.ts`): component correlations in the style of WATE/Raymer from annulus areas, pressure ratios and temperatures, with a global factor calibrated to published dry weights (CFM56-7B, GE90-115B, PT6A-67, JT8D within ±30 %).
* **Installation** (`core.ts`): additive inlet drag 0.4·q₀·max(A_hl − A₀, 0) with A_hl from the design capture ratio, nacelle friction C_f·1.25·q₀·πD L, afterbody drag C_d·q₀·(A_max − A₉).
* **Emissions** (`core.ts`, `certification.ts`): EI_NOx = 32·(P₃/2965 kPa)^0.4·exp((T₃ − 826)/194) g/kg, EI_CO = 0.4 + 40·exp(−(T₃ − 450)/110), EI_HC = 0.05 + 6·exp(−(T₃ − 450)/90), CO₂ from fuel carbon content. ICAO LTO cycle at 100/85/30/7 % of rated sea-level static thrust for 0.7/2.2/4.0/26 min; Dp/Foo against the CAEP/8 NOx limit (piecewise in OPR and rated thrust) and 118 g/kN CO, 19.6 g/kN HC.
* **Noise** (`core.ts`, `certification.ts`): jet mixing OASPL at 1 m = 141 + 10 log₁₀ Σ (ρⱼ/ρ₀)²((Vⱼ − V₀)/a₀)⁸ Aⱼ; fan inlet broadband (simplified Heidmann) from fan temperature rise, mass flow and tip Mach, with a tone a few dB above and a buzz-saw note above Mach 1; energy sum for the total.

## 9. Map generators (`custommaps.ts`)

* **Parametric**: elliptical speed lines with stall pressure ratio ∝ Nc^2.1 and a mid-map efficiency peak.
* **Stage stacking**: per stage ψ = ψ*(1 + a(1 − φ/φ*)), parabolic loss bucket, compressibility through density continuity, front-stage variable stators rotating the design flow coefficient with speed.
* **Blade geometry**: per stage mean radius, blade height, rotor inlet/exit metal angles, stator exit angle, solidity. Velocity triangles on the mean line, Carter's deviation δ = 0.23θ/√σ, Lieblein diffusion factor and incidence losses, stall from flow-coefficient and diffusion-factor limits. A consistent-defaults generator sets zero design incidence for a chosen loading and flow coefficient.
* **Turbine from geometry**: nozzle throat area sets the choking flow, flow unchokes below the critical PR, Smith-chart efficiency in loading Δh/U² and flow coefficient.

## 10. Numerical cost

A design-point solve takes about 0.6 ms with frozen chemistry and 16 ms with equilibrium; an off-design Newton solve 5–25 ms frozen. Sweeps, transients, missions, optimisation, Monte Carlo and LTO cycles run in a web worker; the interactive design point runs on the main thread.
