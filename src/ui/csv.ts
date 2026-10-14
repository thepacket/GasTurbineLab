import { EngineResult } from '../engine/types';

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const q = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function exportStationsCsv(r: EngineResult) {
  const head = ['station', 'name', 'stream', 'Pt_Pa', 'Tt_K', 'ht_J_kg', 's_J_kgK', 'W_kgs', 'FAR', 'Ps_Pa', 'Ts_K', 'V_ms', 'MN', 'A_m2', 'gamma', 'cp_J_kgK', 'R_J_kgK'];
  const rows = r.stations.map((s) => [s.id, s.name, s.stream, s.Pt, s.Tt, s.ht, s.s, s.W, s.FAR, s.Ps, s.Ts, s.V, s.MN, s.A, s.gamma, s.cp, s.R]);
  const comp = [['', ''], ['component', 'quantity', 'value'], ...r.components.flatMap((c) => Object.entries(c.values).map(([k, v]) => [c.name, k, v]))];
  const perf = [['', ''], ['performance', 'value'], ...Object.entries(r.perf).map(([k, v]) => [k, v])];
  const text = [head, ...rows, ...comp, ...perf].map((row) => row.map(q).join(',')).join('\n');
  download(`gas-turbine-lab-${r.inputs.arch}-${r.offDesign ? 'offdesign' : 'design'}.csv`, text);
}

export function exportSweepCsv(param: string, series: { name: string; points: { x: number; y: number }[] }[], metrics: string[]) {
  // series are grouped per metric in the same x order; flatten to columns
  const xs = series[0]?.points.map((p) => p.x) ?? [];
  const head = [param, ...series.map((s, i) => `${metrics[i] ?? s.name}`)];
  const rows = xs.map((x, k) => [x, ...series.map((s) => s.points[k]?.y ?? '')]);
  download('gas-turbine-lab-sweep.csv', [head, ...rows].map((r) => r.map(q).join(',')).join('\n'));
}
