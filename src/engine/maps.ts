/**
 * Component performance maps (NPSS-style, as distributed with pyCycle) with
 * design-point scaling.  Compressor maps: (alpha, Nc, Rline) -> Wc, PR, eff.
 * Turbine maps: (alpha, Np, PR) -> Wp, eff.  Scalars are computed at the design
 * point so that the scaled map passes through the design PR, eff, flow and speed.
 */
import mapsJson from '../data/maps.json';
import { validateCompressor, validateTurbine } from './mapValidation';

export interface CompressorMapData { defaults: Record<string, number>; RlineStall: number; alphaMap: number[]; NcMap: number[]; RlineMap: number[]; WcMap: number[][][]; PRmap: number[][][]; effMap: number[][][] }
export interface TurbineMapData { defaults: Record<string, number>; alphaMap: number[]; NpMap: number[]; PRmap: number[]; WpMap: number[][][]; effMap: number[][][] }
const DATA = mapsJson as unknown as { compressors: Record<string, CompressorMapData>; turbines: Record<string, TurbineMapData> };
export const COMPRESSOR_MAPS = Object.keys(DATA.compressors);
export const TURBINE_MAPS = Object.keys(DATA.turbines);
const CUSTOM: { compressors: Record<string, CompressorMapData>; turbines: Record<string, TurbineMapData> } = { compressors: Object.create(null), turbines: Object.create(null) };
export function registerCustomMap(id: string, kind: 'compressor' | 'turbine', data: CompressorMapData | TurbineMapData) {
  if (!id || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('Invalid custom map id.');
  if (kind === 'compressor') CUSTOM.compressors[id] = structuredClone(validateCompressor(data as CompressorMapData));
  else if (kind === 'turbine') CUSTOM.turbines[id] = structuredClone(validateTurbine(data as TurbineMapData));
  else throw new Error('Invalid custom map kind.');
}
export function listCustomMaps(): string[] { return [...Object.keys(CUSTOM.compressors), ...Object.keys(CUSTOM.turbines)]; }
/** Replace a saved-map snapshot atomically, including removals. */
export function replaceCustomMaps(maps: { id: string; kind: 'compressor' | 'turbine'; data: CompressorMapData | TurbineMapData }[]) {
  for (const m of maps) {
    if (!m.id || ['__proto__', 'constructor', 'prototype'].includes(m.id)) throw new Error('Invalid custom map id.');
    if (m.kind === 'compressor') validateCompressor(m.data as CompressorMapData);
    else if (m.kind === 'turbine') validateTurbine(m.data as TurbineMapData);
    else throw new Error('Invalid custom map kind.');
  }
  if (new Set(maps.map(m => m.id)).size !== maps.length) throw new Error('Custom map ids must be distinct.');
  for (const key of Object.keys(CUSTOM.compressors)) delete CUSTOM.compressors[key];
  for (const key of Object.keys(CUSTOM.turbines)) delete CUSTOM.turbines[key];
  for (const m of maps) registerCustomMap(m.id, m.kind, m.data);
}
export function customMapKind(id: string): 'compressor' | 'turbine' | null { return CUSTOM.compressors[id] ? 'compressor' : CUSTOM.turbines[id] ? 'turbine' : null; }

/** Bilinear interpolation on a 2-D table (first alpha slice), with linear extrapolation outside. */
function interp2(xs: number[], ys: number[], table: number[][], x: number, y: number): number {
  const ix = Math.max(0, Math.min(xs.length - 2, locate(xs, x)));
  const iy = Math.max(0, Math.min(ys.length - 2, locate(ys, y)));
  const tx = (x - xs[ix]) / (xs[ix + 1] - xs[ix]);
  const ty = (y - ys[iy]) / (ys[iy + 1] - ys[iy]);
  const a = table[ix][iy] + (table[ix][iy + 1] - table[ix][iy]) * ty;
  const b = table[ix + 1][iy] + (table[ix + 1][iy + 1] - table[ix + 1][iy]) * ty;
  return a + (b - a) * tx;
}
function locate(xs: number[], x: number): number {
  let i = 0;
  while (i < xs.length - 2 && x > xs[i + 1]) i++;
  return i;
}

/** flow gain available beyond the last tabulated R-line, as a fraction of the last R-line step (choke-side extension) */
export const CHOKE_FLOW_GAIN = 0.5;
export interface CompScalars { sNc: number; sPR: number; sEff: number; sWc: number }
export interface TurbScalars { sNp: number; sPR: number; sEff: number; sWp: number }

export class CompressorMap {
  readonly d: CompressorMapData;
  readonly name: string;
  constructor(name: string) { this.name = name; this.d = CUSTOM.compressors[name] ?? DATA.compressors[name]; if (!this.d) throw new Error('unknown compressor map ' + name); }
  raw(Nc: number, Rline: number): { Wc: number; PR: number; eff: number } {
    const NcMin = this.d.NcMap[0];
    if (Nc < NcMin) {
      // sub-idle extension: flow ~ speed, pressure rise ~ speed², efficiency falls toward zero speed.  The windmilling
      // loss (the blading acting as a resistance) scales with the dynamic head of the through-flow, i.e. with f², so a
      // starter-driven compressor at static conditions keeps a small positive pressure rise instead of a fixed −2 %.
      const f = Math.max(Nc, 0) / NcMin;
      const b = this.raw(NcMin, Rline);
      return { Wc: b.Wc * f, PR: 1 + f * f * ((b.PR - 1) - 0.02 * (1 - f)), eff: b.eff * (0.35 + 0.65 * f) };
    }
    const rhi = this.d.RlineMap[this.d.RlineMap.length - 1];
    if (Rline > rhi) {
      // choke-side extension: the last tabulated R-line is close to choke, so the flow saturates (a near-vertical choke
      // line, gaining at most CHOKE_FLOW_GAIN of the last R-line step) while the pressure ratio and efficiency keep
      // falling, steepening with distance.  This is the throttled branch of a choked compressor, flagged offMap by the
      // off-design solver.
      const e = this.raw(Nc, rhi), p = this.raw(Nc, rhi - 1);
      const s = Rline - rhi;
      return { Wc: e.Wc + (e.Wc - p.Wc) * CHOKE_FLOW_GAIN * (1 - Math.exp(-s / CHOKE_FLOW_GAIN)), PR: e.PR + (e.PR - p.PR) * s * (1 + 0.5 * s), eff: Math.max(0.2, e.eff + (e.eff - p.eff) * s) };
    }
    return { Wc: interp2(this.d.NcMap, this.d.RlineMap, this.d.WcMap[0], Nc, Rline), PR: interp2(this.d.NcMap, this.d.RlineMap, this.d.PRmap[0], Nc, Rline), eff: interp2(this.d.NcMap, this.d.RlineMap, this.d.effMap[0], Nc, Rline) };
  }
  /** Scalars so that the map's design point reproduces (Nc, PR, eff, Wc). */
  scalars(NcDes: number, PRDes: number, effDes: number, WcDes: number): CompScalars {
    const m = this.raw(this.d.defaults.NcMap, this.d.defaults.RlineMap);
    return { sNc: NcDes / this.d.defaults.NcMap, sPR: (PRDes - 1) / (m.PR - 1), sEff: effDes / m.eff, sWc: WcDes / m.Wc };
  }
  /** Scaled map read at actual corrected speed and R-line. */
  read(sc: CompScalars, Nc: number, Rline: number) {
    const m = this.raw(Nc / sc.sNc, Rline);
    return { Wc: m.Wc * sc.sWc, PR: 1 + sc.sPR * (m.PR - 1), eff: m.eff * sc.sEff, NcMap: Nc / sc.sNc };
  }
  get RlineRange(): [number, number] { return [this.d.RlineMap[0], this.d.RlineMap[this.d.RlineMap.length - 1]]; }
  get RlineDes(): number { return this.d.defaults.RlineMap; }
  get RlineStall(): number { return this.d.RlineStall; }
  /** Surge margin per SAE definition at constant corrected speed: (PR_stall/PR - 1) * 100 (Wc-based variant below). */
  surgeMargin(sc: CompScalars, Nc: number, Rline: number): number {
    const op = this.read(sc, Nc, Rline);
    const st = this.read(sc, Nc, this.d.RlineStall);
    return ((st.PR / op.PR) * (op.Wc / st.Wc) - 1) * 100;
  }
}

export class TurbineMap {
  readonly d: TurbineMapData;
  readonly name: string;
  constructor(name: string) { this.name = name; this.d = CUSTOM.turbines[name] ?? DATA.turbines[name]; if (!this.d) throw new Error('unknown turbine map ' + name); }
  raw(Np: number, PR: number): { Wp: number; eff: number } {
    const NpMin = this.d.NpMap[0], PRmin = this.d.PRmap[0];
    const n = Math.max(Np, 0.25 * NpMin), p = Math.max(PR, 1.02);
    const base = { Wp: interp2(this.d.NpMap, this.d.PRmap, this.d.WpMap[0], Math.max(n, NpMin), Math.max(p, PRmin)), eff: interp2(this.d.NpMap, this.d.PRmap, this.d.effMap[0], Math.max(n, NpMin), Math.max(p, PRmin)) };
    // below the tabulated PR range the turbine unchokes: flow ~ sqrt(1 - 1/PR^2) relative to the lowest tabulated PR
    const flowScale = p < PRmin ? Math.sqrt(Math.max(1 - 1 / (p * p), 0.01) / (1 - 1 / (PRmin * PRmin))) : 1;
    const effScale = n < NpMin ? 0.4 + 0.6 * (n / NpMin) : 1;
    return { Wp: base.Wp * flowScale, eff: base.eff * effScale };
  }
  scalars(NpDes: number, PRDes: number, effDes: number, WpDes: number): TurbScalars {
    const m = this.raw(this.d.defaults.NpMap, this.d.defaults.PRmap);
    return { sNp: NpDes / this.d.defaults.NpMap, sPR: (PRDes - 1) / (this.d.defaults.PRmap - 1), sEff: effDes / m.eff, sWp: WpDes / m.Wp };
  }
  read(sc: TurbScalars, Np: number, PR: number) {
    const PRmap = 1 + (PR - 1) / sc.sPR;
    const m = this.raw(Np / sc.sNp, PRmap);
    return { Wp: m.Wp * sc.sWp, eff: m.eff * sc.sEff, PRmap, NpMap: Np / sc.sNp };
  }
}

/** Corrected flow and speed (SI; reference 288.15 K / 101325 Pa). */
export const T_STD = 288.15, P_STD = 101325;
export const correctedFlow = (W: number, Tt: number, Pt: number) => (W * Math.sqrt(Tt / T_STD)) / (Pt / P_STD);
export const correctedSpeed = (N: number, Tt: number) => N / Math.sqrt(Tt / T_STD);
/** Turbine "parametric" flow and speed, as pyCycle: W sqrt(Tt)/Pt and N/sqrt(Tt). */
export const paramFlow = (W: number, Tt: number, Pt: number) => (W * Math.sqrt(Tt)) / Pt;
export const paramSpeed = (N: number, Tt: number) => N / Math.sqrt(Tt);
