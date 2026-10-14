/**
 * Thermally-perfect, chemically-frozen gas model for air and Jet-A combustion
 * products, built on the same NASA CEA 9-coefficient polynomials (janaf set)
 * that pyCycle uses.  Composition is carried as element amounts (kmol per kg
 * of mixture), exactly like pyCycle's `b0` vector, and products are assumed to
 * be fully oxidised (CO2, H2O, N2, O2, Ar) on the lean side of stoichiometric.
 *
 * All quantities are SI: J/kg, J/(kg K), K, Pa, kg/s, m/s.
 * Enthalpies are *absolute* (they include formation enthalpy), so combustion
 * is simply an enthalpy-conserving mixing step.
 */
import janaf from '../data/janaf.json';

export const R_UNIVERSAL = 8314.4598; // J/(kmol K)
export const P_REF = 101325; // Pa, CEA standard-state pressure

type SpeciesData = { coeffs: number[][]; ranges: number[]; wt: number; elements: Record<string, number> };
const SPECIES = janaf.species as Record<string, SpeciesData>;
const ELEMENT_WT = janaf.element_wts as Record<string, number>;

/** Element amounts in kmol per kg of mixture (pyCycle "b0" convention). */
export type Composition = { N: number; O: number; Ar: number; C: number; H: number };

/** Dry air, identical to pyCycle.constants.CEA_AIR_COMPOSITION. */
export const AIR: Composition = { N: 5.39157698e-2, O: 1.44860137e-2, Ar: 3.23319235e-4, C: 1.10132233e-5, H: 0 };

/** Jet-A(g) as C12H23 (pyCycle janaf.reactants['Jet-A(g)']). */
const JETA_MW = 12 * ELEMENT_WT.C + 23 * ELEMENT_WT.H;
export const JETA: Composition = { N: 0, O: 0, Ar: 0, C: 12 / JETA_MW, H: 23 / JETA_MW };

/** Stoichiometric fuel/air ratio for Jet-A in dry air (complete combustion). */
export const FAR_STOICH = (() => {
  // O needed per kg fuel: 2 per C + 0.5 per H  (kmol O)
  const oNeed = 2 * JETA.C + 0.5 * JETA.H;
  const oAvail = AIR.O - 2 * AIR.C; // O already bound in CO2 is unavailable
  return oAvail / oNeed;
})();

export function mixComposition(a: Composition, wa: number, b: Composition, wb: number): Composition {
  const t = wa + wb;
  return {
    N: (a.N * wa + b.N * wb) / t,
    O: (a.O * wa + b.O * wb) / t,
    Ar: (a.Ar * wa + b.Ar * wb) / t,
    C: (a.C * wa + b.C * wb) / t,
    H: (a.H * wa + b.H * wb) / t,
  };
}

/** Air + fuel at fuel/air ratio FAR (mass based). */
export function vitiated(air: Composition, far: number): Composition {
  return mixComposition(air, 1, JETA, far);
}

/** Species mole numbers (kmol / kg mixture) assuming complete lean combustion. */
export function speciesMoles(c: Composition): Record<string, number> {
  const CO2 = c.C;
  const H2O = c.H / 2;
  const O2 = (c.O - 2 * CO2 - H2O) / 2;
  if (O2 < -1e-9) throw new Error('Rich mixture: not enough oxygen for complete combustion (FAR > stoichiometric)');
  return { CO2, H2O, O2: Math.max(O2, 0), N2: c.N / 2, Ar: c.Ar };
}

function pick(sp: SpeciesData, T: number): number[] {
  const r = sp.ranges;
  for (let i = 0; i < sp.coeffs.length; i++) if (T < r[i + 1]) return sp.coeffs[i];
  return sp.coeffs[sp.coeffs.length - 1];
}

/** Molar Cp/R, H/(RT), S/R for one species (dimensionless). */
function cpR(a: number[], T: number) {
  return a[0] / (T * T) + a[1] / T + a[2] + a[3] * T + a[4] * T * T + a[5] * T ** 3 + a[6] * T ** 4;
}
function hRT(a: number[], T: number) {
  return -a[0] / (T * T) + (a[1] * Math.log(T)) / T + a[2] + (a[3] * T) / 2 + (a[4] * T * T) / 3 + (a[5] * T ** 3) / 4 + (a[6] * T ** 4) / 5 + a[7] / T;
}
function sR(a: number[], T: number) {
  return -a[0] / (2 * T * T) - a[1] / T + a[2] * Math.log(T) + a[3] * T + (a[4] * T * T) / 2 + (a[5] * T ** 3) / 3 + (a[6] * T ** 4) / 4 + a[8];
}

/**
 * A fixed-composition gas.  Caches species moles so station calculations are
 * cheap.  Methods return mass-specific values.
 */
export class Gas {
  readonly comp: Composition;
  readonly n: Record<string, number>;
  readonly nTotal: number; // kmol/kg
  readonly R: number; // J/(kg K)
  readonly MW: number; // kg/kmol
  readonly far: number;

  constructor(comp: Composition, far = 0) {
    this.comp = comp;
    this.far = far;
    this.n = speciesMoles(comp);
    this.nTotal = Object.values(this.n).reduce((s, v) => s + v, 0);
    this.R = R_UNIVERSAL * this.nTotal;
    this.MW = 1 / this.nTotal;
  }

  static air(): Gas {
    return new Gas(AIR, 0);
  }
  /** Products of burning fuel into this gas at additional FAR (relative to the air mass). */
  withFuel(farAdd: number): Gas {
    // this gas is 1 kg containing far_this fuel per (1+far_this) kg; adding farAdd kg fuel per kg of *air*
    const airMass = 1 / (1 + this.far);
    const fuelAdd = farAdd * airMass;
    const comp = mixComposition(this.comp, 1, JETA, fuelAdd);
    return new Gas(comp, this.far + farAdd);
  }
  mixWith(other: Gas, wThis: number, wOther: number): Gas {
    const comp = mixComposition(this.comp, wThis, other.comp, wOther);
    const fuelThis = (wThis * this.far) / (1 + this.far), fuelOther = (wOther * other.far) / (1 + other.far);
    const air = wThis + wOther - fuelThis - fuelOther;
    return new Gas(comp, (fuelThis + fuelOther) / air);
  }

  /** Specific heat at constant pressure, J/(kg K). */
  cp(T: number): number {
    let s = 0;
    for (const k in this.n) s += this.n[k] * cpR(pick(SPECIES[k], T), T);
    return s * R_UNIVERSAL;
  }
  /** Absolute specific enthalpy, J/kg. */
  h(T: number): number {
    let s = 0;
    for (const k in this.n) s += this.n[k] * hRT(pick(SPECIES[k], T), T);
    return s * R_UNIVERSAL * T;
  }
  /** Standard-state entropy (at P_REF, including mixing term), J/(kg K). */
  s0(T: number): number {
    let s = 0;
    for (const k in this.n) {
      const ni = this.n[k];
      if (ni <= 0) continue;
      s += ni * (sR(pick(SPECIES[k], T), T) - Math.log(ni / this.nTotal));
    }
    return s * R_UNIVERSAL;
  }
  /** Entropy at (T, P), J/(kg K). */
  s(T: number, P: number): number {
    return this.s0(T) - this.R * Math.log(P / P_REF);
  }
  gamma(T: number): number {
    const cp = this.cp(T);
    return cp / (cp - this.R);
  }
  /** Speed of sound, m/s (frozen composition). */
  a(T: number): number {
    return Math.sqrt(this.gamma(T) * this.R * T);
  }
  /** Temperature from enthalpy (Newton). */
  TfromH(h: number, Tguess = 800): number {
    let T = Math.min(Math.max(Tguess, 150), 5000);
    for (let i = 0; i < 60; i++) {
      const f = this.h(T) - h;
      const dT = -f / this.cp(T);
      T += Math.max(-400, Math.min(400, dT));
      if (T < 150) T = 150;
      if (Math.abs(dT) < 1e-7 * T) return T;
    }
    return T;
  }
  /** Temperature from entropy at pressure P (Newton). */
  TfromS(s: number, P: number, Tguess = 800): number {
    let T = Math.min(Math.max(Tguess, 150), 5000);
    for (let i = 0; i < 60; i++) {
      const f = this.s(T, P) - s;
      const dT = -f / (this.cp(T) / T);
      T += Math.max(-400, Math.min(400, dT));
      if (T < 150) T = 150;
      if (Math.abs(dT) < 1e-7 * T) return T;
    }
    return T;
  }
  /** Isentropic end temperature from (T1,P1) to P2. */
  isentropicT(T1: number, P1: number, P2: number): number {
    const s = this.s(T1, P1);
    const g = this.gamma(T1);
    const guess = T1 * Math.pow(P2 / P1, (g - 1) / g);
    return this.TfromS(s, P2, guess);
  }
}
