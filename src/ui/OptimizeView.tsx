import { PlotGroup } from '../viz/PlotGroup';
import { useState } from 'react';
import { Store } from '../state/store';
import { useStale, StaleBanner } from './useStale';
import { Provenance } from './Provenance';
import { useAnalysisJob, AnalysisProgress } from './useAnalysisJob';
import { VARIABLES, OptimizeResult, OptimizeTrace, Objective, Constraint, getPath } from '../engine/optimize';
import { defaultMission } from '../engine/mission';
import { LineChart } from '../viz/charts';
import { fmt } from './format';

const OBJ: { id: Objective; label: string }[] = [
  { id: 'tsfc', label: 'Minimise TSFC at the design point' }, { id: 'missionFuel', label: 'Minimise mission block fuel' }, { id: 'specificThrust', label: 'Maximise specific thrust' }, { id: 'thrust', label: 'Maximise net thrust' }, { id: 'thermalEff', label: 'Maximise thermal efficiency' },
];

export function OptimizeView({ store }: { store: Store }) {
  const inputs = store.state.inputs;
  const avail = VARIABLES.filter((v) => { const val = getPath(inputs, v.path); if (typeof val !== 'number') return false; if (inputs.arch !== 'turbofan' && ['BPR', 'fan.PR', 'lpc.PR', 'hpc.PR', 'mixer.MNcore'].includes(v.path)) return false; if (inputs.arch === 'turbofan' && v.path === 'comp.PR') return false; if (v.path === 'lpc.PR' && inputs.spools === 3) return false; if (v.path === 'mixer.MNcore' && !inputs.mixed) return false; return true; });
  const [sel, setSel] = useState<string[]>(() => (inputs.arch === 'turbofan' ? ['BPR', 'fan.PR'] : ['comp.PR']));
  const [runObjective, setRunObjective] = useState<Objective>('tsfc');
  const [submittedVars, setSubmittedVars] = useState<typeof VARIABLES>([]);
  const selected = avail.filter((v) => sel.includes(v.path));
  const [bounds, setBounds] = useState<Record<string, [number, number]>>({});
  const [objective, setObjective] = useState<Objective>('tsfc');
  const [cons, setCons] = useState<Constraint[]>([{ kind: 'T3max', value: 950 }, { kind: 'FnMin', value: 0 }]);
  const [smCheck, setSmCheck] = useState({ enabled: false, min: 12, altitude_m: 0, mach: 0.25, T4frac: 1.0 });
  const [maxEvals, setMaxEvals] = useState(150);
  const [runBudget, setRunBudget] = useState(maxEvals);
  const [trace, setTrace] = useState<OptimizeTrace[]>([]);
  const [res, setRes] = useState<OptimizeResult | null>(null);
  const job = useAnalysisJob();
  const busy = job.busy;
  const [error, setError] = useState<string | null>(null);
  const design = 'error' in store.design ? null : store.design;
  const stale = useStale({ inputs, objective, sel, bounds, cons, smCheck, maxEvals, od: store.state.od, arch: inputs.arch });
  const run = () => {
    setError(null); setRes(null); setTrace([]); stale.snapshot();
    const vars = selected.map((v) => ({ ...v, min: bounds[v.path]?.[0] ?? v.min, max: bounds[v.path]?.[1] ?? v.max }));
    setRunBudget(maxEvals); setSubmittedVars(vars); setRunObjective(objective);
    const constraints = cons.filter((c) => !(c.kind === 'FnMin' && c.value <= 0));
    if (smCheck.enabled) constraints.push({ kind: 'surgeMarginMin', value: smCheck.min });
    const m = defaultMission(inputs.arch);
    job.run<OptimizeResult>({ type: 'optimize', inputs, oi: { variables: vars, objective, constraints, maxEvals, checkOffDesign: smCheck.enabled ? { altitude_m: smCheck.altitude_m, mach: smCheck.mach, T4frac: smCheck.T4frac } : undefined, mission: objective === 'missionFuel' ? { aircraft: m.aircraft, segments: m.segments, od: { ...store.state.od, throttle: { mode: 'T4', value: inputs.burner.T4_K } }, pointsPerSegment: 4 } : undefined } }, (t: OptimizeTrace[]) => setTrace(t), (r) => { setRes(r); setTrace(r.trace); }, setError);
  };
  const num = (v: number, on: (x: number) => void, w = 70, step = 1, label = '') => <input className="num" type="number" aria-label={label} style={{ width: w }} value={v} step={step} onChange={(e) => on(+e.target.value)} />;
  const best = trace.reduce((b, t) => (t.feasible && t.objective < b ? t.objective : b), Infinity);
  return (
    <div aria-busy={busy}>
      <div className="prose">
        <h2>Design optimisation <Provenance level="model" style={{ marginLeft: 8 }} /></h2>
        <p>Nelder–Mead simplex over the selected design variables with bound clipping and quadratic penalties for constraints. Each evaluation is a full design-point solve (frozen chemistry); the mission objective flies the default profile for the current architecture at every evaluation. The surge-margin constraint solves one off-design check point per evaluation.</p>
      </div>
      <div className="section">
        <h3>Variables and bounds</h3>
        {avail.map((v) => (
          <div className="control" key={v.path} style={{ gridTemplateColumns: 'auto 1fr auto' }}>
            <label className="toggle"><input type="checkbox" checked={sel.includes(v.path)} onChange={(e) => setSel(e.target.checked ? [...sel, v.path] : sel.filter((x) => x !== v.path))} /> {v.label} <span style={{ color: 'var(--text-muted)' }}>(now {fmt(getPath(inputs, v.path), 2)})</span></label>
            <span />
            <span className="val">{num(bounds[v.path]?.[0] ?? v.min, (x) => setBounds({ ...bounds, [v.path]: [x, bounds[v.path]?.[1] ?? v.max] }), 70, 0.1, `${v.label} lower bound`)} – {num(bounds[v.path]?.[1] ?? v.max, (x) => setBounds({ ...bounds, [v.path]: [bounds[v.path]?.[0] ?? v.min, x] }), 70, 0.1, `${v.label} upper bound`)}</span>
          </div>
        ))}
      </div>
      <div className="explore-controls">
        <label>Objective <select value={objective} onChange={(e) => setObjective(e.target.value as Objective)}>{OBJ.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
        <label>T3 max {num(cons.find((c) => c.kind === 'T3max')?.value ?? 950, (x) => setCons(cons.map((c) => (c.kind === 'T3max' ? { ...c, value: x } : c))), 70, 10, 'T3 maximum')} K</label>
        <label>Fn min {num((cons.find((c) => c.kind === 'FnMin')?.value ?? 0) / 1000, (x) => setCons(cons.map((c) => (c.kind === 'FnMin' ? { ...c, value: x * 1000 } : c))), 70, 1, 'Minimum thrust')} kN (0 = none)</label>
        <label className="toggle"><input type="checkbox" checked={smCheck.enabled} onChange={(e) => setSmCheck({ ...smCheck, enabled: e.target.checked })} /> surge margin ≥ {num(smCheck.min, (x) => setSmCheck({ ...smCheck, min: x }), 50, 1, 'Minimum surge margin')} % at {num(smCheck.altitude_m, (x) => setSmCheck({ ...smCheck, altitude_m: x }), 70, 500, 'Check altitude')} m, M {num(smCheck.mach, (x) => setSmCheck({ ...smCheck, mach: x }), 55, 0.05, 'Check Mach')}</label>
        <label>budget {num(maxEvals, setMaxEvals, 60, 10, 'Evaluation budget')} evals</label>
        <button className="btn primary" onClick={run} disabled={busy || selected.length === 0}>{busy ? `Optimising… ${trace.length} evals` : 'Optimise'}</button>
        {busy && <AnalysisProgress value={trace.length} max={runBudget} cancel={() => { job.cancel(); setTrace([]); setRes(null); }} />}
        {res && <button className="btn" disabled={stale.stale || !res.feasible} title={!res.feasible ? 'No feasible design found; constraints are not satisfied' : stale.stale ? 'Inputs changed since this run; optimise again before applying' : undefined} onClick={() => store.dispatch({ type: 'inputs', inputs: res.best, note: `Optimised: ${OBJ.find((o) => o.id === objective)!.label}` })}>Apply best design</button>}
        {error && <span className="analysis-error" role="alert">{error}</span>}
      </div>
      {trace.length > 0 && stale.stale && <StaleBanner what="optimisation" />}
      {res?.warnings.map((w, k) => <div className="warn" key={k}><span>⚠</span><span>{w}</span></div>)}
      {(res || trace.length > 0) && (
        <div className="cards">
          <div className="card hero"><div className="k">Objective</div><div className="v">{fmt(res ? res.objective : best, 3)}<small>{res ? `from ${fmt(res.baseline, 3)} (${fmt((res.objective / res.baseline - 1) * 100, 1)} %)` : 'best so far'}</small></div></div>
          {res && res.bestX.map((x, i) => <div className="card" key={i}><div className="k">{submittedVars[i]?.label}</div><div className="v">{fmt(x, 3)}</div></div>)}
          {res && <div className="card"><div className="k">Evaluations</div><div className="v">{res.evals}<small>{res.converged ? 'converged' : 'budget'} · {res.feasible ? 'feasible' : 'infeasible'}</small></div></div>}
        </div>
      )}
      {trace.length > 1 && (
        <PlotGroup resetKey={trace}>
          <LineChart title="Convergence" sub="objective per evaluation (infeasible points shown as gaps)" series={[{ name: 'objective', color: 'var(--series-1)', points: trace.map((t) => ({ x: t.eval, y: t.feasible ? t.objective : NaN })) }]} xLabel="evaluation" yLabel={{ missionFuel: 'kg', tsfc: 'mg/(N·s)', thrust: '−kN', specificThrust: '−N·s/kg', thermalEff: '−%' }[runObjective]} xFmt={(v) => fmt(v, 0)} yFmt={(v) => fmt(v, 2)} />
          {submittedVars.map((v, i) => <LineChart key={v.path} title={v.label} series={[{ name: v.path, color: 'var(--series-2)', points: trace.map((t) => ({ x: t.eval, y: t.x[i] })) }]} xLabel="evaluation" yLabel={v.path === 'burner.T4_K' ? 'K' : v.path === 'flight.W_kgs' ? 'kg/s' : ''} xFmt={(v) => fmt(v, 0)} yFmt={(v) => fmt(v, 2)} />)}
        </PlotGroup>
      )}
      {design && <div className="prose"><p style={{ color: 'var(--text-muted)' }}>Current design: TSFC {fmt(design.perf.TSFC_mg_Ns, 2)} mg/(N·s), net thrust {fmt(design.perf.Fn / 1000, 1)} kN, T3 {fmt(design.stations.find((s) => s.id === '3')!.Tt, 0)} K.</p></div>}
    </div>
  );
}
