import { PlotGroup } from './PlotGroup';
import { EngineResult } from '../engine/types';
import { LineChart } from './charts';
import { fmt, kPa } from '../ui/format';

/** T-s diagram and station profiles for the current design. */
export function Diagrams({ result }: { result: EngineResult }) {
  const core = result.stations.filter((s) => s.stream !== 'bypass');
  const byp = result.stations.filter((s) => s.stream === 'bypass');
  const s0 = core[0].s;
  const ts = [{ name: 'Core', color: 'var(--series-1)', points: core.map((s) => ({ x: (s.s - s0) / 1000, y: s.Tt, label: s.id })) }];
  if (byp.length) ts.push({ name: 'Bypass', color: 'var(--series-2)', points: [core.find(s => s.id === '21') ?? core[1], ...byp].map((s) => ({ x: (s.s - s0) / 1000, y: s.Tt, label: s.id })) });
  const idx = (arr: typeof core) => arr.map((s, i) => ({ i, s }));
  return (
    <PlotGroup resetKey={result}>
      <LineChart title="Temperature–entropy diagram" sub="total conditions at each station" series={ts} xLabel="Δs (kJ/kg·K)" yLabel="Tt (K)" labelPoints xFmt={(v) => fmt(v, 2)} yFmt={(v) => fmt(v, 0)} />
      <LineChart title="Total pressure through the engine" series={[{ name: 'Pt', color: 'var(--series-1)', points: idx(core).map(({ i, s }) => ({ x: i, y: s.Pt / 1000, label: s.id })) }]} xLabel="station" xTicks={core.map((_, i) => i)} yLabel="kPa" markers labelPoints xFmt={(v) => core[v]?.id ?? ''} yFmt={(v) => kPa(v * 1000)} />
      <LineChart title="Total temperature through the engine" series={[{ name: 'Tt', color: 'var(--series-2)', points: idx(core).map(({ i, s }) => ({ x: i, y: s.Tt, label: s.id })) }]} xLabel="station" xTicks={core.map((_, i) => i)} yLabel="K" markers labelPoints xFmt={(v) => core[v]?.id ?? ''} yFmt={(v) => fmt(v, 0)} />
    </PlotGroup>
  );
}
