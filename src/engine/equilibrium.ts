/**
 * Chemical-equilibrium composition by minimisation of Gibbs free energy
 * (element-potential / Lagrange-multiplier formulation of Gordon & McBride,
 * NASA RP-1311, reduced iteration equations).  Species: N2 O2 Ar CO2 H2O CO
 * H2 OH NO O H.  Composition b is in kmol of each element per kg of mixture.
 */
import janaf from '../data/janaf.json';
import { R_UNIVERSAL, P_REF, Composition } from './gas';

type SpeciesData = { coeffs: number[][]; ranges: number[]; wt: number; elements: Record<string, number> };
const SP = janaf.species as Record<string, SpeciesData>;
export const EQ_SPECIES = ['N2', 'O2', 'Ar', 'CO2', 'H2O', 'CO', 'H2', 'OH', 'NO', 'O', 'H'] as const;
export type Species = (typeof EQ_SPECIES)[number];
const ELEMENTS = ['N', 'O', 'Ar', 'C', 'H'] as const;
type Element = (typeof ELEMENTS)[number];
/** a[i][j] = atoms of element j in species i */
const A: number[][] = EQ_SPECIES.map((s) => ELEMENTS.map((e) => SP[s].elements[e] ?? 0));

function pick(sp: SpeciesData, T: number): number[] {
  const r = sp.ranges;
  for (let i = 0; i < sp.coeffs.length; i++) if (T < r[i + 1]) return sp.coeffs[i];
  return sp.coeffs[sp.coeffs.length - 1];
}
export function hRT(a: number[], T: number) {
  return -a[0] / (T * T) + (a[1] * Math.log(T)) / T + a[2] + (a[3] * T) / 2 + (a[4] * T * T) / 3 + (a[5] * T ** 3) / 4 + (a[6] * T ** 4) / 5 + a[7] / T;
}
export function sR(a: number[], T: number) {
  return -a[0] / (2 * T * T) - a[1] / T + a[2] * Math.log(T) + a[3] * T + (a[4] * T * T) / 2 + (a[5] * T ** 3) / 3 + (a[6] * T ** 4) / 4 + a[8];
}
export function cpR(a: number[], T: number) {
  return a[0] / (T * T) + a[1] / T + a[2] + a[3] * T + a[4] * T * T + a[5] * T ** 3 + a[6] * T ** 4;
}

export interface EqState { n: number[]; nTotal: number; h: number; s: number; cpFrozen: number; T: number; P: number }

/** Solve a small dense linear system in place (Gaussian elimination with partial pivoting). */
function solve(M: number[][], r: number[]): number[] {
  const n = r.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    [M[c], M[p]] = [M[p], M[c]]; [r[c], r[p]] = [r[p], r[c]];
    const d = M[c][c] || 1e-300;
    for (let i = c + 1; i < n; i++) {
      const f = M[i][c] / d;
      if (f === 0) continue;
      for (let j = c; j < n; j++) M[i][j] -= f * M[c][j];
      r[i] -= f * r[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = r[i];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / (M[i][i] || 1e-300);
  }
  return x;
}

/**
 * Equilibrium composition at (T, P) for element amounts b.
 * @param n0 initial guess (kmol/kg per species) — e.g. the frozen complete-combustion composition.
 */
export function equilibrium(b: Composition, T: number, P: number, n0?: number[]): EqState {
  const bv = ELEMENTS.map((e) => b[e as Element]);
  // active elements (present) and species (made only of active elements)
  const actE: number[] = []; ELEMENTS.forEach((_, j) => { if (bv[j] > 1e-14) actE.push(j); });
  const actS: number[] = []; EQ_SPECIES.forEach((_, i) => { if (A[i].every((v, j) => v === 0 || bv[j] > 1e-14)) actS.push(i); });
  const lnP = Math.log(P / P_REF);
  const coef = EQ_SPECIES.map((s) => pick(SP[s], T));
  const c = EQ_SPECIES.map((_, i) => hRT(coef[i], T) - sR(coef[i], T) + lnP); // mu_i0/(RT) + ln(P/P0)

  // initial guess
  let n = n0 ? n0.slice() : new Array(EQ_SPECIES.length).fill(0);
  if (!n0) { // complete combustion
    const C = bv[3], H = bv[4], O = bv[1], N = bv[0], Ar = bv[2];
    n[3] = C; n[4] = H / 2; n[1] = Math.max((O - 2 * C - H / 2) / 2, 0); n[0] = N / 2; n[2] = Ar;
  }
  let nT = 0; for (const i of actS) { if (n[i] < 1e-30) n[i] = 1e-30; nT += n[i]; }
  // initial element potentials from least squares over significant species: sum_j a_ij pi_j = ln(n_i/nT) + c_i
  const ne = actE.length;
  let pi = new Array(ne).fill(0);
  {
    const M = Array.from({ length: ne }, () => new Array(ne).fill(0)); const r = new Array(ne).fill(0);
    for (const i of actS) {
      if (n[i] < 1e-12 * nT) continue;
      const rhs = Math.log(n[i] / nT) + c[i];
      actE.forEach((j, jj) => { actE.forEach((k, kk) => { M[jj][kk] += A[i][j] * A[i][k]; }); r[jj] += A[i][j] * rhs; });
    }
    for (let j = 0; j < ne; j++) M[j][j] += 1e-12;
    pi = solve(M, r);
  }
  let lnN = Math.log(nT);
  // Newton iterations on (pi_j, ln n)
  for (let it = 0; it < 60; it++) {
    for (const i of actS) {
      let e = -c[i] + lnN;
      actE.forEach((j, jj) => { e += A[i][j] * pi[jj]; });
      n[i] = Math.exp(Math.max(-700, Math.min(50, e)));
    }
    const nTot = Math.exp(lnN);
    const F = new Array(ne + 1).fill(0);
    let sumN = 0;
    for (const i of actS) { sumN += n[i]; actE.forEach((j, jj) => { F[jj] += A[i][j] * n[i]; }); }
    actE.forEach((j, jj) => { F[jj] -= bv[j]; });
    F[ne] = sumN - nTot;
    const J = Array.from({ length: ne + 1 }, () => new Array(ne + 1).fill(0));
    for (const i of actS) {
      actE.forEach((j, jj) => {
        actE.forEach((k, kk) => { J[jj][kk] += A[i][j] * A[i][k] * n[i]; });
        J[jj][ne] += A[i][j] * n[i];
        J[ne][jj] += A[i][j] * n[i];
      });
      J[ne][ne] += n[i];
    }
    J[ne][ne] -= nTot;
    const rhs = F.map((v) => -v);
    const d = solve(J, rhs);
    let lam = 1;
    const mx = Math.max(...d.map(Math.abs));
    if (mx > 2) lam = 2 / mx;
    for (let jj = 0; jj < ne; jj++) pi[jj] += lam * d[jj];
    lnN += lam * d[ne];
    const err = Math.max(...actE.map((j, jj) => Math.abs(F[jj]) / Math.max(bv[j], 1e-30)), Math.abs(F[ne]) / nTot);
    if (err < 1e-11 && lam === 1) break;
  }
  const nTotal = Math.exp(lnN);
  let h = 0, s = 0, cp = 0;
  for (const i of actS) {
    h += n[i] * hRT(coef[i], T);
    cp += n[i] * cpR(coef[i], T);
    if (n[i] > 0) s += n[i] * (sR(coef[i], T) - Math.log(n[i] / nTotal) - lnP);
  }
  return { n, nTotal, h: h * R_UNIVERSAL * T, s: s * R_UNIVERSAL, cpFrozen: cp * R_UNIVERSAL, T, P };
}
