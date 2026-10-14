/**
 * Gas model for air and Jet-A combustion products on the NASA CEA
 * 9-coefficient polynomials (janaf set, as shipped with pyCycle).
 * Composition is carried as element amounts (kmol per kg of mixture), exactly
 * like pyCycle's `b0` vector.  Two chemistry modes:
 *   - 'equilibrium' (default): CEA-style Gibbs minimisation over
 *     N2 O2 Ar CO2 H2O CO H2 OH NO O H whenever T >= 1000 K (below that
 *     dissociation is below 1e-8 and the frozen result is used);
 *   - 'frozen': complete lean combustion products only.
 *
 * All quantities SI: J/kg, J/(kg K), K, Pa.  Enthalpies are absolute
 * (including formation enthalpy) so combustion is an enthalpy-conserving mix.
 */
import janaf from '../data/janaf.json';
import { equilibrium, EQ_SPECIES, EqState, hRT, sR, cpR } from './equilibrium';

export const R_UNIVERSAL = 8314.4598; // J/(kmol K)
export const P_REF = 101325; // Pa, CEA standard-state pressure
export type Chemistry = 'equilibrium' | 'frozen';
export const EQ_T_MIN = 1000;

type SpeciesData = { coeffs: number[][]; ranges: number[]; wt: number; elements: Record<string, number> };
const SPECIES = janaf.species as Record<string, SpeciesData>;
const ELEMENT_WT = janaf.element_wts as Record<string, number>;

/** Element amounts in kmol per kg of mixture (pyCycle "b0" convention). */
export type Composition = { N: number; O: number; Ar: number; C: number; H: number };

/** Dry air, identical to pyCycle.constants.CEA_AIR_COMPOSITION. */
export const AIR: Composition = { N: 5.39157698e-2, O: 1.44860137e-2, Ar: 3.23319235e-4, C: 1.10132233e-5, H: 0 };
const JETA_MW = 12 * ELEMENT_WT.C + 23 * ELEMENT_WT.H;
/** Jet-A(g) as C12H23 (pyCycle janaf.reactants['Jet-A(g)']). */
export const JETA: Composition = { N: 0, O: 0, Ar: 0, C: 12 / JETA_MW, H: 23 / JETA_MW };
export const FAR_STOICH = (AIR.O - 2 * AIR.C) / (2 * JETA.C + 0.5 * JETA.H);

/** Fuels: elemental composition per kg, lower heating value and absolute enthalpy of the liquid/gas as supplied. */
export type FuelId = 'jetA' | 'saf' | 'hydrogen' | 'methane';
export interface Fuel { id: FuelId; name: string; comp: Composition; LHV_Jkg: number; h_Jkg: number; stoichFAR: number; density_kgm3: number; note: string }
const fuelOf = (id: FuelId, name: string, C: number, H: number, LHV: number, hForm_Jmol: number, density: number, note: string): Fuel => {
  const MW = C * ELEMENT_WT.C + H * ELEMENT_WT.H;
  const comp: Composition = { N: 0, O: 0, Ar: 0, C: C / MW, H: H / MW };
  const stoich = (AIR.O - 2 * AIR.C) / (2 * comp.C + 0.5 * comp.H);
  return { id, name, comp, LHV_Jkg: LHV, h_Jkg: (hForm_Jmol * 1000) / MW, stoichFAR: stoich, density_kgm3: density, note };
};
export const FUELS: Record<FuelId, Fuel> = {
  jetA: fuelOf('jetA', 'Jet-A (kerosene)', 12, 23, 43.0e6, 0, 800, 'C12H23 surrogate; fuel enthalpy 0 reproduces pyCycle.'),
  saf: fuelOf('saf', 'Synthetic paraffinic kerosene (SAF)', 12, 26, 44.1e6, 0, 760, 'C12H26 paraffin: higher H/C, ~2.5 % higher LHV, lower CO2 per MJ.'),
  hydrogen: fuelOf('hydrogen', 'Hydrogen', 0, 2, 120.0e6, 0, 71, 'Gaseous H2 at combustor inlet; LHV per kg 2.8× kerosene.'),
  methane: fuelOf('methane', 'Methane (LNG)', 1, 4, 50.0e6, -74870, 423, 'CH4; formation enthalpy -74.87 kJ/mol.'),
};
/** Humid air: adds water vapour at a water/air mass ratio (kg water per kg dry air). */
export function humidAir(war: number): Composition {
  if (war <= 0) return AIR;
  const MW_H2O = 2 * ELEMENT_WT.H + ELEMENT_WT.O;
  const water: Composition = { N: 0, O: 1 / MW_H2O, Ar: 0, C: 0, H: 2 / MW_H2O };
  return mixComposition(AIR, 1, water, war);
}
/** Water/air ratio from relative humidity at ambient T (K) and P (Pa) (Magnus saturation pressure). */
export function warFromRH(rh: number, T: number, P: number): number {
  const Tc = T - 273.15;
  const ps = 610.94 * Math.exp((17.625 * Tc) / (Tc + 243.04));
  const pw = Math.min(rh, 1) * ps;
  return (0.622 * pw) / Math.max(P - pw, 1);
}

export function mixComposition(a: Composition, wa: number, b: Composition, wb: number): Composition {
  const t = wa + wb;
  return { N: (a.N * wa + b.N * wb) / t, O: (a.O * wa + b.O * wb) / t, Ar: (a.Ar * wa + b.Ar * wb) / t, C: (a.C * wa + b.C * wb) / t, H: (a.H * wa + b.H * wb) / t };
}
export function vitiated(air: Composition, far: number): Composition { return mixComposition(air, 1, JETA, far); }

/** Frozen species moles (kmol / kg mixture) for complete lean combustion. */
export function speciesMoles(c: Composition): Record<string, number> {
  const CO2 = c.C, H2O = c.H / 2, O2 = (c.O - 2 * CO2 - H2O) / 2;
  if (O2 < -1e-9) throw new Error('Rich mixture: not enough oxygen for complete combustion (FAR > stoichiometric)');
  return { CO2, H2O, O2: Math.max(O2, 0), N2: c.N / 2, Ar: c.Ar };
}
function pick(sp: SpeciesData, T: number): number[] {
  const r = sp.ranges;
  for (let i = 0; i < sp.coeffs.length; i++) if (T < r[i + 1]) return sp.coeffs[i];
  return sp.coeffs[sp.coeffs.length - 1];
}

export class Gas {
  readonly comp: Composition;
  readonly n: Record<string, number>; // frozen composition
  readonly nTotal: number;
  readonly R: number; // frozen gas constant J/(kg K)
  readonly MW: number;
  readonly far: number;
  readonly chemistry: Chemistry;
  private eqCache = new Map<string, EqState>();
  private eqGuess: number[] | null = null;

  constructor(comp: Composition, far = 0, chemistry: Chemistry = 'equilibrium') {
    this.comp = comp; this.far = far; this.chemistry = chemistry;
    this.fuel = FUELS.jetA;
    this.n = speciesMoles(comp);
    this.nTotal = Object.values(this.n).reduce((s, v) => s + v, 0);
    this.R = R_UNIVERSAL * this.nTotal;
    this.MW = 1 / this.nTotal;
  }
  readonly fuel: Fuel;
  static air(chemistry: Chemistry = 'equilibrium', war = 0, fuel: FuelId = 'jetA'): Gas { const g = new Gas(humidAir(war), 0, chemistry); (g as any).fuel = FUELS[fuel]; return g; }
  withFuel(farAdd: number): Gas {
    const airMass = 1 / (1 + this.far);
    const g = new Gas(mixComposition(this.comp, 1, this.fuel.comp, farAdd * airMass), this.far + farAdd, this.chemistry);
    (g as any).fuel = this.fuel;
    return g;
  }
  mixWith(other: Gas, wThis: number, wOther: number): Gas {
    const comp = mixComposition(this.comp, wThis, other.comp, wOther);
    const fuelThis = (wThis * this.far) / (1 + this.far), fuelOther = (wOther * other.far) / (1 + other.far);
    const g = new Gas(comp, (fuelThis + fuelOther) / (wThis + wOther - fuelThis - fuelOther), this.chemistry);
    (g as any).fuel = this.fuel;
    return g;
  }

  private useEq(T: number) { return this.chemistry === 'equilibrium' && T >= EQ_T_MIN; }
  /** Equilibrium state at (T,P), memoised. */
  eq(T: number, P: number): EqState {
    const key = T.toFixed(5) + '|' + P.toFixed(2);
    const hit = this.eqCache.get(key);
    if (hit) return hit;
    const st = equilibrium(this.comp, T, P, this.eqGuess ?? undefined);
    this.eqGuess = st.n;
    if (this.eqCache.size > 256) this.eqCache.clear();
    this.eqCache.set(key, st);
    return st;
  }
  /** Equilibrium species mole fractions at (T,P) (for display). */
  moleFractions(T: number, P: number): Record<string, number> {
    if (this.useEq(T)) { const e = this.eq(T, P); const o: Record<string, number> = {}; EQ_SPECIES.forEach((s, i) => { if (e.n[i] > 1e-12) o[s] = e.n[i] / e.nTotal; }); return o; }
    const o: Record<string, number> = {}; for (const k in this.n) if (this.n[k] > 0) o[k] = this.n[k] / this.nTotal; return o;
  }

  // ---- frozen primitives
  private cpF(T: number): number { let s = 0; for (const k in this.n) s += this.n[k] * cpR(pick(SPECIES[k], T), T); return s * R_UNIVERSAL; }
  private hF(T: number): number { let s = 0; for (const k in this.n) s += this.n[k] * hRT(pick(SPECIES[k], T), T); return s * R_UNIVERSAL * T; }
  private s0F(T: number): number {
    let s = 0;
    for (const k in this.n) { const ni = this.n[k]; if (ni <= 0) continue; s += ni * (sR(pick(SPECIES[k], T), T) - Math.log(ni / this.nTotal)); }
    return s * R_UNIVERSAL;
  }

  /** Absolute specific enthalpy, J/kg. */
  h(T: number, P = P_REF): number { return this.useEq(T) ? this.eq(T, P).h : this.hF(T); }
  /** Entropy at (T, P), J/(kg K). */
  s(T: number, P: number): number { return this.useEq(T) ? this.eq(T, P).s : this.s0F(T) - this.R * Math.log(P / P_REF); }
  /** Frozen specific heat of the local composition, J/(kg K). */
  cp(T: number, P = P_REF): number { return this.useEq(T) ? this.eq(T, P).cpFrozen : this.cpF(T); }
  /** Equilibrium (effective) specific heat, dh/dT at constant P. */
  cpEq(T: number, P = P_REF): number { if (!this.useEq(T)) return this.cpF(T); const d = 0.5; return (this.h(T + d, P) - this.h(T - d, P)) / (2 * d); }
  /** Local gas constant (kmol total changes with dissociation). */
  Rlocal(T: number, P = P_REF): number { return this.useEq(T) ? R_UNIVERSAL * this.eq(T, P).nTotal : this.R; }
  gamma(T: number, P = P_REF): number { const cp = this.cp(T, P); const R = this.Rlocal(T, P); return cp / (cp - R); }
  /** Frozen speed of sound, m/s. */
  a(T: number, P = P_REF): number { return Math.sqrt(this.gamma(T, P) * this.Rlocal(T, P) * T); }

  /** Temperature from enthalpy at pressure P (damped Newton). */
  TfromH(h: number, P: number, Tguess = 800): number {
    let T = Math.min(Math.max(Tguess, 150), 5000);
    let f = this.h(T, P) - h;
    for (let i = 0; i < 80; i++) {
      const cp = this.useEq(T) ? this.cpEq(T, P) : this.cpF(T);
      let dT = -f / cp;
      dT = Math.max(-400, Math.min(400, dT));
      let Tn = Math.max(150, T + dT), fn = this.h(Tn, P) - h, k = 0;
      while (Math.abs(fn) > Math.abs(f) && k < 8) { dT *= 0.5; Tn = Math.max(150, T + dT); fn = this.h(Tn, P) - h; k++; }
      T = Tn; f = fn;
      if (Math.abs(dT) < 1e-8 * T) break;
    }
    return T;
  }
  /** Temperature from entropy at pressure P. */
  TfromS(s: number, P: number, Tguess = 800): number {
    let T = Math.min(Math.max(Tguess, 150), 5000);
    let f = this.s(T, P) - s;
    for (let i = 0; i < 80; i++) {
      const cp = this.useEq(T) ? this.cpEq(T, P) : this.cpF(T);
      let dT = -f / (cp / T);
      dT = Math.max(-400, Math.min(400, dT));
      let Tn = Math.max(150, T + dT), fn = this.s(Tn, P) - s, k = 0;
      while (Math.abs(fn) > Math.abs(f) && k < 8) { dT *= 0.5; Tn = Math.max(150, T + dT); fn = this.s(Tn, P) - s; k++; }
      T = Tn; f = fn;
      if (Math.abs(dT) < 1e-8 * T) break;
    }
    return T;
  }
  /** Isentropic end temperature from (T1,P1) to P2. */
  isentropicT(T1: number, P1: number, P2: number): number {
    const s = this.s(T1, P1);
    const g = this.gamma(T1, P1);
    return this.TfromS(s, P2, T1 * Math.pow(P2 / P1, (g - 1) / g));
  }
  /** Pressure at which entropy equals s at temperature T (for total-from-static). */
  PfromS(s: number, T: number, Pguess: number): number {
    let P = Pguess;
    for (let i = 0; i < 40; i++) {
      const f = this.s(T, P) - s;
      const R = this.Rlocal(T, P);
      const dlnP = f / R; // ds/dlnP = -R
      P *= Math.exp(Math.max(-2, Math.min(2, dlnP)));
      if (Math.abs(dlnP) < 1e-10) break;
    }
    return P;
  }
}
