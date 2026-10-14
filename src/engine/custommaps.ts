/**
 * User-supplied component maps.  Format: the same JSON structure as the
 * built-in maps (src/data/maps.json entries), i.e.
 *   compressor: { defaults:{NcMap,RlineMap}, RlineStall, alphaMap, NcMap[], RlineMap[], WcMap[a][n][r], PRmap[..], effMap[..] }
 *   turbine:    { defaults:{NpMap,PRmap}, alphaMap, NpMap[], PRmap[], WpMap[a][n][p], effMap[..] }
 * or a simple CSV table (compressor: Nc,Rline,Wc,PR,eff per row; turbine: Np,PR,Wp,eff per row)
 * on a regular grid.  Maps are kept in localStorage and referenced by id.
 */
import { CompressorMapData, TurbineMapData, registerCustomMap, listCustomMaps } from './maps';

export type CustomMap = { id: string; name: string; kind: 'compressor' | 'turbine'; data: CompressorMapData | TurbineMapData };
const KEY = 'gtl.custommaps.v1';

export function loadCustomMaps(): CustomMap[] {
  try { const raw = localStorage.getItem(KEY); const list: CustomMap[] = raw ? JSON.parse(raw) : []; for (const m of list) registerCustomMap(m.id, m.kind, m.data as any); return list; } catch { return []; }
}
export function saveCustomMaps(list: CustomMap[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* quota */ }
  for (const m of list) registerCustomMap(m.id, m.kind, m.data as any);
}
export function customMapIds(): string[] { return listCustomMaps(); }

function uniq(a: number[]): number[] { return [...new Set(a)].sort((x, y) => x - y); }

/** Parse a CSV table into map data. Compressor columns: Nc,Rline,Wc,PR,eff. Turbine: Np,PR,Wp,eff. Header row optional. */
export function parseCsvMap(text: string, kind: 'compressor' | 'turbine'): CompressorMapData | TurbineMapData {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/[,;\t]/).map((v) => v.trim()));
  const num = rows.filter((r) => r.every((v) => v !== '' && !Number.isNaN(Number(v)))).map((r) => r.map(Number));
  if (kind === 'compressor') {
    if (num.some((r) => r.length < 5)) throw new Error('compressor CSV needs 5 columns: Nc, Rline, Wc, PR, eff');
    const Nc = uniq(num.map((r) => r[0])), Rl = uniq(num.map((r) => r[1]));
    const grid = (col: number) => Nc.map((n) => Rl.map((r) => { const row = num.find((x) => x[0] === n && x[1] === r); if (!row) throw new Error(`missing point Nc=${n} Rline=${r}`); return row[col]; }));
    const d: CompressorMapData = { defaults: { alphaMap: 0, NcMap: 1, RlineMap: Rl[Math.floor(Rl.length / 2)], PR: 1 }, RlineStall: Rl[0], alphaMap: [0, 90], NcMap: Nc, RlineMap: Rl, WcMap: [grid(2)], PRmap: [grid(3)], effMap: [grid(4)] };
    return validateCompressor(d);
  }
  if (num.some((r) => r.length < 4)) throw new Error('turbine CSV needs 4 columns: Np, PR, Wp, eff');
  const Np = uniq(num.map((r) => r[0])), PR = uniq(num.map((r) => r[1]));
  const grid = (col: number) => Np.map((n) => PR.map((p) => { const row = num.find((x) => x[0] === n && x[1] === p); if (!row) throw new Error(`missing point Np=${n} PR=${p}`); return row[col]; }));
  const d: TurbineMapData = { defaults: { alphaMap: 1, NpMap: Np[Math.floor(Np.length / 2)], PRmap: PR[Math.floor(PR.length / 2)] }, alphaMap: [1, 2], NpMap: Np, PRmap: PR, WpMap: [grid(2)], effMap: [grid(3)] };
  return validateTurbine(d);
}

export function parseJsonMap(text: string): { kind: 'compressor' | 'turbine'; data: CompressorMapData | TurbineMapData } {
  const j = JSON.parse(text);
  if (j.WcMap && j.PRmap && j.NcMap && j.RlineMap) return { kind: 'compressor', data: validateCompressor(j) };
  if (j.WpMap && j.NpMap && j.PRmap) return { kind: 'turbine', data: validateTurbine(j) };
  throw new Error('JSON is neither a compressor map (NcMap/RlineMap/WcMap/PRmap/effMap) nor a turbine map (NpMap/PRmap/WpMap/effMap)');
}

function validateCompressor(d: CompressorMapData): CompressorMapData {
  const n = d.NcMap.length, r = d.RlineMap.length;
  for (const k of ['WcMap', 'PRmap', 'effMap'] as const) {
    const t = d[k];
    if (!Array.isArray(t) || t.length < 1 || t[0].length !== n || t[0].some((row: number[]) => row.length !== r)) throw new Error(`${k} must be [alpha][${n}][${r}]`);
  }
  if (n < 2 || r < 2) throw new Error('need at least 2 speed lines and 2 R-lines');
  d.defaults = { alphaMap: 0, NcMap: d.defaults?.NcMap ?? 1, RlineMap: d.defaults?.RlineMap ?? d.RlineMap[Math.floor(r / 2)], PR: d.defaults?.PR ?? 1 };
  d.RlineStall = d.RlineStall ?? d.RlineMap[0];
  d.alphaMap = d.alphaMap ?? [0, 90];
  return d;
}
function validateTurbine(d: TurbineMapData): TurbineMapData {
  const n = d.NpMap.length, p = d.PRmap.length;
  for (const k of ['WpMap', 'effMap'] as const) {
    const t = d[k];
    if (!Array.isArray(t) || t.length < 1 || t[0].length !== n || t[0].some((row: number[]) => row.length !== p)) throw new Error(`${k} must be [alpha][${n}][${p}]`);
  }
  d.defaults = { alphaMap: 1, NpMap: d.defaults?.NpMap ?? d.NpMap[Math.floor(n / 2)], PRmap: d.defaults?.PRmap ?? d.PRmap[Math.floor(p / 2)] };
  d.alphaMap = d.alphaMap ?? [1, 2];
  return d;
}

/**
 * Parametric compressor map generator (for users without map data): speed lines
 * from a classic elliptical model.  PR falls from the stall line to choke along
 * the R-line; efficiency peaks mid-map and falls off-speed.
 */
export function generateCompressorMap(opts: { PRdes: number; WcDes: number; speedLines?: number[]; chokeMargin?: number; surgeMargin?: number }): CompressorMapData {
  const Nc = opts.speedLines ?? [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0, 1.05, 1.1];
  const Rl = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0];
  const sm = opts.surgeMargin ?? 0.2, cm = opts.chokeMargin ?? 0.08;
  const Wc: number[][] = [], PR: number[][] = [], eff: number[][] = [];
  for (const n of Nc) {
    const wc: number[] = [], pr: number[] = [], ef: number[] = [];
    const Wline = opts.WcDes * Math.pow(n, 1.0) * (0.35 + 0.65 * n); // flow range scales with speed
    const PRstall = 1 + (opts.PRdes - 1) * Math.pow(n, 2.1) * (1 + sm);
    for (const r of Rl) {
      const t = (r - 1) / 2; // 0 at stall, 1 at choke
      wc.push(Wline * (0.78 + (0.3 + cm) * Math.sqrt(t) * (1 - 0.15 * t)));
      pr.push(1 + (PRstall - 1) * Math.sqrt(Math.max(1 - Math.pow(t, 2.2), 0.02)));
      const peak = 0.92 - 0.25 * Math.pow(1 - n, 1.5);
      ef.push(peak * (1 - 0.6 * Math.pow(t - 0.55, 2)));
    }
    Wc.push(wc); PR.push(pr); eff.push(ef);
  }
  return { defaults: { alphaMap: 0, NcMap: 1, RlineMap: 2.0, PR: opts.PRdes }, RlineStall: 1.0, alphaMap: [0, 90], NcMap: Nc, RlineMap: Rl, WcMap: [Wc], PRmap: [PR], effMap: [eff] };
}

/**
 * Stage-stacking compressor map generator.  Each stage has a linear work
 * characteristic ψ = ψ* (1 + a (1 − φ/φ*)) and a parabolic loss bucket around
 * its design incidence; stages are stacked on a mean line with blade speed
 * proportional to corrected speed.  Variable stators rotate the design flow
 * coefficient of the front stages with speed, which is how a real VSV schedule
 * keeps the front stages off stall at low speed.  The resulting map is laid out
 * on R-lines between the stall (first stage with ψ beyond its peak) and choke.
 */
export function generateStageStackedMap(opts: { stages: number; PRdes: number; WcDes: number; vsvStages?: number; vsvGain?: number; stageLoading?: number; speedLines?: number[] }): CompressorMapData {
  const nSt = Math.max(1, Math.round(opts.stages));
  const Nc = opts.speedLines ?? [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0, 1.05, 1.1];
  const Rl = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0];
  const gamma = 1.4, cp = 1004.5;
  const T1 = 288.15;
  // design: equal stage temperature ratios → stage work from the overall PR at polytropic efficiency 0.9
  const effP = 0.9;
  const Tr = Math.pow(opts.PRdes, (gamma - 1) / (gamma * effP));
  const dTstage = (T1 * (Tr - 1)) / nSt;
  const psiStar = opts.stageLoading ?? 0.4; // ψ = cp ΔT / U²
  const U = Math.sqrt((cp * dTstage) / psiStar);
  const phiStar = 0.55;
  const a = 0.8; // slope of ψ(φ): rising work as flow falls, until stall at φ/φ* ≈ 0.72
  const vsvN = Math.min(nSt, Math.round(opts.vsvStages ?? Math.ceil(nSt / 2)));
  const vsvGain = opts.vsvGain ?? 0.35;
  const phiGrid = (nc: number) => {
    // candidate inlet flow coefficients for this speed from stall to choke
    const out: number[] = [];
    for (let k = 0; k < Rl.length; k++) out.push(phiStar * (0.70 + (0.42 * k) / (Rl.length - 1)) * (1 - 0.1 * (1 - nc))); // R-line 1 = stall (low flow), 3 = choke
    return out;
  };
  const Wc: number[][] = [], PR: number[][] = [], eff: number[][] = [];
  for (const nc of Nc) {
    const wc: number[] = [], pr: number[] = [], ef: number[] = [];
    for (const phi1 of phiGrid(nc)) {
      let T = T1, P = 1, phi = phi1, stalled = false, dTsum = 0, dTisSum = 0;
      for (let st = 0; st < nSt; st++) {
        // VSV: front stages see a flow coefficient shifted toward design at low speed
        const shift = st < vsvN ? 1 - vsvGain * (1 - nc) : 1;
        const phiRel = phi / (phiStar * shift);
        if (phiRel < 0.72) stalled = true;
        const psi = psiStar * (1 + a * (1 - phiRel));
        const Ust = U * nc;
        const dT = Math.max(psi * Ust * Ust / cp, 1);
        const loss = 0.12 * Math.pow(phiRel - 1, 2) + 0.03 * Math.pow(1 - nc, 2);
        const effSt = Math.max(0.5, 0.91 - loss);
        const dTis = dT * effSt;
        dTsum += dT; dTisSum += dTis;
        P *= Math.pow(1 + dTis / T, gamma / (gamma - 1));
        T += dT;
        // continuity through the stage: density rises, axial velocity (and φ) falls
        phi *= Math.pow(1 + dT / (T - dT), -1) * (1 + 0.5 * dT / (T - dT));
      }
      const prTot = Math.max(P, 1.02);
      const flow = phi1 / phiStar * nc; // corrected flow ∝ φ·N on the mean line
      wc.push(opts.WcDes * flow * (1 - (stalled ? 0 : 0)));
      pr.push(stalled ? prTot * 0.98 : prTot);
      ef.push(Math.min(0.93, Math.max(0.5, dTisSum / dTsum)));
    }
    Wc.push(wc); PR.push(pr); eff.push(ef);
  }
  return { defaults: { alphaMap: 0, NcMap: 1, RlineMap: 2.0, PR: opts.PRdes }, RlineStall: 1.0, alphaMap: [0, 90], NcMap: Nc, RlineMap: Rl, WcMap: [Wc], PRmap: [PR], effMap: [eff] };
}
