/**
 * Component performance maps (NPSS-style, as distributed with pyCycle) with
 * design-point scaling.  Compressor maps: (alpha, Nc, Rline) -> Wc, PR, eff.
 * Turbine maps: (alpha, Np, PR) -> Wp, eff.  Scalars are computed at the design
 * point so that the scaled map passes through the design PR, eff, flow and speed.
 */
import mapsJson from '../data/maps.json';

export interface CompressorMapData { defaults: Record<string, number>; RlineStall: number; alphaMap: number[]; NcMap: number[]; RlineMap: number[]; WcMap: number[][][]; PRmap: number[][][]; effMap: number[][][] }
export interface TurbineMapData { defaults: Record<string, number>; alphaMap: number[]; NpMap: number[]; PRmap: number[]; WpMap: number[][][]; effMap: number[][][] }
const DATA = mapsJson as unknown as { compressors: Record<string, CompressorMapData>; turbines: Record<string, TurbineMapData> };
export const COMPRESSOR_MAPS = Object.keys(DATA.compressors);
export const TURBINE_MAPS = Object.keys(DATA.turbines);

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

export interface CompScalars { sNc: number; sPR: number; sEff: number; sWc: number }
export interface TurbScalars { sNp: number; sPR: number; sEff: number; sWp: number }

export class CompressorMap {
  readonly d: CompressorMapData;
  readonly name: string;
  constructor(name: string) { this.name = name; this.d = DATA.compressors[name]; if (!this.d) throw new Error('unknown compressor map ' + name); }
  raw(Nc: number, Rline: number) {
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
  constructor(name: string) { this.name = name; this.d = DATA.turbines[name]; if (!this.d) throw new Error('unknown turbine map ' + name); }
  raw(Np: number, PR: number) {
    return { Wp: interp2(this.d.NpMap, this.d.PRmap, this.d.WpMap[0], Np, PR), eff: interp2(this.d.NpMap, this.d.PRmap, this.d.effMap[0], Np, PR) };
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
