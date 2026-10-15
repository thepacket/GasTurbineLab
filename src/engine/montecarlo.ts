/** Monte Carlo propagation of component uncertainties to performance. */
import { EngineInputs } from './types';
import { solveEngine } from './cycle';

export interface UncertainInput { path: string; label: string; sigma: number; min?: number; max?: number }
export interface MonteCarloInputs { inputs: UncertainInput[]; samples: number; seed: number }
export interface MonteCarloResult { Fn: number[]; TSFC: number[]; T3: number[]; Wf: number[]; eth: number[]; stats: Record<string, { mean: number; sd: number; p5: number; p50: number; p95: number }>; failures: number; truncated: number; sensitivity: { label: string; dFn_pct: number; dTSFC_pct: number }[] }

/** Physical bounds: efficiencies, recoveries and coefficients cannot exceed 1; losses and flows cannot be negative. */
export const UNCERTAIN: UncertainInput[] = [
  { path: 'fan.eff', label: 'Fan efficiency', sigma: 0.01, min: 0.5, max: 1 },
  { path: 'lpc.eff', label: 'Booster efficiency', sigma: 0.01, min: 0.5, max: 1 },
  { path: 'hpc.eff', label: 'HPC efficiency', sigma: 0.01, min: 0.5, max: 1 },
  { path: 'comp.eff', label: 'Compressor efficiency', sigma: 0.01, min: 0.5, max: 1 },
  { path: 'hpt.eff', label: 'HP turbine efficiency', sigma: 0.01, min: 0.5, max: 1 },
  { path: 'lpt.eff', label: 'LP turbine efficiency', sigma: 0.01, min: 0.5, max: 1 },
  { path: 'burner.dPqP', label: 'Combustor pressure loss', sigma: 0.005, min: 0, max: 0.3 },
  { path: 'inlet.ramRecovery', label: 'Inlet ram recovery', sigma: 0.005, min: 0.5, max: 1 },
  { path: 'coreNozzle.Cv', label: 'Core nozzle Cv', sigma: 0.004, min: 0.5, max: 1 },
  { path: 'bypNozzle.Cv', label: 'Bypass nozzle Cv', sigma: 0.004, min: 0.5, max: 1 },
  { path: 'coolInletFrac', label: 'Cooling flow', sigma: 0.01, min: 0, max: 0.3 },
];
function setPath(obj: any, path: string, value: unknown): any { const [h, ...rest] = path.split('.'); const c = { ...obj }; c[h] = rest.length ? setPath(obj[h] ?? {}, rest.join('.'), value) : value; return c; }
function getPath(obj: any, path: string): any { return path.split('.').reduce((o, k) => o?.[k], obj); }
/** Mulberry32 PRNG + Box–Muller. */
function rng(seed: number) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r: () => number) { const u = Math.max(r(), 1e-12), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const stats = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); const mean = s.reduce((p, q) => p + q, 0) / s.length; const sd = Math.sqrt(s.reduce((p, q) => p + (q - mean) ** 2, 0) / Math.max(s.length - 1, 1)); const q = (f: number) => s[Math.min(s.length - 1, Math.floor(f * s.length))]; return { mean, sd, p5: q(0.05), p50: q(0.5), p95: q(0.95) }; };

export function runMonteCarlo(base: EngineInputs, mc: MonteCarloInputs, progress?: (done: number) => void): MonteCarloResult {
  const r = rng(mc.seed);
  const Fn: number[] = [], TSFC: number[] = [], T3: number[] = [], Wf: number[] = [], eth: number[] = [];
  let failures = 0, truncated = 0;
  const b = { ...base, chemistry: 'frozen' as const };
  // truncated normal: redraw until inside the physical bounds (counted), so no unphysical sample enters the statistics
  const draw = (v: number, u: UncertainInput): number => {
    const lo = u.min ?? -Infinity, hi = u.max ?? Infinity;
    for (let k = 0; k < 50; k++) { const x = v + u.sigma * gauss(r); if (x >= lo && x <= hi) return x; truncated++; }
    return Math.min(hi, Math.max(lo, v));
  };
  for (let k = 0; k < mc.samples; k++) {
    let inp = b;
    for (const u of mc.inputs) { const v = getPath(b, u.path); if (typeof v !== 'number') continue; inp = setPath(inp, u.path, draw(v, u)); }
    try {
      const res = solveEngine(inp);
      const vals = [res.perf.Fn, res.perf.TSFC_mg_Ns, res.stations.find((s) => s.id === '3')!.Tt, res.perf.Wfuel, res.perf.thermalEff * 100];
      if (!vals.every(Number.isFinite) || res.warnings.some((w) => w.includes('cannot'))) { failures++; continue; }
      Fn.push(vals[0]); TSFC.push(vals[1]); T3.push(vals[2]); Wf.push(vals[3]); eth.push(vals[4]);
    } catch { failures++; }
    if (progress && k % 25 === 0) progress(k);
  }
  // one-at-a-time sensitivities (+1 sigma)
  const ref = solveEngine(b);
  const sensitivity = mc.inputs.map((u) => {
    const v = getPath(b, u.path); if (typeof v !== 'number') return { label: u.label, dFn_pct: 0, dTSFC_pct: 0 };
    try { const res = solveEngine(setPath(b, u.path, v + u.sigma)); return { label: u.label, dFn_pct: (res.perf.Fn / ref.perf.Fn - 1) * 100, dTSFC_pct: (res.perf.TSFC_mg_Ns / ref.perf.TSFC_mg_Ns - 1) * 100 }; } catch { return { label: u.label, dFn_pct: NaN, dTSFC_pct: NaN }; }
  });
  return { Fn, TSFC, T3, Wf, eth, stats: { Fn: stats(Fn), TSFC: stats(TSFC), T3: stats(T3), Wf: stats(Wf), eth: stats(eth) }, failures, truncated, sensitivity };
}
