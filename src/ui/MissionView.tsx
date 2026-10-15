import { useState } from 'react';
import { Store } from '../state/store';
import { request } from '../engine/client';
import { MissionResult, MissionPoint, Segment, Aircraft, defaultMission, Ratings, scaledAircraftMass } from '../engine/mission';
import { isa } from '../engine/atmosphere';
import { LineChart } from '../viz/charts';
import { fmt } from './format';
import { U } from './units';

export function MissionView({ store }: { store: Store }) {
  const inputs = store.state.inputs;
  const design = 'error' in store.design ? null : store.design;
  // estimate sea-level static thrust from the design point (scale by ambient pressure and a ram/speed factor)
  const FnSLS = design ? design.perf.Fn * (101325 / isa(inputs.flight.altitude_m).P) * (inputs.flight.mach > 0.3 ? 0.75 : 1) : 1e5;
  const [ac, setAc] = useState<Aircraft>(() => { const d = defaultMission(inputs.arch); return { ...d.aircraft, mass_kg: scaledAircraftMass(inputs.arch, FnSLS, d.aircraft.engines, inputs.prop.shaftPower_W) }; });
  const [segs, setSegs] = useState<Segment[]>(() => defaultMission(inputs.arch).segments);
  const [ratings, setRatings] = useState<Ratings>({ NLPmax: 1.04, NHPmax: 1.02, T4max_K: inputs.burner.T4_K });
  const [pts, setPts] = useState<MissionPoint[]>([]);
  const [res, setRes] = useState<MissionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const u = U(store.state.units);
  const run = () => {
    setBusy(true); setError(null); setRes(null); setPts([]);
    request<MissionResult>({ type: 'mission', inputs: { ...inputs, chemistry: 'frozen' }, mi: { aircraft: ac, segments: segs, od: { ...store.state.od, throttle: { mode: 'T4', value: inputs.burner.T4_K } }, pointsPerSegment: 8, ratings } }, (p: MissionPoint[]) => setPts(p))
      .then((r) => { setRes(r); setPts(r.points); setBusy(false); })
      .catch((e) => { setError(e.message); setBusy(false); });
  };
  const setSeg = (i: number, patch: Partial<Segment>) => setSegs(segs.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const num = (v: number, on: (x: number) => void, w = 70, step = 1, label = '') => <input className="num" type="number" aria-label={label} style={{ width: w }} value={v} step={step} onChange={(e) => on(+e.target.value)} />;
  const unit = (kind: Segment['kind']) => (kind === 'cruise' ? 'km' : kind === 'climb' || kind === 'descent' ? 'm/s' : 's');
  return (
    <div>
      <div className="explore-controls">
        <strong>Aircraft</strong>
        <label>mass {num(ac.mass_kg, (v) => setAc({ ...ac, mass_kg: v }), 80, 500, 'Aircraft mass')} kg</label>
        <label>wing area {num(ac.wingArea_m2, (v) => setAc({ ...ac, wingArea_m2: v }), 60, 1, 'Wing area')} m²</label>
        <label>CD0 {num(ac.CD0, (v) => setAc({ ...ac, CD0: v }), 60, 0.001, 'Zero-lift drag coefficient')}</label>
        <label>k {num(ac.k, (v) => setAc({ ...ac, k: v }), 60, 0.001, 'Induced drag factor')}</label>
        <label>engines {num(ac.engines, (v) => setAc({ ...ac, engines: v }), 50, 1, 'Engine count')}</label>
        <label className="toggle"><input type="checkbox" checked={ac.installed} onChange={(e) => setAc({ ...ac, installed: e.target.checked })} /> installed thrust</label>
        <strong>Ratings</strong>
        <label>N1 max {num(ratings.NLPmax, (v) => setRatings({ ...ratings, NLPmax: v }), 60, 0.01, 'N1 limit')}</label>
        <label>N2 max {num(ratings.NHPmax, (v) => setRatings({ ...ratings, NHPmax: v }), 60, 0.01, 'N2 limit')}</label>
        <label>T4 max {num(ratings.T4max_K, (v) => setRatings({ ...ratings, T4max_K: v }), 70, 10, 'T4 limit')} K</label>
        <button className="btn primary" onClick={run} disabled={busy}>{busy ? 'Flying…' : 'Fly mission'}</button>
        <button className="btn" onClick={() => { const d = defaultMission(inputs.arch); setAc({ ...d.aircraft, mass_kg: scaledAircraftMass(inputs.arch, FnSLS, d.aircraft.engines, inputs.prop.shaftPower_W) }); setSegs(d.segments); }}>Reset profile</button>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Aircraft mass defaults to a thrust/weight ratio of 0.28 at sea level for this engine.</span>
        {error && <span style={{ color: 'var(--bad)' }}>{error}</span>}
      </div>
      <div className="section" style={{ padding: '8px 14px' }}>
        <div style={{ overflowX: 'auto' }}>
        <table className="stations">
          <thead><tr><th>Segment</th><th>Kind</th><th>Alt start (m)</th><th>Alt end (m)</th><th>Mach</th><th>Value</th><th>T4 fraction</th><th></th></tr></thead>
          <tbody>
            {segs.map((s, i) => (
              <tr key={i}>
                <td><input aria-label="Segment label" className="num" style={{ width: 90 }} value={s.label} onChange={(e) => setSeg(i, { label: e.target.value })} /></td>
                <td><select aria-label="Segment kind" className="select" style={{ width: 'auto' }} value={s.kind} onChange={(e) => setSeg(i, { kind: e.target.value as Segment['kind'] })}>{['takeoff', 'climb', 'cruise', 'descent', 'hold'].map((k) => <option key={k} value={k}>{k}</option>)}</select></td>
                <td>{num(s.alt0_m, (v) => setSeg(i, { alt0_m: v }), 70, 100, 'Start altitude')}</td>
                <td>{num(s.alt1_m, (v) => setSeg(i, { alt1_m: v }), 70, 100, 'End altitude')}</td>
                <td>{num(s.mach, (v) => setSeg(i, { mach: v }), 60, 0.01, 'Mach')}</td>
                <td>{num(s.value, (v) => setSeg(i, { value: v }), 70, 1, 'Segment value')} {unit(s.kind)}</td>
                <td>{num(s.T4frac ?? 0, (v) => setSeg(i, { T4frac: v > 0 ? v : undefined }), 60, 0.05, 'T4 fraction')} <span style={{ color: 'var(--text-muted)' }}>(0 = match thrust)</span></td>
                <td><button className="btn" onClick={() => setSegs(segs.filter((_, k) => k !== i))} aria-label="Remove segment">×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <button className="btn" style={{ marginTop: 8 }} onClick={() => setSegs([...segs, { kind: 'cruise', label: `Segment ${segs.length + 1}`, alt0_m: 10000, alt1_m: 10000, mach: 0.78, value: 500 }])}>Add segment</button>
      </div>
      {res?.warnings.slice(0, 8).map((w, k) => <div className="warn" key={k}><span>⚠</span><span>{w}</span></div>)}
      {res && res.warnings.length > 8 && <div className="warn"><span>⚠</span><span>{res.warnings.length - 8} more warnings.</span></div>}
      {res && (
        <div className="cards">
          <div className="card hero" style={{ borderColor: res.feasible ? 'var(--good)' : 'var(--bad)' }}><div className="k">Mission {res.feasible ? 'feasible' : 'infeasible'}</div><div className="v" style={{ fontSize: 16 }}>{res.feasible ? 'All points converged and the required thrust was delivered.' : `Thrust shortfall up to ${fmt(100 * res.maxShortfall, 0)} %${res.unconvergedPoints ? `, ${res.unconvergedPoints} unconverged point(s)` : ''}. The totals below are for the flown profile, not a completed mission.`}</div></div>
          <div className="card hero"><div className="k">Block fuel</div><div className="v">{fmt(res.totals.fuel_kg, 0)}<small>kg · {fmt(res.totals.blockFuelFrac * 100, 1)} % of take-off mass</small></div></div>
          <div className="card"><div className="k">Block time</div><div className="v">{fmt(res.totals.time_s / 60, 0)}<small>min</small></div></div>
          <div className="card"><div className="k">Distance</div><div className="v">{fmt(res.totals.dist_km, 0)}<small>km</small></div></div>
          <div className="card"><div className="k">Fuel per km</div><div className="v">{fmt(res.totals.fuel_kg / Math.max(res.totals.dist_km, 1), 2)}<small>kg/km</small></div></div>
          {res.segments.map((s) => <div className="card" key={s.label}><div className="k">{s.label}</div><div className="v">{fmt(s.fuel_kg, 0)}<small>kg · {fmt(s.time_s / 60, 0)} min</small></div></div>)}
        </div>
      )}
      {pts.length > 1 && (
        <div className="charts">
          <LineChart title="Altitude profile" series={[{ name: 'altitude', color: 'var(--series-1)', points: pts.map((p) => ({ x: p.t_s / 60, y: p.alt_m })) }]} xLabel="time (min)" yLabel="m" xFmt={(v) => fmt(v, 0)} yFmt={(v) => fmt(v, 0)} />
          <LineChart title="Thrust per engine" sub="required vs delivered" series={[{ name: 'required', color: 'var(--series-2)', points: pts.map((p) => ({ x: p.t_s / 60, y: p.FnReq / 1000 })) }, { name: 'delivered', color: 'var(--series-1)', points: pts.map((p) => ({ x: p.t_s / 60, y: p.Fn / 1000 })) }]} xLabel="time (min)" yLabel="kN" xFmt={(v) => fmt(v, 0)} yFmt={(v) => fmt(v, 0)} />
          <LineChart title="Fuel flow (all engines)" series={[{ name: 'fuel flow', color: 'var(--series-1)', points: pts.map((p) => ({ x: p.t_s / 60, y: p.Wf })) }]} xLabel="time (min)" yLabel="kg/s" xFmt={(v) => fmt(v, 0)} yFmt={(v) => fmt(v, 2)} />
          <LineChart title="Aircraft mass" series={[{ name: 'mass', color: 'var(--series-1)', points: pts.map((p) => ({ x: p.t_s / 60, y: p.mass_kg / 1000 })) }]} xLabel="time (min)" yLabel="t" xFmt={(v) => fmt(v, 0)} yFmt={(v) => fmt(v, 1)} />
          <LineChart title="Spool speeds" series={[{ name: 'N2 (HP)', color: 'var(--series-1)', points: pts.map((p) => ({ x: p.t_s / 60, y: p.NHPpct })) }, ...(inputs.arch === 'turbofan' ? [{ name: 'N1 (LP)', color: 'var(--series-2)', points: pts.map((p) => ({ x: p.t_s / 60, y: p.NLPpct })) }] : [])]} xLabel="time (min)" yLabel="% design" xFmt={(v) => fmt(v, 0)} yFmt={(v) => fmt(v, 0)} />
          <LineChart title="TSFC" series={[{ name: 'TSFC', color: 'var(--series-1)', points: pts.map((p) => ({ x: p.t_s / 60, y: p.TSFC })) }]} xLabel="time (min)" yLabel="mg/(N·s)" xFmt={(v) => fmt(v, 0)} yFmt={(v) => fmt(v, 1)} />
        </div>
      )}
      {pts.length > 1 && (
        <div className="section" style={{ padding: 0 }}>
          <h3 style={{ padding: '12px 14px 0' }}>Mission points</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="stations">
              <thead><tr><th>Segment</th><th>t (min)</th><th>dist (km)</th><th>alt ({u.altitude(0).u})</th><th>M</th><th>mass (t)</th><th>Fn req (kN)</th><th>Fn (kN)</th><th>Wf (kg/s)</th><th>T4 (K)</th><th>N2 %</th><th>limit</th></tr></thead>
              <tbody>{pts.map((p, k) => <tr key={k} style={{ color: p.converged ? undefined : 'var(--bad)' }}><td>{p.segment}</td><td className="num">{fmt(p.t_s / 60, 1)}</td><td className="num">{fmt(p.dist_km, 0)}</td><td className="num">{u.altitude(p.alt_m).v}</td><td className="num">{fmt(p.mach, 2)}</td><td className="num">{fmt(p.mass_kg / 1000, 1)}</td><td className="num">{fmt(p.FnReq / 1000, 1)}</td><td className="num">{fmt(p.Fn / 1000, 1)}</td><td className="num">{fmt(p.Wf, 3)}</td><td className="num">{fmt(p.T4, 0)}</td><td className="num">{fmt(p.NHPpct, 1)}</td><td>{p.limited ?? ''}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
