import { describe, it, expect } from 'vitest';
import { defaultInputs } from '../defaults';
import { makeDesignPoint, solveOffDesign } from '../offdesign';
import { runTransient, DEFAULT_CONTROLLER, DEFAULT_THERMAL, TransientInputs, TransientResult } from '../transient';
import { calibratedEngines } from '../engines';

/** Fixes from the transient/control review (round 4): honest convergence, unlit start-up, failed-step policy, limiter precedence, contact detection. */

/** the Transient view's defaults for an engine, as the UI builds them */
function uiTransient(inp: ReturnType<typeof defaultInputs>, startEnabled: boolean): TransientInputs {
  const start = { enabled: startEnabled, starterTorque_Nm: Math.round(inp.inertia.HP * 60), starterCutout: 0.45, lightOffSpeed: 0.18, lightOffT3min_K: 290, lightOffFuelFrac: 0.06, frictionPower_W: Math.round(inp.flight.W_kgs * 150) };
  // enabling "start from shutdown" in the UI moves the ramp to light-off, stretches it to 20 s and caps the final fuel at 0.5
  const schedule = startEnabled ? { T4start: Math.round(inp.burner.T4_K * 0.75), WfEndFrac: 0.5, rampStart_s: 0, rampDuration_s: 20, ratioUnitLimit: 0, ratioUnitFloor: 0 } : { T4start: Math.round(inp.burner.T4_K * 0.75), WfEndFrac: 1.0, rampStart_s: 0.5, rampDuration_s: 0.3, ratioUnitLimit: 0, ratioUnitFloor: 0 };
  const od = { altitude_m: inp.flight.altitude_m, mach: inp.flight.mach, dT_isa: inp.flight.dT_isa, throttle: { mode: 'T4' as const, value: inp.burner.T4_K }, HPX_W: inp.HPX_W, propPower_W: inp.prop.shaftPower_W };
  return { od, schedule, duration_s: startEnabled ? 60 : 8, dt_s: startEnabled ? 0.1 : 0.04, start, controller: { ...DEFAULT_CONTROLLER, target: inp.arch === 'turbofan' ? 0.95 : 0.98 } };
}
/** every plotted gas-path sample is a converged solution; starter-only samples carry no gas-path quantities */
function expectHonest(r: TransientResult) {
  for (const s of r.samples) {
    if (s.gasPath) expect(s.converged).toBe(true);
    else { expect(s.Wf).toBe(0); expect(s.Fn).toBe(0); expect(s.lit).toBe(false); }
  }
}

describe('1. compressor flow matching is separate from the R-line boundary handling', () => {
  it('a converged fixed-speed solution matches map flow on every compressor even past the stall line, which is flagged with a negative surge margin', () => {
    const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen';
    const dp = makeDesignPoint(inp);
    const r = runTransient(dp, { ...uiTransient(inp, false), thermal: { ...DEFAULT_THERMAL, enabled: true } });
    expectHonest(r);
    const minSM = Math.min(...r.samples.map((s) => s.SM.lpc));
    const s = r.samples.find((q) => q.SM.lpc === minSM)!;
    const sol = solveOffDesign(dp, { ...r.samples[0] && uiTransient(inp, false).od, throttle: { mode: 'Wf', value: s.Wf } }, undefined, { fixedSpeeds: { LP: s.N.LP, IP: inp.speeds.IP, HP: s.N.HP } });
    expect(sol.converged).toBe(true);
    for (const c of sol.result.components.filter((q) => q.kind === 'compressor')) expect(Math.abs(c.values.WcMap / c.values.Wc - 1)).toBeLessThan(1e-6);
    const lpc = sol.result.components.find((c) => c.id === 'lpc')!.values;
    expect(lpc.Rline).toBeLessThan(1); // below the first tabulated R-line
    expect(lpc.offMap).toBe(1);
    expect(lpc.surgeMargin_pct).toBeLessThan(0); // not clipped to 0
    expect(sol.result.offDesign!.mapViolations).toContain('lpc');
    expect(sol.result.warnings.some((w) => w.includes('beyond the tabulated R-line range'))).toBe(true);
  });
  it('a solution that can only satisfy the residual vector through the R-line penalty is reported as not converged', () => {
    // a catalogue engine whose booster leaves its map at cruise part power
    const e = calibratedEngines().find((q) => q.spec.name === 'TFE731-2')!;
    const dp = makeDesignPoint({ ...e.inputs, chemistry: 'frozen' });
    const s = solveOffDesign(dp, { altitude_m: 11000, mach: 0.8, dT_isa: 0, throttle: { mode: 'T4', value: e.inputs.burner.T4_K * 0.9 } });
    expect(s.converged).toBe(false);
    expect(s.result.offDesign!.flowMismatch!).toBeGreaterThan(1e-3);
    expect(s.result.offDesign!.mapViolations!.length).toBeGreaterThan(0);
  });
});

describe('2. start-up: no fuel and no heat release before light-off; the schedule is referenced to light-off', () => {
  const inp = defaultInputs('turbojet'); inp.chemistry = 'frozen';
  const dp = makeDesignPoint(inp);
  it('an unlit gas path burns nothing whatever the throttle says', () => {
    const s = solveOffDesign(dp, { altitude_m: 0, mach: 0, dT_isa: 0, throttle: { mode: 'Wf', value: 0 }, burnerLit: false }, undefined, { fixedSpeeds: { LP: 0, IP: 0, HP: inp.speeds.HP * 0.3 } });
    expect(s.converged).toBe(true);
    const b = s.result.components.find((c) => c.id === 'burner')!.values;
    expect(b.Wfuel_kgs).toBe(0);
    expect(b.FAR).toBe(0);
    const T3 = s.result.stations.find((q) => q.id === '3')!.Tt, T4 = s.result.stations.find((q) => q.id === '4')!.Tt;
    expect(Math.abs(T4 - T3)).toBeLessThan(0.01);
  });
  it('the UI start-up delivers zero fuel until light-off and ramps from the light-off instant', () => {
    const ti = uiTransient(inp, true);
    const r = runTransient(dp, ti);
    expectHonest(r);
    const iLit = r.samples.findIndex((s) => s.lit);
    expect(iLit).toBeGreaterThan(0);
    for (const s of r.samples.slice(0, iLit)) { expect(s.Wf).toBe(0); expect(s.WfCmd).toBe(0); expect(s.T4).toBeLessThan(330); }
    const tLit = r.samples[iLit].t;
    const WfDes = r.design.Wf;
    expect(r.samples[iLit].WfCmd).toBeCloseTo(0.06 * WfDes, 6);
    // half-way through the 20 s ramp measured from light-off the command is half-way between light-off and final fuel
    const mid = r.samples.find((s) => Math.abs(s.t - (tLit + 10)) < 0.051);
    if (mid) expect(mid.WfCmd / WfDes).toBeCloseTo(0.06 + 0.5 * (0.5 - 0.06), 2);
    const last = r.samples[r.samples.length - 1];
    expect(r.complete).toBe(true);
    expect(last.Npct.HP).toBeGreaterThan(50);
    expect(Math.max(...r.samples.map((s) => s.T4))).toBeLessThan(1700);
  });
});

describe('3. failed gas-path solutions never advance the dynamics', () => {
  it('a start-up whose gas path cannot be established is integrated in the explicit starter-only regime and reported as such', () => {
    const inp = defaultInputs('turbofan'); inp.chemistry = 'frozen'; // cruise condition start, as the review ran it
    const dp = makeDesignPoint(inp);
    const r = runTransient(dp, uiTransient(inp, true));
    expectHonest(r);
    expect(r.starterOnlySteps).toBe(r.samples.length);
    expect(r.samples.every((s) => !s.gasPath && !s.converged)).toBe(true);
    expect(r.warnings.some((w) => w.includes('starter-only regime'))).toBe(true);
    expect(r.warnings.some((w) => w.startsWith('Hung start') && w.includes('no through-flow solution'))).toBe(true);
  });
  it('a lit step that does not converge stops the trajectory with an explicit incomplete flag', () => {
    const inp = defaultInputs('turbojet'); inp.chemistry = 'frozen';
    const dp = makeDesignPoint(inp);
    // over-fuel violently after light-off with the limiter off: the compressor is driven past its map
    const ti = uiTransient(inp, true);
    ti.schedule = { ...ti.schedule, WfEndFrac: 1.0, rampStart_s: 0, rampDuration_s: 0.2 };
    ti.controller = undefined;
    const r = runTransient(dp, ti);
    expectHonest(r);
    expect(r.complete).toBe(false);
    expect(r.stoppedAt_s).toBeDefined();
    expect(r.stoppedAt_s!).toBeLessThan(ti.duration_s);
    expect(r.warnings.some((w) => w.includes('did not converge') && w.includes('trajectory stops'))).toBe(true);
    expect(r.samples[r.samples.length - 1].t).toBeLessThan(r.stoppedAt_s!);
  });
});

describe('4. limiter precedence is explicit', () => {
  const inp = defaultInputs('turbojet'); inp.chemistry = 'frozen';
  const dp = makeDesignPoint(inp);
  const base = uiTransient(inp, false);
  it('with the controller limiter on "schedule" the manual Wf/P3 values have no effect', () => {
    const a = runTransient(dp, base);
    const b = runTransient(dp, { ...base, schedule: { ...base.schedule, ratioUnitLimit: 0.5, ratioUnitFloor: 0.5 } });
    expect(b.samples.map((s) => s.Wf)).toEqual(a.samples.map((s) => s.Wf));
  });
  it('with the controller limiter on "manual" the manual Wf/P3 limit and floor act and the schedule is ignored', () => {
    const manual = { ...base, controller: { ...base.controller!, limiter: 'manual' as const } };
    const free = runTransient(dp, manual);
    const lim = runTransient(dp, { ...manual, schedule: { ...base.schedule, ratioUnitLimit: 1.05 } });
    expect(lim.samples.some((s) => s.limited)).toBe(true);
    expect(Math.max(...free.samples.map((s) => s.Wf / s.P3)) / free.design.ratioUnit).toBeGreaterThan(1.05);
    // the limit is applied on the previous step's P3 and refined once on the solved P3 (0.5 % tolerance)
    expect(Math.max(...lim.samples.map((s) => s.Wf / s.P3)) / free.design.ratioUnit).toBeLessThan(1.05 * 1.006);
    expect(Math.min(...lim.samples.map((s) => s.SM.comp))).toBeGreaterThan(Math.min(...free.samples.map((s) => s.SM.comp)));
    // a wild schedule does nothing in manual mode
    const wild = runTransient(dp, { ...manual, schedule: { ...base.schedule, ratioUnitLimit: 1.05 }, controller: { ...manual.controller, accelSchedule: [{ Nc: 0.5, ratioUnit: 0.3 }, { Nc: 1, ratioUnit: 0.3 }] } });
    expect(wild.samples.map((s) => s.Wf)).toEqual(lim.samples.map((s) => s.Wf));
  });
});

describe('5. tip clearance is reported as computed and contact is detected', () => {
  it('a cold-clearance case that closes the gap reports a negative clearance, a rub flag and a warning', () => {
    const inp = defaultInputs('turbojet'); inp.chemistry = 'frozen';
    const dp = makeDesignPoint(inp);
    const ti = { ...uiTransient(inp, false), thermal: { ...DEFAULT_THERMAL, enabled: true, coldClearance_mm: 0.5 }, duration_s: 20, dt_s: 0.1 };
    ti.schedule = { ...ti.schedule, T4start: 1450, WfEndFrac: 0.4, rampDuration_s: 1 };
    const r = runTransient(dp, ti);
    expectHonest(r);
    expect(r.minClearance_mm!).toBeLessThan(0);
    expect(r.contact).toBe(true);
    expect(r.samples.some((s) => s.rub)).toBe(true);
    expect(Math.min(...r.samples.map((s) => s.clearance_mm ?? 1))).toBe(r.minClearance_mm);
    expect(r.warnings.some((w) => w.includes('contact predicted'))).toBe(true);
  });
  it('with a normal cold clearance the gap stays positive and no contact is flagged', () => {
    const inp = defaultInputs('turbojet'); inp.chemistry = 'frozen';
    const dp = makeDesignPoint(inp);
    const r = runTransient(dp, { ...uiTransient(inp, false), thermal: { ...DEFAULT_THERMAL, enabled: true } });
    expect(r.contact).toBe(false);
    expect(r.minClearance_mm!).toBeGreaterThan(0.05);
  });
});
