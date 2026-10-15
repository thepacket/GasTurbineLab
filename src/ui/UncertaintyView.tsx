import { useState } from 'react';
import { Store } from '../state/store';
import { useStale, StaleBanner } from './useStale';
import { Provenance } from './Provenance';
import { useAnalysisJob, AnalysisProgress } from './useAnalysisJob';
import { UNCERTAIN, MonteCarloResult } from '../engine/montecarlo';
import { extent, niceAxis, axisLabels } from '../viz/plotData';
import { fmt } from './format';

export function Histogram({ title, values, stats, scale = 1, unit, digits = 1 }: { title: string; values: number[]; stats: MonteCarloResult['stats'][string]; scale?: number; unit: string; digits?: number }) {
  values = values.filter(Number.isFinite);
  if (!values.length) return <div className="chart"><h4>{title}</h4><div className="sub">No valid data to plot.</div></div>;
  const W = 420, H = 200, m = { l: 40, r: 12, t: 10, b: 30 };
  const axis = niceAxis(...extent(values));
  const lo = axis.lo, hi = axis.hi;
  const labels = axisLabels([lo, (lo + hi) / 2, hi], v => fmt(v, digits));
  const nb = 24; const bins = new Array(nb).fill(0);
  for (const v of values) bins[Math.min(nb - 1, Math.floor(((v - lo) / (hi - lo)) * nb))]++;
  const mx = Math.max(...bins);
  const sx = (i: number) => m.l + (i / nb) * (W - m.l - m.r), bw = (W - m.l - m.r) / nb;
  const sy = (c: number) => H - m.b - (c / mx) * (H - m.t - m.b);
  return (
    <div className="chart">
      <h4>{title}</h4>
      <div className="sub">p5 {fmt(stats.p5 * scale, digits)} · median {fmt(stats.p50 * scale, digits)} · p95 {fmt(stats.p95 * scale, digits)} {unit}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        <text x={m.l} y={9}>count</text>
        <text x={m.l - 4} y={sy(mx) + 4} textAnchor="end">{mx}</text>
        <g className="axis"><line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} /></g>
        {bins.map((c, i) => <rect key={i} x={sx(i) + 1} y={sy(c)} width={bw - 2} height={H - m.b - sy(c)} rx={2} fill="var(--series-1)" />)}
        {[0, 0.5, 1].map((f, i) => <text key={f} x={m.l + f * (W - m.l - m.r)} y={H - m.b + 13} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>{labels[i]}</text>)}
        <text x={(m.l + W - m.r) / 2} y={H - 2} textAnchor="middle">{unit}</text>
      </svg>
    </div>
  );
}

export function UncertaintyView({ store }: { store: Store }) {
  const inputs = store.state.inputs;
  const avail = UNCERTAIN.filter((u) => { const parts = u.path.split('.'); let v: any = inputs; for (const p of parts) v = v?.[p]; if (typeof v !== 'number') return false; if (inputs.arch !== 'turbofan' && ['fan.eff', 'lpc.eff', 'hpc.eff', 'lpt.eff', 'bypNozzle.Cv'].includes(u.path)) return false; if (inputs.arch === 'turbofan' && u.path === 'comp.eff') return false; if (inputs.arch === 'turboprop' && u.path === 'lpt.eff') return true; return true; });
  const [sigmas, setSigmas] = useState<Record<string, number>>(() => Object.fromEntries(avail.map((u) => [u.path, u.sigma])));
  const [on, setOn] = useState<string[]>(() => avail.map((u) => u.path));
  const [samples, setSamples] = useState(400);
  const [res, setRes] = useState<MonteCarloResult | null>(null);
  const job = useAnalysisJob();
  const busy = job.busy;
  const [completed, setCompleted] = useState(0);
  const [runSamples, setRunSamples] = useState(samples);
  const stale = useStale({ inputs, on, sigmas, samples });
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    setCompleted(0); setRunSamples(samples); setError(null); setRes(null); stale.snapshot();
    job.run<MonteCarloResult>({ type: 'montecarlo', inputs, mc: { inputs: avail.filter((u) => on.includes(u.path)).map((u) => ({ ...u, sigma: sigmas[u.path] ?? u.sigma })), samples, seed: 12345 } }, (k: number) => setCompleted(k), r => setRes(r), setError);
  };
  return (
    <div aria-busy={busy}>
      <div className="prose">
        <h2>Uncertainty <Provenance level="model" style={{ marginLeft: 8 }} /></h2>
        <p>Monte Carlo propagation: each selected input is perturbed with an independent normal deviation of the given standard deviation, truncated to its physical bounds (draws outside the bounds are redrawn and counted), the design point is re-solved (frozen chemistry) and the distributions of thrust, TSFC, fuel flow, T3 and thermal efficiency are collected. Samples whose solve fails or returns non-finite values are excluded and counted separately. One-at-a-time +1σ sensitivities are listed below the histograms.</p>
      </div>
      <div className="section">
        <h3>Uncertain inputs (1σ)</h3>
        {avail.map((u) => (
          <div className="control" key={u.path} style={{ gridTemplateColumns: 'auto 1fr auto' }}>
            <label className="toggle"><input type="checkbox" checked={on.includes(u.path)} onChange={(e) => setOn(e.target.checked ? [...on, u.path] : on.filter((x) => x !== u.path))} /> {u.label}</label>
            <span />
            <span className="val">σ <input className="num" type="number" aria-label={`${u.label} sigma`} style={{ width: 70 }} step={0.001} value={sigmas[u.path] ?? u.sigma} onChange={(e) => setSigmas({ ...sigmas, [u.path]: +e.target.value })} /> <span className="unit">[{u.min ?? '−∞'}, {u.max ?? '∞'}]</span></span>
          </div>
        ))}
      </div>
      <div className="explore-controls">
        <label>samples <input className="num" type="number" aria-label="Samples" style={{ width: 70 }} value={samples} step={100} onChange={(e) => setSamples(+e.target.value)} /></label>
        <button className="btn primary sampling-run" onClick={run} disabled={busy}>{busy ? `Sampling… ${completed}/${runSamples}` : 'Run Monte Carlo'}</button>
        {busy && <AnalysisProgress value={completed} max={runSamples} cancel={() => { job.cancel(); setRes(null); }} />}
        {error && <span className="analysis-error" role="alert">{error}</span>}
      </div>
      {res && stale.stale && <StaleBanner what="Monte Carlo run" />}
      {res && (
        <>
          <div className="cards">
            {(['Fn', 'TSFC', 'Wf', 'T3', 'eth'] as const).map((k) => { const s = res.stats[k]; const scale = k === 'Fn' ? 1e-3 : 1; const unit = { Fn: 'kN', TSFC: 'mg/(N·s)', Wf: 'kg/s', T3: 'K', eth: '%' }[k]; return <div className="card" key={k}><div className="k">{{ Fn: 'Net thrust', TSFC: 'TSFC', Wf: 'Fuel flow', T3: 'T3', eth: 'Thermal efficiency' }[k]}</div><div className="v">{fmt(s.mean * scale, 2)} ± {fmt(s.sd * scale, 2)}<small>{unit} (1σ · {fmt((100 * s.sd) / s.mean, 2)} %)</small></div></div>; })}
            <div className="card"><div className="k">Failed samples</div><div className="v">{res.failures}<small>solver failures or non-finite results, excluded</small></div></div>
            <div className="card"><div className="k">Redrawn draws</div><div className="v">{res.truncated}<small>outside physical bounds (η, recovery, Cv ≤ 1; losses ≥ 0)</small></div></div>
          </div>
          <div className="charts">
            <Histogram title="Net thrust" values={res.Fn.map((v) => v / 1000)} stats={res.stats.Fn} scale={0.001} unit="kN" />
            <Histogram title="TSFC" values={res.TSFC} stats={res.stats.TSFC} unit="mg/(N·s)" digits={2} />
            <Histogram title="Fuel flow" values={res.Wf} stats={res.stats.Wf} unit="kg/s" digits={3} />
            <Histogram title="Compressor exit temperature" values={res.T3} stats={res.stats.T3} unit="K" digits={0} />
          </div>
          <div className="section">
            <h3>One-at-a-time sensitivities <span className="hint">+1σ, clipped to the physical bound where it would exceed it</span></h3>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Sensitivities"><table className="stations"><thead><tr><th>Input</th><th>Perturbation applied</th><th>Δ thrust</th><th>Δ TSFC</th></tr></thead>
              <tbody>{res.sensitivity.map((s) => <tr key={s.label}><td>{s.label}</td><td className="num">{s.delta >= 0 ? '+' : ''}{fmt(s.delta, 4)}{s.bounded ? ' (bounded)' : ''}</td><td className="num">{fmt(s.dFn_pct, 2)} %</td><td className="num">{fmt(s.dTSFC_pct, 2)} %</td></tr>)}</tbody></table></div>
          </div>
        </>
      )}
    </div>
  );
}
