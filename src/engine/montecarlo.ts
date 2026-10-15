/** Monte Carlo propagation of component uncertainties to performance. */
import { EngineInputs } from './types';
import { solveEngine } from './cycle';

export interface UncertainInput { path: string; label: string; sigma: number; min?: number; max?: number }
export interface MonteCarloInputs { inputs: UncertainInput[]; samples: number; seed: number }
export interface MonteCarloResult { Fn: number[]; TSFC: number[]; T3: number[]; Wf: number[]; eth: number[]; stats: Record<string, { mean: number; sd: number; p5: number; p50: number; p95: number }>; failures: number; truncated: number; sensitivity: { label: string; dFn_pct: number; dTSFC_pct: number; delta: number; bounded: boolean }[] }

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
  if (!Number.isInteger(mc.samples) || mc.samples < 1 || mc.samples > 100000 || !Number.isFinite(mc.seed)) throw new Error('Monte Carlo needs 1–100000 samples and a finite seed.');
  const inputs = mc.inputs.map(u => {
    const physical = UNCERTAIN.find(v => v.path === u.path);
    if (!physical || !Number.isFinite(u.sigma) || u.sigma < 0) throw new Error(`Invalid uncertain input or standard deviation: ${u.path}.`);
    const min = Math.max(physical.min ?? -Infinity, u.min ?? -Infinity), max = Math.min(physical.max ?? Infinity, u.max ?? Infinity);
    const v = getPath(base, u.path);
    if (Number.isNaN(min) || Number.isNaN(max) || min >= max || !Number.isFinite(v) || v < min || v > max) throw new Error(`Invalid bounds or baseline for ${u.path}.`);
    return { ...u, min, max };
  });
  if (new Set(inputs.map(u => u.path)).size !== inputs.length) throw new Error('Uncertain inputs must be distinct.');
  const r = rng(mc.seed);
  const Fn: number[] = [], TSFC: number[] = [], T3: number[] = [], Wf: number[] = [], eth: number[] = [];
  let failures = 0, truncated = 0;
  const b = { ...base, chemistry: 'frozen' as const };
  // truncated normal: redraw until inside the physical bounds (counted), so no unphysical sample enters the statistics
  const draw = (v: number, u: UncertainInput): number => {
    const lo = u.min ?? -Infinity, hi = u.max ?? Infinity;
    for (let k = 0; k < 50; k++) { const x = v + u.sigma * gauss(r); if (x >= lo && x <= hi) return x; truncated++; }
    throw new Error('No draw inside the requested bounds.');
  };
  for (let k = 0; k < mc.samples; k++) {
    let inp = b;
    try {
      for (const u of inputs) inp = setPath(inp, u.path, draw(getPath(b, u.path), u));
      const res = solveEngine(inp);
      const vals = [res.perf.Fn, res.perf.TSFC_mg_Ns, res.stations.find((s) => s.id === '3')!.Tt, res.perf.Wfuel, res.perf.thermalEff * 100];
      if (!vals.every(Number.isFinite) || res.warnings.some((w) => w.includes('cannot'))) throw new Error('Invalid sample.');
      Fn.push(vals[0]); TSFC.push(vals[1]); T3.push(vals[2]); Wf.push(vals[3]); eth.push(vals[4]);
    } catch { failures++; }
    if (progress && k % 25 === 0) progress(k);
  }
  if (!Fn.length) throw new Error('No valid Monte Carlo samples; check the design, uncertainties and bounds.');
  // one-at-a-time sensitivities (+1 sigma)
  const ref = solveEngine(b);
  // one-at-a-time: +1σ, clipped to the input's physical bound; the perturbation actually applied is reported
  const sensitivity = inputs.map((u) => {
    const v = getPath(b, u.path); if (typeof v !== 'number') return { label: u.label, dFn_pct: 0, dTSFC_pct: 0, delta: 0, bounded: false };
    const target = Math.min(u.max ?? Infinity, Math.max(u.min ?? -Infinity, v + u.sigma));
    const delta = target - v, bounded = Math.abs(delta - u.sigma) > 1e-12;
    if (Math.abs(delta) < 1e-12) return { label: u.label, dFn_pct: 0, dTSFC_pct: 0, delta: 0, bounded: true };
    try { const res = solveEngine(setPath(b, u.path, target)); return { label: u.label, dFn_pct: (res.perf.Fn / ref.perf.Fn - 1) * 100, dTSFC_pct: (res.perf.TSFC_mg_Ns / ref.perf.TSFC_mg_Ns - 1) * 100, delta, bounded }; } catch { return { label: u.label, dFn_pct: NaN, dTSFC_pct: NaN, delta, bounded }; }
  });
  return { Fn, TSFC, T3, Wf, eth, stats: { Fn: stats(Fn), TSFC: stats(TSFC), T3: stats(T3), Wf: stats(Wf), eth: stats(eth) }, failures, truncated, sensitivity };
}
