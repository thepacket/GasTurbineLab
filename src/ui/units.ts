/** Display-unit conversion. Inputs stay SI; results, tables and callouts render in the chosen system. */
import { fmt } from './format';
export type Units = 'SI' | 'imperial';

const LBF = 4.4482216, LB = 0.45359237, FT = 0.3048, PSI = 6894.757, HP = 745.7, IN2 = 0.00064516;

export function U(units: Units) {
  const imp = units === 'imperial';
  return {
    imp,
    thrust: (N: number) => (imp ? { v: fmt(N / LBF, Math.abs(N / LBF) > 1e4 ? 0 : 1), u: 'lbf' } : { v: fmt(N / 1000, Math.abs(N) > 1e5 ? 1 : 2), u: 'kN' }),
    pressure: (Pa: number) => (imp ? { v: fmt(Pa / PSI, Pa / PSI > 100 ? 1 : 2), u: 'psi' } : { v: fmt(Pa / 1000, Pa > 1e6 ? 0 : 1), u: 'kPa' }),
    temperature: (K: number) => (imp ? { v: fmt(K * 1.8, 0), u: '°R' } : { v: fmt(K, K > 1000 ? 0 : 1), u: 'K' }),
    massflow: (kgs: number, d = 2) => (imp ? { v: fmt(kgs / LB, d), u: 'lb/s' } : { v: fmt(kgs, d), u: 'kg/s' }),
    fuelflow: (kgs: number) => (imp ? { v: fmt((kgs / LB) * 3600, 0), u: 'lb/h' } : { v: fmt(kgs, 3), u: 'kg/s' }),
    power: (W: number) => (imp ? { v: fmt(W / HP, W / HP > 1e4 ? 0 : 1), u: 'hp' } : Math.abs(W) >= 1e6 ? { v: fmt(W / 1e6, 2), u: 'MW' } : { v: fmt(W / 1e3, 0), u: 'kW' }),
    tsfc: (kg_Nh: number) => (imp ? { v: fmt((kg_Nh / LB) * LBF, 3), u: 'lb/(lbf·h)' } : { v: fmt(kg_Nh * 1e6 / 3600, 2), u: 'mg/(N·s)' }),
    psfc: (kg_kWh: number) => (imp ? { v: fmt((kg_kWh / LB) * (HP / 1000), 3), u: 'lb/(hp·h)' } : { v: fmt(kg_kWh, 3), u: 'kg/kWh' }),
    velocity: (ms: number) => (imp ? { v: fmt(ms / FT, 0), u: 'ft/s' } : { v: fmt(ms, 0), u: 'm/s' }),
    area: (m2: number) => (imp ? { v: fmt(m2 / IN2, 0), u: 'in²' } : { v: fmt(m2, 3), u: 'm²' }),
    length: (m: number) => (imp ? { v: fmt(m / FT, 1), u: 'ft' } : { v: fmt(m, 2), u: 'm' }),
    altitude: (m: number) => (imp ? { v: fmt(m / FT, 0), u: 'ft' } : { v: fmt(m, 0), u: 'm' }),
    specificThrust: (Nskg: number) => (imp ? { v: fmt((Nskg / LBF) * LB, 1), u: 'lbf·s/lb' } : { v: fmt(Nskg, 1), u: 'N·s/kg' }),
  };
}
