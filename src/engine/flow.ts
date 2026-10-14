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
  return { gas, Pt, Tt, ht: gas.h(Tt), W };
}

/** Total conditions from static state and velocity. */
export function totalFromStatic(gas: Gas, Ts: number, Ps: number, V: number, W: number): Flow {
  const ht = gas.h(Ts) + 0.5 * V * V;
  const Tt = gas.TfromH(ht, Ts * (1 + 0.2 * (V / gas.a(Ts)) ** 2));
  const Pt = Ps * Math.exp((gas.s0(Tt) - gas.s0(Ts)) / gas.R);
  return { gas, Pt, Tt, ht, W };
}

/** Static state for a given Mach number (isentropic from totals). */
export function staticFromMN(f: Flow, MN: number): StaticState {
  const g = f.gas;
  if (MN < 1e-9) {
    const rho = f.Pt / (g.R * f.Tt);
    return { Ts: f.Tt, Ps: f.Pt, V: 0, MN: 0, A: Infinity, rho };
  }
  // Solve ht - h(Ts) = 0.5*(MN*a(Ts))^2
  const gam = g.gamma(f.Tt);
  let Ts = f.Tt / (1 + ((gam - 1) / 2) * MN * MN);
  for (let i = 0; i < 50; i++) {
    const a = g.a(Ts);
    const F = f.ht - g.h(Ts) - 0.5 * MN * MN * a * a;
    // d/dTs: -cp - 0.5*MN^2 * gamma*R  (ignoring dgamma/dT)
    const dF = -g.cp(Ts) - 0.5 * MN * MN * g.gamma(Ts) * g.R;
    const dT = -F / dF;
    Ts += dT;
    if (Math.abs(dT) < 1e-8 * Ts) break;
  }
  const V = MN * g.a(Ts);
  const Ps = f.Pt * Math.exp((g.s0(Ts) - g.s0(f.Tt)) / g.R);
  const rho = Ps / (g.R * Ts);
  return { Ts, Ps, V, MN, A: f.W / (rho * V), rho };
}

/** Static state for a given static pressure (isentropic expansion from totals). */
export function staticFromPs(f: Flow, Ps: number): StaticState {
  const g = f.gas;
  const Ts = g.isentropicT(f.Tt, f.Pt, Ps);
  const dh = Math.max(f.ht - g.h(Ts), 0);
  const V = Math.sqrt(2 * dh);
  const rho = Ps / (g.R * Ts);
  return { Ts, Ps, V, MN: V / g.a(Ts), A: V > 0 ? f.W / (rho * V) : Infinity, rho };
}
