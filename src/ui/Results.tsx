import { EngineResult } from '../engine/types';
import { Store } from '../state/store';
import { fmt, kW, pct } from './format';
import { U } from './units';
import { t } from './i18n';
import { Diagrams } from '../viz/Diagrams';
import { MapCharts } from '../viz/MapChart';
import { exportStationsCsv } from './csv';
import { estimateWeight } from '../engine/weight';
import { estimateNoise, LtoResult } from '../engine/certification';
import { useAnalysisJob, AnalysisProgress } from './useAnalysisJob';
import { useState } from 'react';
import { Provenance } from './Provenance';
import { useStale, StaleBanner } from './useStale';

export function Results({ store, result }: { store: Store; result: EngineResult }) {
  const p = result.perf;
  const arch = result.inputs.arch;
  const sel = store.state.selected;
  const u = U(store.state.units);
  const C = (x: { v: string; u: string }) => <>{x.v}<small>{x.u}</small></>;
  const st0 = result.stations[0];
  return (
    <div>
      <div className="statusbar">
        <span>{result.offDesign ? 'Off-design' : 'Design point'}</span>
        <span>{fmt(result.inputs.flight.altitude_m, 0)} m · M {fmt(st0.MN, 2)} · {result.inputs.fuel ?? 'jetA'} · {result.inputs.chemistry ?? 'equilibrium'} chemistry</span>
        {result.offDesign && <span style={{ color: result.offDesign.converged ? 'var(--good)' : 'var(--bad)' }}>{result.offDesign.converged ? 'converged' : 'not converged'}</span>}
        <Provenance level="reference" />
      </div>
      {result.offDesign && (
        <div className="section" style={{ paddingBottom: 8 }}>
          <h3>Off-design operating point</h3>
          <div className="kv">
            <span className="k">Throttle</span><span className="v">{result.offDesign.throttle}</span>
            <span className="k">Solver</span><span className="v">{result.offDesign.converged ? 'converged' : 'not converged'} · {result.offDesign.iterations} iterations · residual {result.offDesign.residualNorm.toExponential(1)}</span>
            {Object.entries(result.offDesign.x).map(([k, v]) => <ValueRow key={k} k={k} v={v} units={store.state.units} />)}
          </div>
        </div>
      )}
      {result.warnings.map((w, k) => <div className="warn" key={k}><span>⚠</span><span>{w}</span></div>)}
      <div className="cards">
        {arch === 'turboprop' ? (
          <>
            <div className="card hero"><div className="k">{t('Shaft power delivered')}</div><div className="v">{C(u.power(p.shaftPower_W))}</div></div>
            <div className="card"><div className="k">{t('Propeller thrust')}</div><div className="v">{C(u.thrust(p.propThrust))}</div></div>
            <div className="card"><div className="k">{t('Net jet thrust')}</div><div className="v">{C(u.thrust(p.jetThrust))}</div></div>
            <div className="card"><div className="k">{t('Total net thrust')}</div><div className="v">{C(u.thrust(p.Fn))}</div></div>
            <div className="card"><div className="k">{t('PSFC')}</div><div className="v">{C(u.psfc(p.PSFC_kg_kWh))}</div></div>
            <div className="card"><div className="k">{t('Equivalent power')}</div><div className="v">{C(u.power(p.ESHP_W))}</div></div>
            <div className="card"><div className="k">{t('Fuel flow')}</div><div className="v">{C(u.fuelflow(p.Wfuel))}</div></div>
          </>
        ) : (
          <>
            <div className="card hero"><div className="k">{t('Net thrust')}</div><div className="v">{C(u.thrust(p.Fn))}</div></div>
            <div className="card"><div className="k">{t('TSFC')}</div><div className="v">{C(u.tsfc(p.TSFC_kg_Nh))}</div></div>
            <div className="card"><div className="k">{t('TSFC')}</div><div className="v">{u.imp ? <>{fmt(p.TSFC_mg_Ns, 2)}<small>mg/(N·s)</small></> : <>{fmt(p.TSFC_kg_Nh, 4)}<small>kg/(N·h)</small></>}</div></div>
            <div className="card"><div className="k">{t('Specific thrust')}</div><div className="v">{C(u.specificThrust(p.specificThrust))}</div></div>
            <div className="card"><div className="k">{t('Gross thrust')}</div><div className="v">{C(u.thrust(p.Fg))}</div></div>
            <div className="card"><div className="k">{t('Ram drag')}</div><div className="v">{C(u.thrust(p.ramDrag))}</div></div>
            {arch === 'turbofan' && !result.inputs.mixed && <div className="card"><div className="k">{t('Bypass share of gross thrust')}</div><div className="v">{pct(p.Fg_byp / p.Fg, 0)}</div></div>}
            <div className="card"><div className="k">{t('Fuel flow')}</div><div className="v">{C(u.fuelflow(p.Wfuel))}</div></div>
          </>
        )}
        {result.inputs.installation.enabled && arch !== 'turboprop' && (
          <>
            <div className="card"><div className="k">{t('Installed net thrust')}</div><div className="v">{C(u.thrust(p.installedFn))}</div></div>
            <div className="card"><div className="k">{t('Installation drag')}</div><div className="v">{C(u.thrust(p.inletDrag + p.nacelleDrag + p.afterbodyDrag))}<small style={{ display: 'block', marginLeft: 0 }}>inlet {u.thrust(p.inletDrag).v} · nacelle {u.thrust(p.nacelleDrag).v} · afterbody {u.thrust(p.afterbodyDrag).v}</small></div></div>
          </>
        )}
        <div className="card"><div className="k">{t('Overall pressure ratio')}</div><div className="v">{fmt(p.OPR, 1)}</div></div>
        <div className="card"><div className="k">{t('Fuel/air ratio')}</div><div className="v">{fmt(p.FAR, 4)}</div></div>
        <div className="card"><div className="k">{t('Thermal efficiency')}</div><div className="v">{pct(p.thermalEff)}</div></div>
        <div className="card"><div className="k">{t('Propulsive efficiency')}</div><div className="v">{p.V0 > 0 ? pct(p.propulsiveEff) : '–'}</div></div>
        <div className="card"><div className="k">{t('Overall efficiency')}</div><div className="v">{p.V0 > 0 ? pct(p.overallEff) : '–'}</div></div>
      </div>

      {!result.offDesign && (() => { try { const w = estimateWeight(result); return (
        <div className="section">
          <h3>Weight & size <span className="hint"><Provenance level="estimate" /></span></h3>
          <div className="kv">
            <span className="k">Assembly mass</span><span className="v">{fmt(w.total_kg, 0)} kg</span>
            <span className="k">{arch === 'turboprop' ? 'Power / weight' : 'Thrust / weight'}</span><span className="v">{arch === 'turboprop' ? fmt(w.powerToWeight_kW_kg, 2) + ' kW/kg' : fmt(w.thrustToWeight, 1)}</span>
            <span className="k">Length · max diameter</span><span className="v">{u.length(w.length_m).v} · {u.length(w.diameter_m).v} {u.length(1).u}</span>
            {w.parts.map((p) => <span key={p.name} style={{ display: 'contents' }}><span className="k" style={{ paddingLeft: 12, color: 'var(--text-muted)' }}>{p.name}</span><span className="v" style={{ color: 'var(--text-secondary)' }}>{fmt(p.mass_kg, 0)} kg</span></span>)}
          </div>
        </div>
      ); } catch { return null; } })()}

      {(() => { const sas = result.components.find((c) => c.id === 'sas'); if (!sas) return null; const v = sas.values; const W25 = result.stations.find((s) => s.id === '25')?.W ?? 1; return (
        <div className="section">
          <h3>Secondary air system <span className="hint"><Provenance level="model" /> orifice network at gas-path pressures</span></h3>
          {v.sealReversed ? <div className="warn"><span>⚠</span><span>Interstage seal reversed: hot gas ingestion into the turbine cavity.</span></div> : null}
          <div className="kv">
            <span className="k">HPT inlet cooling (does work)</span><span className="v">{fmt(v.coolInlet_kgs, 3)} kg/s · {fmt((100 * v.coolInlet_kgs) / W25, 2)} % W25</span>
            <span className="k">HPT exit cooling</span><span className="v">{fmt(v.coolExit_kgs, 3)} kg/s · {fmt((100 * v.coolExit_kgs) / W25, 2)} %</span>
            <span className="k">Customer bleed (fixed manifold)</span><span className="v">{fmt(v.customer_kgs, 3)} kg/s</span>
            <span className="k">Overboard leakage</span><span className="v">{fmt(v.leak_kgs, 3)} kg/s</span>
            <span className="k">Interstage seal flow</span><span className="v" style={{ color: v.sealReversed ? 'var(--bad)' : undefined }}>{fmt(v.interstageSeal_kgs, 3)} kg/s · feed {u.pressure(v.Pseal_feed_Pa).v} vs cavity {u.pressure(v.Pcavity_Pa).v} {u.pressure(1).u}</span>
            <span className="k">P3 · P4 · P45</span><span className="v">{u.pressure(v.P3_Pa).v} · {u.pressure(v.P4_Pa).v} · {u.pressure(v.P45_Pa).v} {u.pressure(1).u}</span>
          </div>
        </div>
      ); })()}
      <Certification store={store} result={result} />

      <div className="section">
        <h3>Emissions & noise <span className="hint"><Provenance level="estimate" /> P3–T3 correlations, Lighthill jet noise</span></h3>
        <div className="kv">
          <span className="k">NOx emission index</span><span className="v">{fmt(p.EI_NOx_g_kg, 1)} g/kg fuel · {fmt(p.NOx_g_s, 2)} g/s</span>
          <span className="k">CO emission index</span><span className="v">{fmt(p.EI_CO_g_kg, 1)} g/kg fuel · {fmt(p.CO_g_s, 2)} g/s</span>
          <span className="k">CO₂</span><span className="v">{fmt(p.CO2_g_s / 1000, 2)} kg/s · {fmt(p.CO2_g_s * 3.6, 0)} kg/h</span>
          <span className="k">Jet mixing noise, OASPL at 1 m</span><span className="v">{fmt(p.jetNoise_dB, 0)} dB · at 100 m {fmt(p.jetNoise_dB - 40, 0)} dB</span>
        </div>
      </div>

      <div className="section">
        <h3>{t('Shaft power balance')} <span className="hint"><Provenance level="reference" /></span></h3>
        {result.shafts.map((s) => {
          const max = Math.max(s.powerIn_W, s.powerOut_W, 1);
          return (
            <div className="shaft" key={s.name}>
              <div className="kv"><span className="k">{s.name}</span><span className="v">turbine PR {fmt(s.turbinePR, 3)} · {fmt(s.rpm, 0)} rpm{s.outputRpm ? ` → ${fmt(s.outputRpm, 0)} rpm` : ''}</span></div>
              <div className="kv"><span className="k">Turbine supplies</span><span className="v">{kW(s.powerIn_W)}</span></div>
              <div className="bar"><i style={{ width: `${(100 * s.powerIn_W) / max}%` }} /></div>
              <div className="kv"><span className="k">Compressors + extraction absorb</span><span className="v">{kW(s.powerOut_W)}</span></div>
              <div className="bar"><i className="b" style={{ width: `${(100 * s.powerOut_W) / max}%` }} /></div>
            </div>
          );
        })}
      </div>

      <Diagrams result={result} />
      <MapCharts design={store.state.inputs} result={result} />

      <div className="section" style={{ padding: 0 }}>
        <h3 style={{ padding: '12px 14px 0' }}>{t('Stations')}<span className="hint"><button className="btn" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => exportStationsCsv(result)}>Export CSV</button></span></h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="stations">
            <thead><tr><th>St.</th><th>Pt {u.pressure(1).u}</th><th>Tt {u.temperature(1).u}</th><th>W {u.massflow(1).u}</th><th>Ps {u.pressure(1).u}</th><th>M</th><th>V {u.velocity(1).u}</th><th>A {u.area(1).u}</th></tr></thead>
            <tbody>
              {result.stations.map((s) => (
                <tr key={s.id} className={sel === 'st' + s.id ? 'sel' : ''} tabIndex={0} role="button" aria-pressed={sel === 'st' + s.id} onClick={() => store.dispatch({ type: 'select', id: sel === 'st' + s.id ? null : 'st' + s.id })} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); store.dispatch({ type: 'select', id: sel === 'st' + s.id ? null : 'st' + s.id }); } }} title={s.name}>
                  <td><span style={{ color: 'var(--text-muted)' }}>{s.id}</span> {s.name}</td>
                  <td className="num">{u.pressure(s.Pt).v}</td><td className="num">{u.temperature(s.Tt).v}</td><td className="num">{u.massflow(s.W).v}</td>
                  <td className="num">{u.pressure(s.Ps).v}</td><td className="num">{fmt(s.MN, 2)}</td><td className="num">{u.velocity(s.V).v}</td><td className="num">{Number.isFinite(s.A) ? u.area(s.A).v : '∞'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <h3>{t('Components')}</h3>
        {result.components.map((c) => (
          <details key={c.id} open={sel === c.id} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) store.dispatch({ type: 'select', id: c.id }); }}>
            <summary style={{ cursor: 'pointer', padding: '4px 0', color: sel === c.id ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{c.name}</summary>
            <div className="kv" style={{ padding: '2px 0 8px 12px' }}>
              {Object.entries(c.values).map(([k, v]) => <ValueRow key={k} k={k} v={v} units={store.state.units} />)}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function ValueRow({ k, v, units = 'SI' }: { k: string; v: number; units?: 'SI' | 'imperial' }) {
  const u = U(units);
  const j = (x: { v: string; u: string }) => `${x.v} ${x.u}`;
  let label = k, text = fmt(v, 3);
  if (k.endsWith('_W')) { label = k.slice(0, -2); text = j(u.power(v)); }
  else if (k.endsWith('_N')) { label = k.slice(0, -2); text = j(u.thrust(v)); }
  else if (k.endsWith('_kgs')) { label = k.slice(0, -4); text = j(u.massflow(v, 3)); }
  else if (k.endsWith('_m2')) { label = k.slice(0, -3); text = j(u.area(v)); }
  else if (k.endsWith('_ms')) { label = k.slice(0, -3); text = j(u.velocity(v)); }
  else if (k.endsWith('_m')) { label = k.slice(0, -2); text = j(u.length(v)); }
  else if (k.endsWith('_W_m2')) { label = k.slice(0, -5); text = fmt(v / 1000, 1) + ' kW/m²'; }
  else if (k === 'choked') text = v ? 'yes' : 'no';
  else if (k === 'offMap') { label = 'beyond map range'; text = v ? 'yes' : 'no'; }
  else if (k === 'subAmbient') { label = 'Pt below ambient'; text = v ? 'yes' : 'no'; }
  else if (k.endsWith('_pct')) { label = k.slice(0, -4); text = fmt(v, 1) + ' %'; }
  else if (k === 'rpm' || k.endsWith('_rpm') || k.startsWith('N_')) text = fmt(v, 0) + ' rpm';
  else if (k.endsWith('_Pa')) { label = k.slice(0, -3); text = j(u.pressure(v)); }
  else if (k.startsWith('Tt') || k.startsWith('T4') || k.startsWith('T7')) text = j(u.temperature(v));
  else if (k.startsWith('V')) text = j(u.velocity(v));
  else if (k === 'W') text = j(u.massflow(v, 1));
  label = label.replace(/_/g, ' ');
  return <><span className="k">{label}</span><span className="v">{text}</span></>;
}

function Certification({ store, result }: { store: Store; result: EngineResult }) {
  const [lto, setLto] = useState<LtoResult | null>(null);
  const job = useAnalysisJob();
  const busy = job.busy;
  const [err, setErr] = useState<string | null>(null);
  const stale = useStale(store.state.inputs);
  const noise = (() => { try { return estimateNoise(result); } catch { return null; } })();
  const run = () => { setErr(null); setLto(null); stale.snapshot(); job.run<LtoResult>({ type: 'lto', inputs: { ...store.state.inputs, chemistry: 'frozen' } }, undefined, setLto, setErr); };
  if (result.inputs.arch === 'turboprop') return null;
  return (
    <div className="section">
      <h3>Certification estimates <span className="hint"><Provenance level="estimate" /> ICAO LTO cycle · CAEP/8 NOx · heuristic source noise</span></h3>
      {lto && stale.stale && <StaleBanner what="LTO cycle" />}
      {noise && (
        <div className="kv" style={{ marginBottom: 8 }}>
          <span className="k">{result.inputs.arch === 'turbofan' ? 'Fan' : 'Compressor'} inlet broadband · tone</span><span className="v">{fmt(noise.fanInlet_dB, 0)} · {fmt(noise.fanTone_dB, 0)} dB at 1 m (tip Mach {fmt(noise.tipMach, 2)})</span>
          <span className="k">Jet mixing</span><span className="v">{fmt(noise.jet_dB, 0)} dB</span>
          <span className="k">Total OASPL at 1 m · 100 m</span><span className="v">{fmt(noise.total_dB, 0)} · {fmt(noise.total_dB - 40, 0)} dB</span>
          {noise.notes.map((n, k) => <span key={k} style={{ gridColumn: '1 / -1', color: 'var(--text-muted)', fontSize: 12 }}>{n}</span>)}
        </div>
      )}
      <div className="row"><button className="btn" onClick={run} disabled={busy}>{busy ? 'Running LTO cycle…' : 'Run ICAO LTO emissions cycle'}</button>{busy && <AnalysisProgress cancel={job.cancel} />}{err && <span className="analysis-error" role="alert">{err}</span>}</div>
      {lto && (
        <div>
          {!lto.applicable && <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>Not applicable: this configuration is outside the supported scope of these Annex 16 limits. No compliance margin is reported.</div>}
          {!lto.complete && <div className="err" role="alert">Incomplete LTO cycle: totals and compliance margins are unavailable.</div>}
          {lto.warnings.map((w, k) => <div className="warn" key={k}><span>⚠</span><span>{w}</span></div>)}
          <div className="kv" style={{ marginTop: 8 }}>
            <span className="k">Rated thrust Foo · OPR</span><span className="v">{fmt(lto.Foo_kN, 1)} kN · {fmt(lto.OPR, 1)}</span>
            <span className="k">NOx Dp/Foo</span><span className="v" style={{ color: lto.margins.NOx < 0 ? 'var(--bad)' : undefined }}>{fmt(lto.DpFoo.NOx, 1)} g/kN · limit {fmt(lto.limits.NOx, 1)} · margin {fmt(lto.margins.NOx, 0)} %</span>
            <span className="k">CO Dp/Foo</span><span className="v" style={{ color: lto.margins.CO < 0 ? 'var(--bad)' : undefined }}>{fmt(lto.DpFoo.CO, 1)} g/kN · limit 118 · margin {fmt(lto.margins.CO, 0)} %</span>
            <span className="k">HC Dp/Foo</span><span className="v" style={{ color: lto.margins.HC < 0 ? 'var(--bad)' : undefined }}>{fmt(lto.DpFoo.HC, 2)} g/kN · limit 19.6 · margin {fmt(lto.margins.HC, 0)} %</span>
            <span className="k">LTO fuel</span><span className="v">{fmt(lto.fuel_kg, 0)} kg</span>
          </div>
          <table className="stations" style={{ marginTop: 8 }}>
            <thead><tr><th>Mode</th><th>Thrust</th><th>Time</th><th>Fn kN</th><th>Wf kg/s</th><th>EI NOx</th><th>EI CO</th><th>EI HC</th><th>T3 K</th></tr></thead>
            <tbody>{lto.modes.map((m) => <tr key={m.name} style={{ color: m.converged ? undefined : 'var(--bad)' }}><td>{m.name}</td><td className="num">{fmt(m.thrustFrac * 100, 0)} %</td><td className="num">{fmt(m.time_s / 60, 1)} min</td><td className="num">{fmt(m.Fn / 1000, 1)}</td><td className="num">{fmt(m.Wf, 3)}</td><td className="num">{fmt(m.EI_NOx, 1)}</td><td className="num">{fmt(m.EI_CO, 1)}</td><td className="num">{fmt(m.EI_HC, 2)}</td><td className="num">{fmt(m.T3, 0)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
