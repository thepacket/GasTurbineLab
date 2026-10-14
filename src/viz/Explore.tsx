import { useMemo, useState } from 'react';
import { EngineInputs } from '../engine/types';
import { solveEngine } from '../engine/cycle';
import { LineChart, Series } from './charts';
import { fmt } from '../ui/format';

interface Param { id: string; label: string; path: string; min: number; max: number; unit: string; scale?: number; archs?: string[] }
const PARAMS: Param[] = [
  { id: 'alt', label: 'Altitude', path: 'flight.altitude_m', min: 0, max: 15000, unit: 'm' },
  { id: 'mach', label: 'Mach number', path: 'flight.mach', min: 0, max: 2.2, unit: '' },
  { id: 'T4', label: 'Turbine inlet temperature', path: 'burner.T4_K', min: 1100, max: 2000, unit: 'K' },
  { id: 'BPR', label: 'Bypass ratio', path: 'BPR', min: 0.5, max: 14, unit: '', archs: ['turbofan'] },
  { id: 'FPR', label: 'Fan pressure ratio', path: 'fan.PR', min: 1.2, max: 3.5, unit: '', archs: ['turbofan'] },
  { id: 'HPCPR', label: 'HPC pressure ratio', path: 'hpc.PR', min: 4, max: 25, unit: '', archs: ['turbofan'] },
  { id: 'PR', label: 'Compressor pressure ratio', path: 'comp.PR', min: 3, max: 30, unit: '', archs: ['turbojet', 'turboprop'] },
  { id: 'effc', label: 'Compressor efficiency', path: 'comp.eff', min: 0.78, max: 0.93, unit: '', archs: ['turbojet', 'turboprop'] },
  { id: 'effhpc', label: 'HPC efficiency', path: 'hpc.eff', min: 0.78, max: 0.93, unit: '', archs: ['turbofan'] },
  { id: 'efft', label: 'Turbine efficiency', path: 'hpt.eff', min: 0.82, max: 0.94, unit: '' },
  { id: 'ram', label: 'Inlet ram recovery', path: 'inlet.ramRecovery', min: 0.85, max: 1, unit: '' },
  { id: 'shp', label: 'Shaft power', path: 'prop.shaftPower_W', min: 2e5, max: 4e6, unit: 'kW', scale: 1e-3, archs: ['turboprop'] },
];

function setPath(obj: any, path: string, value: unknown): any {
  const [h, ...rest] = path.split('.'); const c = { ...obj };
  c[h] = rest.length ? setPath(obj[h] ?? {}, rest.join('.'), value) : value; return c;
}
function getPath(obj: any, path: string): any { return path.split('.').reduce((o, k) => o?.[k], obj); }

export function Explore({ inputs }: { inputs: EngineInputs }) {
  const avail = PARAMS.filter((p) => !p.archs || p.archs.includes(inputs.arch));
  const [pid, setPid] = useState(inputs.arch === 'turbofan' ? 'BPR' : 'PR');
  const [second, setSecond] = useState<string>('none');
  const param = avail.find((p) => p.id === pid) ?? avail[0];
  const param2 = avail.find((p) => p.id === second && p.id !== param.id);
  const [range, setRange] = useState<{ min: number; max: number } | null>(null);
  const lo = range?.min ?? param.min, hi = range?.max ?? param.max;

  const data = useMemo(() => {
    const N = 41;
    const base = getPath(inputs, param.path);
    const levels = param2 ? [0, 0.25, 0.5, 0.75, 1].map((f) => param2.min + f * (param2.max - param2.min)) : [null];
    return levels.map((lv) => {
      const pts = [];
      for (let k = 0; k < N; k++) {
        const x = lo + (k / (N - 1)) * (hi - lo);
        let inp = setPath(inputs, param.path, x);
        if (param2 && lv !== null) inp = setPath(inp, param2.path, lv);
        try {
          const r = solveEngine(inp);
          const bad = r.warnings.some((w) => w.includes('cannot'));
          pts.push({ x, Fn: r.perf.Fn, TSFC: r.perf.TSFC_mg_Ns, spec: r.perf.specificThrust, eth: r.perf.thermalEff * 100, eo: r.perf.overallEff * 100, ep: r.perf.propulsiveEff * 100, Wf: r.perf.Wfuel, T5: r.stations[r.stations.length - 2].Tt, OPR: r.perf.OPR, shp: r.perf.shaftPower_W, psfc: r.perf.PSFC_kg_kWh, bad });
        } catch { pts.push({ x, Fn: NaN, TSFC: NaN, spec: NaN, eth: NaN, eo: NaN, ep: NaN, Wf: NaN, T5: NaN, OPR: NaN, shp: NaN, psfc: NaN, bad: true }); }
      }
      return { level: lv, pts, base };
    });
  }, [inputs, param, param2, lo, hi]);

  const colors = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];
  const sc = param.scale ?? 1;
  const mk = (key: string): Series[] => data.map((d, i) => ({
    name: param2 ? `${param2.label} ${fmt(d.level! * (param2.scale ?? 1), param2.scale ? 0 : 2)}${param2.unit ? ' ' + param2.unit : ''}` : key,
    color: colors[i % colors.length],
    points: d.pts.map((p: any) => ({ x: p.x * sc, y: p.bad ? NaN : p[key] })),
  }));
  const xl = `${param.label}${param.unit ? ` (${param.unit})` : ''}`;
  const xf = (v: number) => fmt(v, sc !== 1 || hi - lo > 50 ? 0 : 2);
  const tp = inputs.arch === 'turboprop';

  return (
    <div>
      <div className="explore-controls">
        <label>Sweep <select value={param.id} onChange={(e) => { setPid(e.target.value); setRange(null); }}>{avail.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <label>from <input className="num" type="number" style={{ width: 90 }} value={Number((lo * sc).toFixed(3))} onChange={(e) => setRange({ min: parseFloat(e.target.value) / sc, max: hi })} /></label>
        <label>to <input className="num" type="number" style={{ width: 90 }} value={Number((hi * sc).toFixed(3))} onChange={(e) => setRange({ min: lo, max: parseFloat(e.target.value) / sc })} /></label>
        <label>Family <select value={param2?.id ?? 'none'} onChange={(e) => setSecond(e.target.value)}><option value="none">none</option>{avail.filter((p) => p.id !== param.id).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>All other inputs held at the current design. Gaps mark infeasible designs (turbine cannot supply the required power).</span>
      </div>
      <div className="charts">
        {tp ? (
          <>
            <LineChart title="Shaft power" sub="delivered at the power-turbine shaft" series={mk('shp').map((s) => ({ ...s, points: s.points.map((p) => ({ ...p, y: p.y / 1000 })) }))} xLabel={xl} yLabel="kW" xFmt={xf} yFmt={(v) => fmt(v, 0)} />
            <LineChart title="Power specific fuel consumption" series={mk('psfc')} xLabel={xl} yLabel="kg/kWh" xFmt={xf} yFmt={(v) => fmt(v, 3)} />
            <LineChart title="Total net thrust" sub="propeller + jet" series={mk('Fn').map((s) => ({ ...s, points: s.points.map((p) => ({ ...p, y: p.y / 1000 })) }))} xLabel={xl} yLabel="kN" xFmt={xf} />
          </>
        ) : (
          <>
            <LineChart title="Net thrust" series={mk('Fn').map((s) => ({ ...s, points: s.points.map((p) => ({ ...p, y: p.y / 1000 })) }))} xLabel={xl} yLabel="kN" xFmt={xf} yFmt={(v) => fmt(v, 1)} />
            <LineChart title="Thrust specific fuel consumption" series={mk('TSFC')} xLabel={xl} yLabel="mg/(N·s)" xFmt={xf} yFmt={(v) => fmt(v, 1)} />
            <LineChart title="Specific thrust" sub="net thrust per unit inlet mass flow" series={mk('spec')} xLabel={xl} yLabel="N·s/kg" xFmt={xf} yFmt={(v) => fmt(v, 0)} />
          </>
        )}
        <LineChart title="Thermal efficiency" series={mk('eth')} xLabel={xl} yLabel="%" xFmt={xf} yFmt={(v) => fmt(v, 0)} />
        <LineChart title="Overall efficiency" sub="zero at static conditions" series={mk('eo')} xLabel={xl} yLabel="%" xFmt={xf} yFmt={(v) => fmt(v, 0)} />
        <LineChart title="Fuel flow" series={mk('Wf')} xLabel={xl} yLabel="kg/s" xFmt={xf} yFmt={(v) => fmt(v, 2)} />
      </div>
    </div>
  );
}
