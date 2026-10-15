/**
 * ICAO Annex 16 landing/take-off (LTO) emissions and a component noise
 * estimate.  The LTO cycle runs the fixed engine off-design at the four
 * reference thrust settings (100 / 85 / 30 / 7 % of rated sea-level thrust)
 * for the standard times in mode, integrates the emission indices into
 * Dp/Foo (g per kN of rated thrust) and compares NOx with the CAEP/8 limit
 * and CO / HC with their fixed limits.  Fan noise follows a simplified
 * Heidmann broadband correlation; jet noise comes from the cycle.
 */
import { DesignPoint, solveOffDesign } from './offdesign';
import { EngineResult } from './types';

export interface LtoMode { name: string; thrustFrac: number; time_s: number; Fn: number; Wf: number; EI_NOx: number; EI_CO: number; EI_HC: number; converged: boolean; T3: number; N1pct: number }
export interface LtoResult { Foo_kN: number; OPR: number; modes: LtoMode[]; DpFoo: { NOx: number; CO: number; HC: number }; limits: { NOx: number; CO: number; HC: number }; margins: { NOx: number; CO: number; HC: number }; fuel_kg: number; applicable: boolean; complete: boolean; warnings: string[] }

const LTO: { name: string; thrustFrac: number; time_s: number }[] = [
  { name: 'Take-off', thrustFrac: 1.0, time_s: 0.7 * 60 }, { name: 'Climb-out', thrustFrac: 0.85, time_s: 2.2 * 60 }, { name: 'Approach', thrustFrac: 0.30, time_s: 4.0 * 60 }, { name: 'Taxi / idle', thrustFrac: 0.07, time_s: 26.0 * 60 },
];

/** CAEP/8 NOx limit, Dp/Foo in g/kN, as a function of overall pressure ratio and rated thrust (kN). */
export function caep8NOxLimit(opr: number, Foo_kN: number): number {
  if (!Number.isFinite(opr) || opr <= 0 || !Number.isFinite(Foo_kN) || Foo_kN <= 0) throw new Error('NOx limit requires positive finite OPR and rated thrust.');
  // EASA emissions databank introduction, CAEP/8: the >=104.7 branch is common to both thrust classes.
  // https://www.easa.europa.eu/en/downloads/45576/en
  if (opr >= 104.7) return 32 + 1.6 * opr;
  if (Foo_kN > 89) {
    if (opr <= 30) return 7.88 + 1.4080 * opr;
    if (opr < 104.7) return -9.88 + 2.0 * opr;
    return 32 + 1.6 * opr;
  }
  if (opr <= 30) return 40.052 + 1.5681 * opr - 0.3615 * Foo_kN - 0.0018 * opr * Foo_kN;
  if (opr < 104.7) return 41.9435 + 1.505 * opr - 0.5823 * Foo_kN + 0.005562 * opr * Foo_kN;
  return 32 + 1.6 * opr;
}

export function runLto(dp: DesignPoint, Foo_N?: number, progress?: (m: LtoMode[]) => void): LtoResult {
  const warnings: string[] = [];
  // rated thrust: sea-level static at the design T4 (the design itself if it is SLS)
  const inp = dp.inputs;
  if (Foo_N !== undefined && (!Number.isFinite(Foo_N) || Foo_N <= 0)) throw new Error('Rated thrust must be finite and positive.');
  // rated thrust Foo and the reference pressure ratio come from the same converged sea-level static ISA rating point
  // (Annex 16: π00 is the OPR at the take-off rating under ISA sea-level static conditions)
  let Foo = Foo_N ?? 0;
  let oprRef = dp.result.perf.OPR;
  if (Foo_N === undefined && inp.flight.altitude_m === 0 && inp.flight.mach === 0 && inp.flight.dT_isa === 0) { Foo = dp.result.perf.Fn; }
  else {
    const s = solveOffDesign(dp, { altitude_m: 0, mach: 0, dT_isa: 0, throttle: Foo_N === undefined ? { mode: 'T4', value: inp.burner.T4_K } : { mode: 'Fn', value: Foo_N } });
    if (s.converged) { if (!Foo) Foo = s.result.perf.Fn; oprRef = s.result.perf.OPR; }
    else throw new Error('Sea-level static rating did not converge; LTO reference thrust and pressure ratio are unavailable.');
  }
  if (!Number.isFinite(Foo) || Foo <= 0) throw new Error('No positive rated thrust for the LTO calculation.');
  const modes: LtoMode[] = [];
  let warm: Record<string, number> | undefined;
  for (const m of LTO) {
    const s = solveOffDesign(dp, { altitude_m: 0, mach: 0, dT_isa: 0, throttle: { mode: 'Fn', value: m.thrustFrac * Foo } }, warm);
    if (s.converged) warm = s.x; else warnings.push(`${m.name} (${(m.thrustFrac * 100).toFixed(0)} %) did not converge.`);
    const p = s.result.perf;
    const T3 = s.result.stations.find((q) => q.id === '3')!.Tt;
    // HC: like CO, from combustor inlet temperature (approximate)
    const EI_HC = inp.fuel === 'hydrogen' ? 0 : 0.05 + 6 * Math.exp(-(T3 - 450) / 90);
    modes.push({ name: m.name, thrustFrac: m.thrustFrac, time_s: m.time_s, Fn: p.Fn, Wf: p.Wfuel, EI_NOx: p.EI_NOx_g_kg, EI_CO: p.EI_CO_g_kg, EI_HC, converged: s.converged, T3, N1pct: (100 * (s.x.N_LP ?? inp.speeds.LP)) / Math.max(inp.speeds.LP, 1) });
    progress?.(modes.slice());
  }
  const complete = modes.every(m => m.converged && [m.Wf, m.EI_NOx, m.EI_CO, m.EI_HC].every(Number.isFinite));
  if (!complete) warnings.push('LTO cycle is incomplete; integrated emissions, fuel and margins are unavailable.');
  const Dp = (key: 'EI_NOx' | 'EI_CO' | 'EI_HC') => complete ? modes.reduce((a, m) => a + m[key] * m.Wf * m.time_s, 0) : NaN; // g
  const Foo_kN = Foo / 1000;
  const DpFoo = { NOx: Dp('EI_NOx') / Foo_kN, CO: Dp('EI_CO') / Foo_kN, HC: Dp('EI_HC') / Foo_kN };
  const opr = oprRef;
  const limits = { NOx: caep8NOxLimit(opr, Foo_kN), CO: 118, HC: 19.6 };
  const margins = { NOx: (1 - DpFoo.NOx / limits.NOx) * 100, CO: (1 - DpFoo.CO / limits.CO) * 100, HC: (1 - DpFoo.HC / limits.HC) * 100 };
  const applicable = Foo_kN > 26.7 && inp.arch !== 'turboprop' && !inp.afterburner.enabled && (inp.fuel === undefined || inp.fuel === 'jetA' || inp.fuel === 'saf');
  if (!applicable) warnings.push('This fuel, architecture, afterburner configuration or thrust rating is outside the supported CAEP/8 comparison.');
  if (!applicable) for (const k of ['NOx', 'CO', 'HC'] as const) margins[k] = NaN;
  return { Foo_kN, OPR: opr, modes, DpFoo, limits, margins, fuel_kg: complete ? modes.reduce((a, m) => a + m.Wf * m.time_s, 0) : NaN, applicable, complete, warnings };
}

export interface NoiseEstimate { fanInlet_dB: number; fanTone_dB: number; jet_dB: number; total_dB: number; tipMach: number; notes: string[] }
/** Simplified Heidmann fan inlet broadband + jet mixing noise, overall level at 1 m. */
export function estimateNoise(r: EngineResult): NoiseEstimate {
  const inp = r.inputs;
  const notes: string[] = [];
  const fan = r.components.find((c) => c.id === 'fan' || c.id === 'comp');
  const st2 = r.stations.find((s) => s.id === '2')!;
  const exit = r.stations.find((s) => s.id === (inp.arch === 'turbofan' ? '21' : '3'))!;
  const rpm = inp.arch === 'turbofan' ? (r.shafts.find((s) => s.name === 'LP shaft')?.rpm ?? inp.speeds.LP) / inp.fanGear.ratio : (r.shafts[0]?.rpm ?? inp.speeds.HP);
  const rTip = Math.sqrt(st2.A / (Math.PI * (1 - 0.09)));
  const Utip = (2 * Math.PI * rpm / 60) * rTip;
  const a2 = Math.sqrt(1.4 * 287.05 * st2.Ts);
  const tipMach = Math.sqrt(Utip * Utip + st2.V * st2.V) / a2;
  const dT = Math.max(exit.Tt - st2.Tt, 1);
  const W = st2.W;
  // Heidmann inlet broadband: L = 20 log(ΔT/ΔT0) + 10 log(W/W0) + F(Mtip) + const
  const F = tipMach < 0.9 ? 0 : Math.min(12, 40 * (tipMach - 0.9));
  const fanInlet = 80 + 12 * Math.log10(dT / 0.555) + 10 * Math.log10(W / 0.453) + F; // calibrated: HBPR take-off fan ~150 dB at 1 m
  const fanTone = fanInlet + (tipMach > 1 ? 6 : 3); // blade-passing tone a few dB above broadband; buzz-saw when supersonic
  const jet = r.perf.jetNoise_dB;
  const total = 10 * Math.log10(Math.pow(10, fanInlet / 10) + Math.pow(10, fanTone / 10) + Math.pow(10, jet / 10));
  if (tipMach > 1) notes.push('Supersonic fan tip: multiple-pure-tone (buzz-saw) noise expected; acoustic liners not modelled.');
  if (fan?.values.PR && fan.values.PR > 1.7) notes.push('High fan pressure ratio: fan noise dominates the forward arc.');
  return { fanInlet_dB: fanInlet, fanTone_dB: fanTone, jet_dB: jet, total_dB: total, tipMach, notes };
}
