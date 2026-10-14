import { useEffect, useMemo, useState } from 'react';
import { EngineInputs } from '../engine/types';
import { OffDesignInputs } from '../engine/offdesign';
import { request } from '../engine/client';
import { LineChart, Series } from './charts';
import { fmt } from '../ui/format';
import { exportSweepCsv } from '../ui/csv';

interface Param { id: string; label: string; path: string; min: number; max: number; unit: string; scale?: number; archs?: string[]; mode: 'design' | 'offdesign' | 'both' }
const PARAMS: Param[] = [
  { id: 'alt', label: 'Altitude', path: 'flight.altitude_m', min: 0, max: 15000, unit: 'm', mode: 'design' },
  { id: 'mach', label: 'Mach number', path: 'flight.mach', min: 0, max: 2.2, unit: '', mode: 'design' },
  { id: 'T4', label: 'Turbine inlet temperature', path: 'burner.T4_K', min: 1100, max: 2000, unit: 'K', mode: 'design' },
  { id: 'BPR', label: 'Bypass ratio', path: 'BPR', min: 0.5, max: 14, unit: '', archs: ['turbofan'], mode: 'design' },
  { id: 'FPR', label: 'Fan pressure ratio', path: 'fan.PR', min: 1.2, max: 3.5, unit: '', archs: ['turbofan'], mode: 'design' },
  { id: 'HPCPR', label: 'HPC pressure ratio', path: 'hpc.PR', min: 4, max: 25, unit: '', archs: ['turbofan'], mode: 'design' },
  { id: 'PR', label: 'Compressor pressure ratio', path: 'comp.PR', min: 3, max: 30, unit: '', archs: ['turbojet', 'turboprop'], mode: 'design' },
  { id: 'effc', label: 'Compressor efficiency', path: 'comp.eff', min: 0.78, max: 0.93, unit: '', archs: ['turbojet', 'turboprop'], mode: 'design' },
  { id: 'effhpc', label: 'HPC efficiency', path: 'hpc.eff', min: 0.78, max: 0.93, unit: '', archs: ['turbofan'], mode: 'design' },
  { id: 'efft', label: 'Turbine efficiency', path: 'hpt.eff', min: 0.82, max: 0.94, unit: '', mode: 'design' },
  { id: 'ram', label: 'Inlet ram recovery', path: 'inlet.ramRecovery', min: 0.85, max: 1, unit: '', mode: 'design' },
  { id: 'shp', label: 'Shaft power', path: 'prop.shaftPower_W', min: 2e5, max: 4e6, unit: 'kW', scale: 1e-3, archs: ['turboprop'], mode: 'design' },
  { id: 'od_T4', label: 'Throttle: T4', path: 'throttle.value', min: 1000, max: 1900, unit: 'K', mode: 'offdesign' },
  { id: 'od_alt', label: 'Altitude', path: 'altitude_m', min: 0, max: 15000, unit: 'm', mode: 'offdesign' },
  { id: 'od_mach', label: 'Mach number', path: 'mach', min: 0, max: 2.0, unit: '', mode: 'offdesign' },
  { id: 'od_dT', label: 'ΔT from ISA', path: 'dT_isa', min: -40, max: 40, unit: 'K', mode: 'offdesign' },
  { id: 'od_shp', label: 'Propeller load', path: 'propPower_W', min: 1e5, max: 4e6, unit: 'kW', scale: 1e-3, archs: ['turboprop'], mode: 'offdesign' },
];
function getPath(obj: any, path: string): any { return path.split('.').reduce((o, k) => o?.[k], obj); }

type Mode = 'design' | 'offdesign';
interface SweepPoint { x: number; r: any | null }

export function Explore({ inputs, od, initialMode }: { inputs: EngineInputs; od: OffDesignInputs; initialMode: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const avail = PARAMS.filter((p) => (!p.archs || p.archs.includes(inputs.arch)) && p.mode === mode);
  const [pid, setPid] = useState<string>('');
  const param = avail.find((p) => p.id === pid) ?? avail[0];
  const [second, setSecond] = useState<string>('none');
  const param2 = avail.find((p) => p.id === second && p.id !== param.id);
  const [range, setRange] = useState<{ min: number; max: number } | null>(null);
  const [chem, setChem] = useState<'frozen' | 'equilibrium'>('frozen');
  const lo = range?.min ?? param.min, hi = range?.max ?? param.max;
  const [data, setData] = useState<{ level: number | null; pts: SweepPoint[] }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setPid(''); setSecond('none'); setRange(null); }, [mode, inputs.arch]);

  const N = mode === 'design' ? 41 : 25;
  const values = useMemo(() => Array.from({ length: N }, (_, k) => lo + (k / (N - 1)) * (hi - lo)), [lo, hi, N]);
  const famValues = useMemo(() => (param2 ? [0, 0.25, 0.5, 0.75, 1].map((f) => param2.min + f * (param2.max - param2.min)) : undefined), [param2]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true); setError(null);
    const inp = { ...inputs, chemistry: chem };
    const odBase: OffDesignInputs = { ...od, throttle: { ...od.throttle } };
    if (mode === 'offdesign' && param.path !== 'throttle.value' && odBase.throttle.mode !== 'T4') odBase.throttle = { mode: 'T4', value: inputs.burner.T4_K };
    if (mode === 'offdesign' && param.path === 'throttle.value') odBase.throttle.mode = 'T4';
    const t = setTimeout(() => {
      request<{ level: number | null; pts: SweepPoint[] }[]>({ type: 'sweep', inputs: inp, mode, od: odBase, param: param.path, values, families: param2 && famValues ? { param: param2.path, values: famValues } : undefined })
        .then((d) => { if (!cancelled) { setData(d); setBusy(false); } })
        .catch((e) => { if (!cancelled) { setError(e.message); setBusy(false); } });
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [inputs, od, mode, param, param2, values, famValues, chem]);

  const colors = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];
  const sc = param.scale ?? 1;
  const mk = (pick: (r: any) => number, name = ''): Series[] => (data ?? []).map((d, i) => ({
    name: param2 && d.level !== null ? `${param2.label} ${fmt(d.level * (param2.scale ?? 1), param2.scale ? 0 : 2)}${param2.unit ? ' ' + param2.unit : ''}` : name,
    color: colors[i % colors.length],
    points: d.pts.map((p) => ({ x: p.x * sc, y: p.r && !p.r.bad ? pick(p.r) : NaN })),
  }));
  const xl = `${param.label}${param.unit ? ` (${param.unit})` : ''}`;
  const xf = (v: number) => fmt(v, sc !== 1 || hi - lo > 50 ? 0 : 2);
  const tp = inputs.arch === 'turboprop';
  const current = mode === 'design' ? getPath(inputs, param.path) : getPath(od, param.path);

  return (
    <div>
      <div className="explore-controls">
        <div className="segmented"><button className={mode === 'design' ? 'on' : ''} onClick={() => setMode('design')}>Design sweeps</button><button className={mode === 'offdesign' ? 'on' : ''} onClick={() => setMode('offdesign')}>Off-design sweeps</button></div>
        <label>Sweep <select value={param.id} onChange={(e) => { setPid(e.target.value); setRange(null); }}>{avail.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <label>from <input className="num" type="number" style={{ width: 90 }} value={Number((lo * sc).toFixed(3))} onChange={(e) => setRange({ min: parseFloat(e.target.value) / sc, max: hi })} /></label>
        <label>to <input className="num" type="number" style={{ width: 90 }} value={Number((hi * sc).toFixed(3))} onChange={(e) => setRange({ min: lo, max: parseFloat(e.target.value) / sc })} /></label>
        <label>Family <select value={param2?.id ?? 'none'} onChange={(e) => setSecond(e.target.value)}><option value="none">none</option>{avail.filter((p) => p.id !== param.id).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <label>Chemistry <select value={chem} onChange={(e) => setChem(e.target.value as any)}><option value="frozen">frozen (fast)</option><option value="equilibrium">equilibrium</option></select></label>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          {mode === 'design' ? 'Each point is a new design: all other inputs held at the current design.' : 'Fixed geometry from the current design point; speeds, flows and bypass ratio float. Other operating-point inputs held at their current values.'}
          {current !== undefined && ` Current value ${fmt(Number(current) * sc, 2)}.`} Gaps mark points that did not solve.{busy ? ' Computing…' : ''}
        </span>
        {error && <span style={{ color: 'var(--bad)' }}>{error}</span>}
        <button className="btn" disabled={!data} onClick={() => { const keys = ['Fn', 'TSFC', 'spec', 'eth', 'eo', 'Wf', 'OPR', 'T4', 'T5', 'W', 'BPR', 'shp', 'psfc']; const ser = (data ?? []).flatMap((d) => keys.map((k) => ({ name: `${k}${d.level !== null && param2 ? ` @ ${param2.label}=${fmt(d.level * (param2.scale ?? 1), 2)}` : ''}`, points: d.pts.map((p) => ({ x: p.x * sc, y: p.r ? p.r[k] : NaN })) }))); exportSweepCsv(xl, ser, ser.map((x) => x.name)); }}>Export CSV</button>
      </div>
      <div className="charts" style={{ opacity: busy ? 0.6 : 1 }}>
        {tp ? (
          <>
            <LineChart title="Shaft power" sub="delivered at the power-turbine shaft" series={mk((r) => r.shp / 1000, 'shaft power')} xLabel={xl} yLabel="kW" xFmt={xf} yFmt={(v) => fmt(v, 0)} />
            <LineChart title="Power specific fuel consumption" series={mk((r) => r.psfc, 'PSFC')} xLabel={xl} yLabel="kg/kWh" xFmt={xf} yFmt={(v) => fmt(v, 3)} />
            <LineChart title="Total net thrust" sub="propeller + jet" series={mk((r) => r.Fn / 1000, 'thrust')} xLabel={xl} yLabel="kN" xFmt={xf} />
          </>
        ) : (
          <>
            <LineChart title="Net thrust" series={mk((r) => r.Fn / 1000, 'net thrust')} xLabel={xl} yLabel="kN" xFmt={xf} yFmt={(v) => fmt(v, 1)} />
            <LineChart title="Thrust specific fuel consumption" series={mk((r) => r.TSFC, 'TSFC')} xLabel={xl} yLabel="mg/(N·s)" xFmt={xf} yFmt={(v) => fmt(v, 1)} />
            <LineChart title="Specific thrust" sub="net thrust per unit inlet mass flow" series={mk((r) => r.spec, 'specific thrust')} xLabel={xl} yLabel="N·s/kg" xFmt={xf} yFmt={(v) => fmt(v, 0)} />
          </>
        )}
        <LineChart title="Thermal efficiency" series={mk((r) => r.eth, 'thermal efficiency')} xLabel={xl} yLabel="%" xFmt={xf} yFmt={(v) => fmt(v, 0)} />
        <LineChart title="Overall efficiency" sub="zero at static conditions" series={mk((r) => r.eo, 'overall efficiency')} xLabel={xl} yLabel="%" xFmt={xf} yFmt={(v) => fmt(v, 0)} />
        <LineChart title="Fuel flow" series={mk((r) => r.Wf, 'fuel flow')} xLabel={xl} yLabel="kg/s" xFmt={xf} yFmt={(v) => fmt(v, 2)} />
        {mode === 'offdesign' && (
          <>
            <LineChart title="Spool speeds" sub="per cent of design mechanical speed" series={shaftSeries(data, inputs, sc, colors)} xLabel={xl} yLabel="% design" xFmt={xf} yFmt={(v) => fmt(v, 0)} />
            <LineChart title="Compressor surge margins" series={smSeries(data, sc, colors)} xLabel={xl} yLabel="%" xFmt={xf} yFmt={(v) => fmt(v, 0)} />
            <LineChart title="Inlet mass flow" series={mk((r) => r.W, 'inlet flow')} xLabel={xl} yLabel="kg/s" xFmt={xf} yFmt={(v) => fmt(v, 0)} />
            {inputs.arch === 'turbofan' && <LineChart title="Bypass ratio" series={mk((r) => r.BPR, 'BPR')} xLabel={xl} yLabel="" xFmt={xf} yFmt={(v) => fmt(v, 2)} />}
            <LineChart title="Turbine inlet temperature" series={mk((r) => r.T4, 'T4')} xLabel={xl} yLabel="K" xFmt={xf} yFmt={(v) => fmt(v, 0)} />
          </>
        )}
      </div>
    </div>
  );
}

function shaftSeries(data: { level: number | null; pts: SweepPoint[] }[] | null, inputs: EngineInputs, sc: number, colors: string[]): Series[] {
  if (!data || !data[0]) return [];
  const first = data[0].pts.find((p) => p.r)?.r; if (!first) return [];
  const names = Object.keys(first.shafts);
  const des: Record<string, number> = { 'HP shaft': inputs.speeds.HP, 'LP shaft': inputs.speeds.LP, 'IP shaft': inputs.speeds.IP, 'Shaft': inputs.speeds.HP, 'Power shaft': inputs.speeds.PT };
  return names.map((n, i) => ({ name: n, color: colors[i % colors.length], points: data[0].pts.map((p) => ({ x: p.x * sc, y: p.r ? (100 * p.r.shafts[n]) / des[n] : NaN })) }));
}
function smSeries(data: { level: number | null; pts: SweepPoint[] }[] | null, sc: number, colors: string[]): Series[] {
  if (!data || !data[0]) return [];
  const first = data[0].pts.find((p) => p.r)?.r; if (!first) return [];
  return Object.keys(first.comps).map((id, i) => ({ name: id.toUpperCase(), color: colors[i % colors.length], points: data[0].pts.map((p) => ({ x: p.x * sc, y: p.r ? p.r.comps[id].SM : NaN })) }));
}
