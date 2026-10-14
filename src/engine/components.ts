import { Gas } from './gas';
import { Flow, staticFromMN, staticFromPs, staticFromArea, totalFromStatic, StaticState } from './flow';

export interface CompressorOut {
  out: Flow;
  power: number; // W (positive = absorbed)
  effPoly: number;
  bleeds: Flow[];
}

/**
 * Adiabatic compression at a given pressure ratio and isentropic efficiency.
 * Bleeds are extracted at the exit state (pyCycle frac_P = frac_work = 1).
 */
export function compressor(inp: Flow, PR: number, eff: number, bleedFracs: number[] = []): CompressorOut {
  const g = inp.gas;
  const Pt2 = inp.Pt * PR;
  const Tideal = g.isentropicT(inp.Tt, inp.Pt, Pt2);
  const hIdeal = g.h(Tideal, Pt2);
  const ht2 = inp.ht + (hIdeal - inp.ht) / eff;
  const Tt2 = g.TfromH(ht2, Pt2, Tideal);
  const bleeds: Flow[] = [];
  let Wout = inp.W;
  for (const f of bleedFracs) {
    const Wb = inp.W * f;
    Wout -= Wb;
    bleeds.push({ gas: g, Pt: Pt2, Tt: Tt2, ht: ht2, W: Wb });
  }
  const power = inp.W * (ht2 - inp.ht); // all flow (incl. bleed) is compressed to exit
  const effPoly = (g.R * Math.log(PR)) / (g.s(Tt2, Pt2) - g.s(inp.Tt, inp.Pt) + g.R * Math.log(PR)); // polytropic efficiency from entropy rise
  return { out: { gas: g, Pt: Pt2, Tt: Tt2, ht: ht2, W: Wout }, power, effPoly, bleeds };
}

export interface TurbineStream { flow: Flow; fracP: number } // fracP: 1 = enters at turbine inlet pressure, 0 = at exit

export interface TurbineOut { out: Flow; power: number; PR: number }

/** Expand main flow (plus cooling streams) to Pt_out with isentropic efficiency eff. */
export function turbineAtPR(main: Flow, PR: number, eff: number, cooling: TurbineStream[] = []): TurbineOut {
  const PtOut = main.Pt / PR;
  const streams: { f: Flow; Pt: number }[] = [{ f: main, Pt: main.Pt }, ...cooling.map((c) => ({ f: c.flow, Pt: PtOut + c.fracP * (main.Pt - PtOut) }))];
  let power = 0;
  let Wtot = 0;
  let Hsum = 0;
  let gas: Gas | null = null;
  let Wacc = 0;
  for (const s of streams) {
    const g = s.f.gas;
    const Tideal = g.isentropicT(s.f.Tt, s.Pt, PtOut);
    const hIdeal = g.h(Tideal, PtOut);
    const hOut = s.f.ht - eff * (s.f.ht - hIdeal);
    power += s.f.W * (s.f.ht - hOut);
    Hsum += s.f.W * hOut;
    Wtot += s.f.W;
    gas = gas ? gas.mixWith(g, Wacc, s.f.W) : g;
    Wacc += s.f.W;
  }
  const ht = Hsum / Wtot;
  const gOut = gas!;
  const Tt = gOut.TfromH(ht, PtOut, main.Tt / Math.pow(PR, 0.25));
  return { out: { gas: gOut, Pt: PtOut, Tt, ht, W: Wtot }, power, PR };
}

/** Find the turbine PR delivering the required power. Returns {result, satisfied}. */
export function turbineForPower(main: Flow, powerReq: number, eff: number, cooling: TurbineStream[], PRmax: number): { res: TurbineOut; satisfied: boolean } {
  const f = (PR: number) => turbineAtPR(main, PR, eff, cooling).power - powerReq;
  let lo = 1.0005, hi = Math.max(PRmax, 1.001);
  const fhi = f(hi);
  if (fhi < 0) return { res: turbineAtPR(main, hi, eff, cooling), satisfied: false };
  // bisection on ln(PR) then polish with secant
  let flo = f(lo);
  if (flo > 0) return { res: turbineAtPR(main, lo, eff, cooling), satisfied: true };
  for (let i = 0; i < 80; i++) {
    const mid = Math.sqrt(lo * hi);
    const fm = f(mid);
    if (fm > 0) hi = mid; else { lo = mid; flo = fm; }
    if (hi / lo - 1 < 1e-10) break;
  }
  return { res: turbineAtPR(main, Math.sqrt(lo * hi), eff, cooling), satisfied: true };
}

export interface BurnerOut { out: Flow; FAR: number; Wfuel: number }

/** Burn fuel into the flow to reach a target total temperature. */
export function burnerToT(inp: Flow, T4: number, dPqP: number, eff: number, hFuel: number, LHV: number): BurnerOut {
  const Pt = inp.Pt * (1 - dPqP);
  const state = (far: number) => {
    const Wf = far * (inp.W / (1 + inp.gas.far)); // FAR defined on air mass
    const gas = inp.gas.withFuel(far);
    const Wout = inp.W + Wf;
    const ht = (inp.W * inp.ht + Wf * hFuel - (1 - eff) * Wf * LHV) / Wout;
    return { gas, ht, Wout, Wf };
  };
  // Newton on FAR
  let far = 0.02;
  for (let i = 0; i < 60; i++) {
    const s = state(far);
    const T = s.gas.TfromH(s.ht, Pt, T4);
    const F = T - T4;
    const d = 1e-5;
    const s2 = state(far + d);
    const T2 = s2.gas.TfromH(s2.ht, Pt, T);
    const dF = (T2 - T) / d;
    let step = -F / dF;
    step = Math.max(-0.01, Math.min(0.01, step));
    far += step;
    if (far < 1e-5) far = 1e-5;
    if (Math.abs(F) < 1e-6) break;
  }
  const s = state(far);
  const Tt = s.gas.TfromH(s.ht, Pt, T4);
  return { out: { gas: s.gas, Pt, Tt, ht: s.ht, W: s.Wout }, FAR: far, Wfuel: s.Wf };
}

export interface NozzleOut {
  exit: StaticState; throat: StaticState; choked: boolean; Fg: number; Videal: number; PR: number;
}

/** Convergent (CV) or convergent-divergent (CD) nozzle. Cv applied to exit velocity for gross thrust (pyCycle convention). */
export function nozzle(inp: Flow, PambIn: number, type: 'CV' | 'CD', Cv: number): NozzleOut {
  const sonic = staticFromMN(inp, 1);
  // a nozzle cannot expand to a back pressure above its total pressure: keep a tiny expansion so areas stay finite
  const Pamb = Math.min(PambIn, inp.Pt * 0.995);
  const PR = inp.Pt / PambIn;
  let exit: StaticState;
  let choked = Pamb < sonic.Ps;
  if (type === 'CV') {
    exit = choked ? sonic : staticFromPs(inp, Pamb);
  } else {
    exit = staticFromPs(inp, Pamb); // fully expanded
    if (!choked) exit = staticFromPs(inp, Pamb); // subsonic throughout; treat exit as ambient
  }
  const throat = choked ? sonic : exit;
  const Fg = inp.W * exit.V * Cv + (exit.Ps - Pamb) * exit.A;
  return { exit, throat, choked, Fg, Videal: exit.V, PR };
}

export interface MixerOut {
  out: Flow; // mixed total state (after mixer pressure loss)
  Acore: number; Abyp: number; A: number;
  MNcore: number; MNbyp: number; MNout: number;
  PsCore: number; PsByp: number;
  PtLoss: number; // (Pt_mixed ideal - Pt_out)/Pt_in core
}

/**
 * Constant-area mixer.  Design: core Mach given, bypass static pressure matched;
 * off-design: both areas fixed and the static-pressure mismatch is a residual.
 * Mixed state from conservation of mass, momentum (impulse) and energy in A = Acore + Abyp.
 */
export function mixer(core: Flow, byp: Flow, opts: { MNcore?: number; Acore?: number; Abyp?: number }, dPqP: number): MixerOut {
  const stC = opts.Acore !== undefined ? staticFromArea(core, opts.Acore) : staticFromMN(core, opts.MNcore ?? 0.4);
  let stB: StaticState;
  if (opts.Abyp !== undefined) stB = staticFromArea(byp, opts.Abyp);
  else {
    // bypass Mach such that Ps_byp = Ps_core
    let lo = 0.02, hi = 1.0;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      const st = staticFromMN(byp, mid);
      if (st.Ps > stC.Ps) lo = mid; else hi = mid;
    }
    stB = staticFromMN(byp, 0.5 * (lo + hi));
  }
  const Acore = stC.A, Abyp = stB.A, A = Acore + Abyp;
  const W = core.W + byp.W;
  const gas = core.gas.mixWith(byp.gas, core.W, byp.W);
  const ht = (core.W * core.ht + byp.W * byp.ht) / W;
  const I = stC.Ps * Acore + core.W * stC.V + stB.Ps * Abyp + byp.W * stB.V; // impulse
  // solve mixed static pressure on the subsonic branch: impulse(Ps) = I
  const impulse = (Ps: number) => {
    // energy: h(Ts) + V^2/2 = ht with V = W/(rho A) = W R Ts /(Ps A)
    let Ts = ht > gas.h(1000, Ps) ? 1200 : 600;
    for (let k = 0; k < 40; k++) {
      const R = gas.Rlocal(Ts, Ps);
      const V = (W * R * Ts) / (Ps * A);
      const F = gas.h(Ts, Ps) + 0.5 * V * V - ht;
      const dF = gas.cpEq(Ts, Ps) + V * (W * R) / (Ps * A);
      const dT = -F / dF; Ts += Math.max(-150, Math.min(150, dT));
      if (Math.abs(dT) < 1e-7 * Ts) break;
    }
    const R = gas.Rlocal(Ts, Ps);
    const V = (W * R * Ts) / (Ps * A);
    return { I: Ps * A + W * V, Ts, V };
  };
  // impulse is minimal at M=1; subsonic branch has dI/dPs > 0 -> bisection between a low Ps (near sonic) and a high Ps
  let lo = Math.min(stC.Ps, stB.Ps) * 0.6, hi = Math.max(core.Pt, byp.Pt) * 1.2;
  for (let i = 0; i < 70; i++) {
    const mid = 0.5 * (lo + hi);
    if (impulse(mid).I < I) lo = mid; else hi = mid;
    if (hi / lo - 1 < 1e-11) break;
  }
  const Ps = 0.5 * (lo + hi);
  const { Ts, V } = impulse(Ps);
  const total = totalFromStatic(gas, Ts, Ps, V, W);
  const MNout = V / gas.a(Ts, Ps);
  const out: Flow = { ...total, Pt: total.Pt * (1 - dPqP) };
  return { out, Acore, Abyp, A, MNcore: stC.MN, MNbyp: stB.MN, MNout, PsCore: stC.Ps, PsByp: stB.Ps, PtLoss: 1 - out.Pt / core.Pt };
}

/** Burn a given fuel/air ratio (off-design throttle). */
export function burnerAtFAR(inp: Flow, far: number, dPqP: number, eff: number, hFuel: number, LHV: number): BurnerOut {
  const Pt = inp.Pt * (1 - dPqP);
  const Wf = far * (inp.W / (1 + inp.gas.far));
  const gas = inp.gas.withFuel(far);
  const Wout = inp.W + Wf;
  const ht = (inp.W * inp.ht + Wf * hFuel - (1 - eff) * Wf * LHV) / Wout;
  const Tt = gas.TfromH(ht, Pt, inp.Tt + 700);
  return { out: { gas, Pt, Tt, ht, W: Wout }, FAR: far, Wfuel: Wf };
}
