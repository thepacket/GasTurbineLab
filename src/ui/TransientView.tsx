import { useEffect, useState } from 'react';
import { Store } from '../state/store';
import { useStale, StaleBanner } from './useStale';
import { Provenance } from './Provenance';
import { request } from '../engine/client';
import { TransientResult, TransientSample, FuelSchedule, StartInputs, Controller, DEFAULT_CONTROLLER, ThermalInputs, DEFAULT_THERMAL } from '../engine/transient';
import { LineChart, Series } from '../viz/charts';
import { fmt } from './format';
import { MapTrajectory } from '../viz/MapChart';

const DEFAULT: FuelSchedule = { T4start: 1250, WfEndFrac: 1.0, rampStart_s: 0.5, rampDuration_s: 0.3, ratioUnitLimit: 0, ratioUnitFloor: 0 };

export function TransientView({ store }: { store: Store }) {
  const inputs = store.state.inputs;
  const [sch, setSch] = useState<FuelSchedule>({ ...DEFAULT, T4start: Math.round(inputs.burner.T4_K * 0.75) });
  const [duration, setDuration] = useState(8);
  const [th, setTh] = useState<ThermalInputs>({ ...DEFAULT_THERMAL });
  const [ctl, setCtl] = useState<Controller>({ ...DEFAULT_CONTROLLER, target: inputs.arch === 'turbofan' ? 0.95 : 0.98 });
  const [start, setStart] = useState<StartInputs>({ enabled: false, starterTorque_Nm: Math.round(inputs.inertia.HP * 60), starterCutout: 0.45, lightOffSpeed: 0.18, lightOffT3min_K: 290, lightOffFuelFrac: 0.06, frictionPower_W: Math.round(inputs.flight.W_kgs * 150) });
  const [samples, setSamples] = useState<TransientSample[]>([]);
  const [result, setResult] = useState<TransientResult | null>(null);
  const [busy, setBusy] = useState(false);
  const stale = useStale({ inputs, sch, duration, start, ctl, th, od: store.state.od });
  const [error, setError] = useState<string | null>(null);
  const [runContext, setRunContext] = useState({ inputs, ctl, th, start, duration });
  const run = () => {
    setRunContext({ inputs: { ...inputs, chemistry: 'frozen' }, ctl, th, start, duration });
    setBusy(true); setError(null); setResult(null); setSamples([]); stale.snapshot();
    request<TransientResult>({ type: 'transient', inputs: { ...inputs, chemistry: 'frozen' }, ti: { od: { ...store.state.od, throttle: { mode: 'T4', value: inputs.burner.T4_K } }, schedule: sch, duration_s: duration, dt_s: start.enabled ? 0.1 : 0.04, start, controller: ctl, thermal: th } }, (p: TransientSample[]) => setSamples(p))
      .then((r) => { setResult(r); setSamples(r.samples); setBusy(false); })
      .catch((e) => { setError(e.message); setBusy(false); });
  };
  useEffect(() => { /* auto-run once on mount */ run(); /* eslint-disable-next-line */ }, []);
  const colors = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];
  const s = (pick: (x: TransientSample) => number, name: string, c = 0): Series => ({ name, color: colors[c], points: samples.map((x) => ({ x: x.t, y: pick(x) })) });
  const spools = samples[0] ? Object.keys(samples[0].Npct) : [];
  const comps = samples[0] ? Object.keys(samples[0].SM) : [];
  const solved = samples.filter((x) => x.gasPath && x.converged);
  const minSM = comps.map((c) => ({ c, v: solved.length ? Math.min(...solved.map((x) => x.SM[c])) : NaN }));
  const Set = (k: keyof FuelSchedule, v: number) => setSch({ ...sch, [k]: v });
  const manualLimiter = (ctl.limiter ?? 'schedule') === 'manual';
  const starterOnly = samples.filter((x) => !x.gasPath);
  const unconverged = samples.filter((x) => x.gasPath && !x.converged).length;
  return (
    <div>
      <div className="explore-controls">
        <strong>Transient <Provenance level="model" /></strong>
        <label>Start T4 <input className="num" type="number" aria-label="Start T4" style={{ width: 80 }} value={sch.T4start} step={10} onChange={(e) => Set('T4start', +e.target.value)} /> K</label>
        <label>Final fuel <input className="num" type="number" aria-label="Final fuel fraction" style={{ width: 70 }} value={sch.WfEndFrac} step={0.05} onChange={(e) => Set('WfEndFrac', +e.target.value)} /> × design</label>
        <label>Ramp start{start.enabled ? ' after light-off' : ''} <input className="num" type="number" aria-label="Ramp start" style={{ width: 60 }} value={sch.rampStart_s} step={0.1} onChange={(e) => Set('rampStart_s', +e.target.value)} /> s</label>
        <label>Ramp time <input className="num" type="number" aria-label="Ramp duration" style={{ width: 60 }} value={sch.rampDuration_s} step={0.1} onChange={(e) => Set('rampDuration_s', +e.target.value)} /> s</label>
        <label title={manualLimiter ? 'Manual Wf/P3 limits are in force (FADEC limiter set to manual).' : 'Ignored: the FADEC acceleration schedule and deceleration floor are in force. Set the FADEC limiter to manual to use these.'} style={{ opacity: manualLimiter ? 1 : 0.5 }}>Wf/P3 limit <input className="num" type="number" aria-label="Ratio unit limit" style={{ width: 60 }} value={sch.ratioUnitLimit} step={0.05} disabled={!manualLimiter} onChange={(e) => Set('ratioUnitLimit', +e.target.value)} /> × design (0 = off)</label>
        <label title={manualLimiter ? 'Manual Wf/P3 limits are in force (FADEC limiter set to manual).' : 'Ignored: the FADEC acceleration schedule and deceleration floor are in force. Set the FADEC limiter to manual to use these.'} style={{ opacity: manualLimiter ? 1 : 0.5 }}>Wf/P3 floor <input className="num" type="number" aria-label="Ratio unit floor" style={{ width: 60 }} value={sch.ratioUnitFloor} step={0.05} disabled={!manualLimiter} onChange={(e) => Set('ratioUnitFloor', +e.target.value)} /> × design (0 = off)</label>
        <label>Duration <input className="num" type="number" aria-label="Duration" style={{ width: 60 }} value={duration} step={1} onChange={(e) => setDuration(+e.target.value)} /> s</label>
        <label className="toggle"><input type="checkbox" checked={start.enabled} onChange={(e) => { const on = e.target.checked; setStart({ ...start, enabled: on }); if (on) { if (duration < 40) setDuration(60); setSch({ ...sch, rampStart_s: 0, rampDuration_s: Math.max(sch.rampDuration_s, 20), WfEndFrac: Math.min(sch.WfEndFrac, 0.5) }); } }} /> start from shutdown</label>
        {start.enabled && (
          <>
            <label>starter torque <input className="num" type="number" aria-label="Starter torque" style={{ width: 70 }} value={start.starterTorque_Nm} step={10} onChange={(e) => setStart({ ...start, starterTorque_Nm: +e.target.value })} /> N·m</label>
            <label>cut-out at <input className="num" type="number" aria-label="Starter cut-out speed" style={{ width: 60 }} value={start.starterCutout} step={0.01} onChange={(e) => setStart({ ...start, starterCutout: +e.target.value })} /> N2</label>
            <label>light-off at <input className="num" type="number" aria-label="Light-off speed" style={{ width: 60 }} value={start.lightOffSpeed} step={0.01} onChange={(e) => setStart({ ...start, lightOffSpeed: +e.target.value })} /> N2</label>
            <label>light-off fuel <input className="num" type="number" aria-label="Light-off fuel" style={{ width: 60 }} value={start.lightOffFuelFrac} step={0.01} onChange={(e) => setStart({ ...start, lightOffFuelFrac: +e.target.value })} /> × design</label>
            <label>friction <input className="num" type="number" aria-label="Friction power" style={{ width: 70 }} value={start.frictionPower_W} step={100} onChange={(e) => setStart({ ...start, frictionPower_W: +e.target.value })} /> W at design speed</label>
          </>
        )}
        <button className="btn primary" onClick={run} disabled={busy}>{busy ? 'Integrating…' : 'Run'}</button>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Spool inertias: {Object.entries(inputs.inertia).filter(([k, v]) => v > 0 && (inputs.speeds as any)[k] > 0).map(([k, v]) => `${k} ${v} kg·m²`).join(', ')} (Build → Inertia). Operating point from the off-design panel ({store.state.od.altitude_m} m, M {store.state.od.mach}). Frozen chemistry.</span>
        {error && <span style={{ color: 'var(--bad)' }}>{error}</span>}
      </div>
      <div className="explore-controls" style={{ borderTop: 0 }}>
        <strong>FADEC</strong>
        <label>mode <select value={ctl.mode} onChange={(e) => setCtl({ ...ctl, mode: e.target.value as Controller['mode'], target: e.target.value === 'Fn' ? Math.round(('error' in store.design ? 1e5 : store.design.perf.Fn)) : e.target.value === 'open' ? ctl.target : 0.95 })} aria-label="Controller mode">
          <option value="open">open loop (fuel schedule)</option>{inputs.arch === 'turbofan' && <option value="N1">N1 control</option>}<option value="N2">N2 control</option><option value="Fn">thrust control</option></select></label>
        {ctl.mode !== 'open' && (
          <>
            <label>target <input className="num" type="number" aria-label="Controller target" style={{ width: 80 }} value={ctl.target} step={ctl.mode === 'Fn' ? 1000 : 0.01} onChange={(e) => setCtl({ ...ctl, target: +e.target.value })} /> {ctl.mode === 'Fn' ? 'N' : '× design'}</label>
            <label>ramp <input className="num" type="number" aria-label="Target ramp" style={{ width: 55 }} value={ctl.targetRamp_s} step={0.1} onChange={(e) => setCtl({ ...ctl, targetRamp_s: +e.target.value })} /> s</label>
            <label>Kp <input className="num" type="number" aria-label="Proportional gain" style={{ width: 55 }} value={ctl.Kp} step={0.1} onChange={(e) => setCtl({ ...ctl, Kp: +e.target.value })} /></label>
            <label>Ki <input className="num" type="number" aria-label="Integral gain" style={{ width: 55 }} value={ctl.Ki} step={0.1} onChange={(e) => setCtl({ ...ctl, Ki: +e.target.value })} /></label>
          </>
        )}
        <label>limiter <select value={ctl.limiter ?? 'schedule'} onChange={(e) => setCtl({ ...ctl, limiter: e.target.value as Controller['limiter'] })} aria-label="Limiter source">
          <option value="schedule">FADEC schedule (accel schedule + decel floor)</option><option value="manual">manual Wf/P3 limit and floor</option></select></label>
        <label style={{ opacity: manualLimiter ? 0.5 : 1 }} title={manualLimiter ? 'Ignored while the limiter is manual.' : undefined}>accel schedule Wf/P3 (× design) at Nc {ctl.accelSchedule.map((pt) => pt.Nc.toFixed(1)).join(' / ')}: {ctl.accelSchedule.map((pt, i) => <input key={i} className="num" type="number" aria-label={`Accel limit at Nc ${pt.Nc}`} style={{ width: 55, marginRight: 4 }} value={pt.ratioUnit} step={0.05} disabled={manualLimiter} onChange={(e) => setCtl({ ...ctl, accelSchedule: ctl.accelSchedule.map((q, k) => (k === i ? { ...q, ratioUnit: +e.target.value } : q)) })} />)}</label>
        <label style={{ opacity: manualLimiter ? 0.5 : 1 }} title={manualLimiter ? 'Ignored while the limiter is manual.' : undefined}>decel floor <input className="num" type="number" aria-label="Deceleration floor" style={{ width: 55 }} value={ctl.decelFloor} step={0.05} disabled={manualLimiter} onChange={(e) => setCtl({ ...ctl, decelFloor: +e.target.value })} /></label>
        <label>bleed valve open below N2 <input className="num" type="number" aria-label="Bleed valve threshold" style={{ width: 55 }} value={ctl.bleedValve.openBelowN2} step={0.01} onChange={(e) => setCtl({ ...ctl, bleedValve: { ...ctl.bleedValve, openBelowN2: +e.target.value } })} /> × design, {' '}<input className="num" type="number" aria-label="Bleed valve fraction" style={{ width: 55 }} value={ctl.bleedValve.frac} step={0.01} onChange={(e) => setCtl({ ...ctl, bleedValve: { ...ctl.bleedValve, frac: +e.target.value } })} /> of core flow</label>
        <label>VSV gain <input className="num" type="number" aria-label="VSV gain" style={{ width: 55 }} value={ctl.vsvGain} step={0.05} onChange={(e) => setCtl({ ...ctl, vsvGain: +e.target.value })} /></label>
      </div>
      <div className="explore-controls" style={{ borderTop: 0 }}>
        <label className="toggle"><input type="checkbox" checked={th.enabled} onChange={(e) => setTh({ ...th, enabled: e.target.checked })} /> heat soak &amp; tip clearance</label>
        {th.enabled && (
          <>
            <label>τ casing <input className="num" type="number" aria-label="Casing time constant" style={{ width: 55 }} value={th.tauCasing_s} step={1} onChange={(e) => setTh({ ...th, tauCasing_s: +e.target.value })} /> s</label>
            <label>τ disc <input className="num" type="number" aria-label="Disc time constant" style={{ width: 55 }} value={th.tauDisc_s} step={5} onChange={(e) => setTh({ ...th, tauDisc_s: +e.target.value })} /> s</label>
            <label>cold clearance <input className="num" type="number" aria-label="Cold clearance" style={{ width: 55 }} value={th.coldClearance_mm} step={0.1} onChange={(e) => setTh({ ...th, coldClearance_mm: +e.target.value })} /> mm</label>
            <label>blade height <input className="num" type="number" aria-label="Blade height" style={{ width: 55 }} value={th.bladeHeight_mm} step={1} onChange={(e) => setTh({ ...th, bladeHeight_mm: +e.target.value })} /> mm</label>
            <label>casing radius <input className="num" type="number" aria-label="Casing radius" style={{ width: 60 }} value={th.rCasing_mm} step={10} onChange={(e) => setTh({ ...th, rCasing_mm: +e.target.value })} /> mm</label>
            <label>centrifugal growth <input className="num" type="number" aria-label="Centrifugal growth" style={{ width: 55 }} value={th.centrifugalGrowth_mm} step={0.1} onChange={(e) => setTh({ ...th, centrifugalGrowth_mm: +e.target.value })} /> mm</label>
            <label>Δη per δ/h <input className="num" type="number" aria-label="Efficiency per clearance" style={{ width: 55 }} value={th.effPerClearance} step={0.1} onChange={(e) => setTh({ ...th, effPerClearance: +e.target.value })} /></label>
          </>
        )}
      </div>
      {samples.length > 1 && stale.stale && <StaleBanner what="transient" />}
      {result && !result.complete && <div className="err" role="alert"><strong>Trajectory incomplete.</strong> The integration stopped at {fmt(result.stoppedAt_s ?? 0, 2)} s of {runContext.duration} s before completing the manoeuvre; see the warnings for the stopping reason. Samples may include the explicitly marked starter-only regime. The end-point cards describe the last available state.</div>}
      {unconverged > 0 && <div className="err" role="alert">{unconverged} plotted sample(s) are not converged gas-path solutions.</div>}
      {result?.warnings.map((w, k) => <div className="warn" key={k}><span>⚠</span><span>{w}</span></div>)}
      {samples.length > 1 && (
        <>
          <div className="cards">
            {!result?.complete && result && <div className="card" style={{ borderColor: 'var(--bad)' }}><div className="k">Stopped at</div><div className="v" style={{ color: 'var(--bad)' }}>{fmt(result.stoppedAt_s ?? 0, 1)}<small>s of {runContext.duration} s</small></div></div>}
            {starterOnly.length > 0 && <div className="card"><div className="k">Starter-only regime</div><div className="v">{fmt(starterOnly[0].t, 1)} → {fmt(starterOnly[starterOnly.length - 1].t, 1)}<small>s, no gas-path solution</small></div></div>}
            {spools.map((k) => <div className="card" key={k}><div className="k">{k} spool</div><div className="v">{fmt(samples[0].Npct[k], 1)} → {fmt(samples[samples.length - 1].Npct[k], 1)}<small>%</small></div></div>)}
            <div className="card"><div className="k">Net thrust</div><div className="v">{fmt(samples[0].Fn / 1000, 1)} → {fmt(samples[samples.length - 1].Fn / 1000, 1)}<small>kN</small></div></div>
            {minSM.map((m) => <div className="card" key={m.c}><div className="k">Min {m.c.toUpperCase()} surge margin</div><div className="v" style={{ color: m.v < 5 ? 'var(--bad)' : m.v < 10 ? 'var(--warn)' : undefined }}>{Number.isFinite(m.v) ? fmt(m.v, 1) : '—'}<small>{Number.isFinite(m.v) ? `%${m.v < 0 ? ' (beyond stall line)' : ''}` : 'no gas-path solution'}</small></div></div>)}
            <div className="card"><div className="k">Peak T4</div><div className="v">{fmt(Math.max(...samples.map((x) => x.T4)), 0)}<small>K</small></div></div>
            {runContext.th.enabled && result?.minClearance_mm !== undefined && <div className="card" style={result.contact ? { borderColor: 'var(--bad)' } : undefined}><div className="k">Min tip clearance</div><div className="v" style={{ color: result.contact ? 'var(--bad)' : undefined }}>{fmt(result.minClearance_mm, 3)}<small>mm{result.contact ? ' — contact' : ''}</small></div></div>}
            {runContext.start.enabled && <div className="card"><div className="k">Light-off</div><div className="v">{(() => { const i = samples.findIndex((x) => x.lit); return i >= 0 ? fmt(samples[i].t, 1) + ' s' : 'none'; })()}</div></div>}
            <div className="card"><div className="k">Limiter active</div><div className="v">{fmt((100 * samples.filter((x) => x.limited).length) / samples.length, 0)}<small>% of time</small></div></div>
          </div>
          <div className="charts">
            <LineChart title="Spool speeds" series={spools.map((k, i) => s((x) => x.Npct[k], k + ' spool', i))} xLabel="time (s)" yLabel="% design" xFmt={(v) => fmt(v, 1)} yFmt={(v) => fmt(v, 0)} />
            {runContext.ctl.mode !== 'open' && samples.some(x => x.demand !== undefined) && <LineChart title={`Controller: ${runContext.ctl.mode} demand vs measured`} series={[s((x) => (runContext.ctl.mode === 'Fn' ? (x.demand ?? NaN) / 1000 : 100 * (x.demand ?? NaN)), 'demand', 1), s((x) => (runContext.ctl.mode === 'Fn' ? (x.measured ?? NaN) / 1000 : 100 * (x.measured ?? NaN)), 'measured', 0)]} xLabel="time (s)" yLabel={runContext.ctl.mode === 'Fn' ? 'kN' : '% design'} xFmt={(v) => fmt(v, 1)} yFmt={(v) => fmt(v, 1)} />}
            <LineChart title="Fuel flow" sub="command vs delivered (after limiter)" series={[s((x) => x.WfCmd, 'commanded', 1), s((x) => x.Wf, 'delivered', 0)]} xLabel="time (s)" yLabel="kg/s" xFmt={(v) => fmt(v, 1)} yFmt={(v) => fmt(v, 2)} />
            <LineChart title="Net thrust" sub="gaps omit samples without a converged gas path" series={[s((x) => x.gasPath && x.converged ? x.Fn / 1000 : NaN, 'thrust')]} xLabel="time (s)" yLabel="kN" xFmt={(v) => fmt(v, 1)} yFmt={(v) => fmt(v, 0)} />
            <LineChart title="Surge margins" series={comps.map((c, i) => s((x) => x.gasPath && x.converged ? x.SM[c] : NaN, c.toUpperCase(), i))} xLabel="time (s)" yLabel="%" xFmt={(v) => fmt(v, 1)} yFmt={(v) => fmt(v, 0)} />
            <LineChart title="Turbine inlet and exit temperature" series={[s((x) => x.gasPath && x.converged ? x.T4 : NaN, 'T4', 1), s((x) => x.gasPath && x.converged ? x.T5 : NaN, 'T5', 0)]} xLabel="time (s)" yLabel="K" xFmt={(v) => fmt(v, 1)} yFmt={(v) => fmt(v, 0)} />
            {runContext.th.enabled && samples[0]?.clearance_mm !== undefined && (
              <>
                <LineChart title="Metal temperatures" series={[s((x) => x.Tcasing ?? NaN, 'casing', 1), s((x) => x.Tdisc ?? NaN, 'disc', 0)]} xLabel="time (s)" yLabel="K" xFmt={(v) => fmt(v, 1)} yFmt={(v) => fmt(v, 0)} />
                <LineChart title="Tip clearance" sub="HP compressor" series={[s((x) => x.clearance_mm ?? NaN, 'clearance', 0)]} xLabel="time (s)" yLabel="mm" xFmt={(v) => fmt(v, 1)} yFmt={(v) => fmt(v, 2)} />
                <LineChart title="Efficiency penalty" sub="HP compressor; delta relative to the design clearance" series={[s((x) => 100 * (x.effDeltaHPC ?? 0), 'Δη/η', 1)]} xLabel="time (s)" yLabel="% of reference efficiency" xFmt={(v) => fmt(v, 1)} yFmt={(v) => fmt(v, 2)} />
              </>
            )}
            <MapTrajectory design={runContext.inputs} samples={samples} />
          </div>
        </>
      )}
    </div>
  );
}
