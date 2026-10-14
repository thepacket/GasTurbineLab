import { Gas } from './gas';

/** A total-condition flow state. */
export interface Flow {
  gas: Gas;
  Pt: number; // Pa
  Tt: number; // K
  ht: number; // J/kg
  W: number; // kg/s
}

export interface StaticState { Ts: number; Ps: number; V: number; MN: number; A: number; rho: number }

export function makeFlow(gas: Gas, Pt: number, Tt: number, W: number): Flow {
  return { gas, Pt, Tt, ht: gas.h(Tt, Pt), W };
}

/** Total conditions from static state and velocity. */
export function totalFromStatic(gas: Gas, Ts: number, Ps: number, V: number, W: number): Flow {
  const ht = gas.h(Ts, Ps) + 0.5 * V * V;
  const Tguess = Ts * (1 + 0.2 * (V / gas.a(Ts, Ps)) ** 2);
  // total state: same entropy, enthalpy ht. Iterate because h depends weakly on P with equilibrium chemistry.
  let Pt = Ps * Math.pow(Tguess / Ts, 3.5), Tt = Tguess;
  for (let i = 0; i < 6; i++) {
    Tt = gas.TfromH(ht, Pt, Tt);
    const Pn = gas.PfromS(gas.s(Ts, Ps), Tt, Pt);
    const done = Math.abs(Pn / Pt - 1) < 1e-10;
    Pt = Pn;
    if (done) break;
  }
  return { gas, Pt, Tt, ht, W };
}

/** Static state for a given Mach number (isentropic from totals). */
export function staticFromMN(f: Flow, MN: number): StaticState {
  const g = f.gas;
  if (MN < 1e-9) {
    const rho = f.Pt / (g.R * f.Tt);
    return { Ts: f.Tt, Ps: f.Pt, V: 0, MN: 0, A: Infinity, rho };
  }
  // Solve ht - h(Ts,Ps) = 0.5*(MN*a(Ts))^2 along the isentrope from the total state
  const st = g.s(f.Tt, f.Pt);
  const gam = g.gamma(f.Tt, f.Pt);
  let Ts = f.Tt / (1 + ((gam - 1) / 2) * MN * MN);
  let Ps = f.Pt * Math.pow(Ts / f.Tt, gam / (gam - 1));
  for (let i = 0; i < 50; i++) {
    Ps = g.PfromS(st, Ts, Ps);
    const a = g.a(Ts, Ps);
    const F = f.ht - g.h(Ts, Ps) - 0.5 * MN * MN * a * a;
    const dF = -g.cpEq(Ts, Ps) - 0.5 * MN * MN * g.gamma(Ts, Ps) * g.Rlocal(Ts, Ps);
    const dT = -F / dF;
    Ts += Math.max(-200, Math.min(200, dT));
    if (Math.abs(dT) < 1e-8 * Ts) break;
  }
  Ps = g.PfromS(st, Ts, Ps);
  const V = MN * g.a(Ts, Ps);
  const rho = Ps / (g.Rlocal(Ts, Ps) * Ts);
  return { Ts, Ps, V, MN, A: f.W / (rho * V), rho };
}

/** Static state for a given static pressure (isentropic expansion from totals). */
export function staticFromPs(f: Flow, Ps: number): StaticState {
  const g = f.gas;
  const Ts = g.isentropicT(f.Tt, f.Pt, Ps);
  const dh = Math.max(f.ht - g.h(Ts, Ps), 0);
  const V = Math.sqrt(2 * dh);
  const rho = Ps / (g.Rlocal(Ts, Ps) * Ts);
  return { Ts, Ps, V, MN: V / g.a(Ts, Ps), A: V > 0 ? f.W / (rho * V) : Infinity, rho };
}
