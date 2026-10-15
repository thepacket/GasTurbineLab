/**
 * Design optimisation: Nelder–Mead simplex with bound handling and penalty
 * constraints, over a user-chosen set of design variables.  Objectives can be
 * design-point figures (TSFC, specific thrust, thrust) or mission block fuel.
 */
import { EngineInputs } from './types';
import { solveEngine } from './cycle';
import { makeDesignPoint, solveOffDesign } from './offdesign';
import { runMission, MissionInputs } from './mission';

export interface DesignVariable { path: string; label: string; min: number; max: number }
export type Objective = 'tsfc' | 'specificThrust' | 'thrust' | 'missionFuel' | 'thermalEff';
export interface Constraint { kind: 'T3max' | 'T4max' | 'surgeMarginMin' | 'FnMin' | 'metalMax'; value: number }
export interface OptimizeInputs { variables: DesignVariable[]; objective: Objective; constraints: Constraint[]; mission?: MissionInputs; checkOffDesign?: { altitude_m: number; mach: number; T4frac: number }; maxEvals: number }
export interface OptimizeTrace { eval: number; objective: number; penalty: number; x: number[]; feasible: boolean }
export interface OptimizeResult { best: EngineInputs; bestX: number[]; objective: number; trace: OptimizeTrace[]; evals: number; converged: boolean; feasible: boolean; baseline: number; warnings: string[] }

export const VARIABLES: DesignVariable[] = [
  { path: 'BPR', label: 'Bypass ratio', min: 2, max: 14 },
  { path: 'fan.PR', label: 'Fan pressure ratio', min: 1.2, max: 2.2 },
  { path: 'lpc.PR', label: 'Booster pressure ratio', min: 1.1, max: 3.5 },
  { path: 'hpc.PR', label: 'HPC pressure ratio', min: 5, max: 25 },
  { path: 'comp.PR', label: 'Compressor pressure ratio', min: 4, max: 30 },
  { path: 'burner.T4_K', label: 'Turbine inlet temperature', min: 1200, max: 1950 },
  { path: 'flight.W_kgs', label: 'Inlet mass flow', min: 1, max: 1500 },
  { path: 'inlet.MN', label: 'Inlet Mach (sizing)', min: 0.4, max: 0.75 },
  { path: 'mixer.MNcore', label: 'Mixer core Mach', min: 0.25, max: 0.6 },
];
function setPath(obj: any, path: string, value: unknown): any { const [h, ...rest] = path.split('.'); const c = { ...obj }; c[h] = rest.length ? setPath(obj[h] ?? {}, rest.join('.'), value) : value; return c; }
export function getPath(obj: any, path: string): any { return path.split('.').reduce((o, k) => o?.[k], obj); }

export function runOptimization(base: EngineInputs, oi: OptimizeInputs, progress?: (t: OptimizeTrace[]) => void): OptimizeResult {
  const warnings: string[] = [];
  const vars = oi.variables;
  const n = vars.length;
  if (!n || new Set(vars.map(v => v.path)).size !== n) throw new Error('Select at least one distinct design variable.');
  for (const v of vars) if (!VARIABLES.some(x => x.path === v.path) || !Number.isFinite(getPath(base, v.path)) || !Number.isFinite(v.min) || !Number.isFinite(v.max) || v.min >= v.max) throw new Error(`Invalid bounds or variable: ${v.path}.`);
  if (!Number.isInteger(oi.maxEvals) || oi.maxEvals < n + 2 || oi.maxEvals > 100000) throw new Error(`Evaluation budget must be an integer from ${n + 2} to 100000.`);
  if (oi.objective === 'missionFuel' && !oi.mission) throw new Error('Mission fuel optimisation requires a mission.');
  if (oi.constraints.some(c => !Number.isFinite(c.value))) throw new Error('Constraint values must be finite.');
  if (oi.constraints.some(c => c.kind === 'surgeMarginMin') && !oi.checkOffDesign) throw new Error('A surge-margin constraint requires an off-design check point.');
  const trace: OptimizeTrace[] = [];
  let evals = 0;
  const apply = (x: number[]): EngineInputs => { let inp = { ...base, chemistry: 'frozen' as const }; vars.forEach((v, i) => { inp = setPath(inp, v.path, Math.min(v.max, Math.max(v.min, x[i]))); }); return inp; };
  const objective = (inp: EngineInputs): { f: number; pen: number; feasible: boolean } => {
    evals++;
    let r; try { r = solveEngine(inp); } catch { return { f: 1e9, pen: 1e9, feasible: false }; }
    let f: number;
    let missionPen = 0;
    switch (oi.objective) {
      case 'tsfc': f = r.perf.TSFC_mg_Ns; break;
      case 'specificThrust': f = -r.perf.specificThrust; break;
      case 'thrust': f = -r.perf.Fn / 1000; break;
      case 'thermalEff': f = -r.perf.thermalEff * 100; break;
      case 'missionFuel': {
        if (!oi.mission) { f = r.perf.TSFC_mg_Ns; break; }
        try {
          const dp = makeDesignPoint(inp); const m = runMission(dp, oi.mission); f = m.totals.fuel_kg;
          // mission completion is a hard constraint: a thrust shortfall or an unconverged point is infeasible,
          // with a penalty that grows with the shortfall so the simplex is pushed back toward feasibility
          if (!m.feasible) missionPen = 1 + 50 * m.maxShortfall + m.unconvergedPoints;
        } catch { f = 1e9; missionPen = 10; }
        break;
      }
    }
    let pen = missionPen;
    const T3 = r.stations.find((s) => s.id === '3')!.Tt;
    for (const c of oi.constraints) {
      if (c.kind === 'T3max' && T3 > c.value) pen += Math.pow((T3 - c.value) / 50, 2);
      if (c.kind === 'T4max' && inp.burner.T4_K > c.value) pen += Math.pow((inp.burner.T4_K - c.value) / 50, 2);
      if (c.kind === 'FnMin' && r.perf.Fn < c.value) pen += Math.pow((c.value - r.perf.Fn) / Math.max(0.02 * Math.abs(c.value), 1), 2);
      if (c.kind === 'metalMax') { const h = r.components.find((x) => x.id === 'hpt' || x.id === 'turb'); if (h && h.values.metalTemp_K > c.value) pen += Math.pow((h.values.metalTemp_K - c.value) / 20, 2); }
    }
    const smC = oi.constraints.find((c) => c.kind === 'surgeMarginMin');
    if (smC && oi.checkOffDesign) {
      try {
        const dp = makeDesignPoint(inp);
        const s = solveOffDesign(dp, { altitude_m: oi.checkOffDesign.altitude_m, mach: oi.checkOffDesign.mach, dT_isa: 0, throttle: { mode: 'T4', value: oi.checkOffDesign.T4frac * inp.burner.T4_K } });
        const sm = Math.min(...s.result.components.filter((c) => c.kind === 'compressor').map((c) => c.values.surgeMargin_pct));
        if (!s.converged) pen += 10; else if (sm < smC.value) pen += Math.pow((smC.value - sm) / 2, 2);
      } catch { pen += 10; }
    }
    if (r.warnings.some((w) => w.includes('cannot'))) pen += 10;
    if (!Number.isFinite(f) || !Number.isFinite(pen)) return { f: 1e9, pen: 1e9, feasible: false };
    return { f, pen, feasible: pen < 1e-6 };
  };
  const scale = vars.map((v) => v.max - v.min);
  const x0 = vars.map((v) => Math.min(v.max, Math.max(v.min, getPath(base, v.path))));
  let selected: { x: number[]; f: number; pen: number; feasible: boolean } | undefined;
  const F = (x: number[]) => {
    if (evals >= oi.maxEvals) return Infinity;
    // Project the simplex itself, not just the design passed to the solver.
    vars.forEach((v, i) => { x[i] = Math.min(v.max, Math.max(v.min, x[i])); });
    const o = objective(apply(x)); const val = o.f + 1e3 * o.pen;
    if (!selected || (o.feasible && !selected.feasible) || (o.feasible === selected.feasible && val < selected.f + 1e3 * selected.pen)) selected = { x: x.slice(), ...o };
    trace.push({ eval: evals, objective: o.f, penalty: o.pen, x: x.slice(), feasible: o.feasible });
    if (progress && trace.length % 10 === 0) progress(trace);
    return val;
  };
  const base0 = objective({ ...base, chemistry: 'frozen' });
  const baseline = base0.f;
  // initial simplex
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += 0.15 * scale[i] * (x[i] + 0.15 * scale[i] <= vars[i].max ? 1 : -1); simplex.push(x); }
  let fx = simplex.map(F);
  const alpha = 1, gam = 2, rho = 0.5, sig = 0.5;
  let converged = false;
  while (evals < oi.maxEvals) {
    const idx = fx.map((_, i) => i).sort((a, b) => fx[a] - fx[b]);
    simplex = idx.map((i) => simplex[i]); fx = idx.map((i) => fx[i]);
    const spread = Math.max(...simplex.map((x) => Math.max(...x.map((v, i) => Math.abs(v - simplex[0][i]) / scale[i]))));
    if (spread < 2e-3 && Math.abs(fx[n] - fx[0]) < 1e-4 * Math.max(Math.abs(fx[0]), 1)) { converged = true; break; }
    const centroid = x0.map((_, i) => simplex.slice(0, n).reduce((s, x) => s + x[i], 0) / n);
    const xr = centroid.map((c, i) => c + alpha * (c - simplex[n][i]));
    const fr = F(xr);
    if (fr < fx[0]) {
      const xe = centroid.map((c, i) => c + gam * (xr[i] - c)); const fe = F(xe);
      if (fe < fr) { simplex[n] = xe; fx[n] = fe; } else { simplex[n] = xr; fx[n] = fr; }
    } else if (fr < fx[n - 1]) { simplex[n] = xr; fx[n] = fr; }
    else {
      const xc = centroid.map((c, i) => c + rho * (simplex[n][i] - c)); const fc = F(xc);
      if (fc < fx[n]) { simplex[n] = xc; fx[n] = fc; }
      else { for (let i = 1; i <= n; i++) { simplex[i] = simplex[i].map((v, k) => simplex[0][k] + sig * (v - simplex[0][k])); fx[i] = F(simplex[i]); } }
    }
  }
  const bestX = selected!.x;
  const best = apply(bestX);
  const bo = selected!;
  if (!bo.feasible) warnings.push('Best point still violates a constraint; penalties remain. Relax the bounds or constraints.');
  if (!converged) warnings.push(`Stopped at the evaluation budget (${oi.maxEvals}); the simplex had not fully collapsed.`);
  return { best, bestX, objective: bo.f, trace, evals, converged, feasible: bo.feasible, baseline, warnings };
}
