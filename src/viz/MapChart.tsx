import { useMemo } from 'react';
import { usePlotGroup } from './PlotGroup';
import { EngineInputs, EngineResult } from '../engine/types';
import { makeDesignPoint } from '../engine/offdesign';
import { correctedFlow } from '../engine/maps';
import { extent, linePath } from './plotData';
import { fmt } from '../ui/format';
import type { TransientSample } from '../engine/transient';

/** Scaled compressor maps with the design point and the current operating point. */
export function MapCharts({ design, result }: { design: EngineInputs; result: EngineResult }) {
  const dp = useMemo(() => { try { return makeDesignPoint(design); } catch { return null; } }, [design]);
  if (!dp) return null;
  const comps = result.components.filter((c) => c.kind === 'compressor');
  return (
    <div className="charts">
      {comps.map((c) => {
        const cd = dp.comps[c.id]; if (!cd) return null;
        const st = result.stations.find((s) => s.id === inletId(design, c.id))!;
        const Wc = correctedFlow(st.W, st.Tt, st.Pt);
        const design_c = dp.result.components.find((x) => x.id === c.id)!;
        const stD = dp.result.stations.find((s) => s.id === inletId(design, c.id))!;
        const WcD = correctedFlow(stD.W, stD.Tt, stD.Pt);
        return <OneMap key={c.id} name={c.name} map={cd.map} sc={cd.sc} status={result.offDesign?.converged === false ? 'unconverged operating iterate' : (c.values.offMap || (c.values.Nc_pct !== undefined && (c.values.Nc_pct < 100 * cd.map.d.NcMap[0] / cd.map.d.defaults.NcMap || c.values.Nc_pct > 100 * cd.map.d.NcMap.at(-1)! / cd.map.d.defaults.NcMap))) ? 'operating point outside tabulated map' : undefined} op={{ Wc, PR: c.values.PR, Nc: c.values.Nc_pct, SM: c.values.surgeMargin_pct }} des={{ Wc: WcD, PR: design_c.values.PR }} />;
      })}
    </div>
  );
}
const inletId = (i: EngineInputs, id: string) => ({ fan: '2', lpc: '22', ipc: '22', hpc: '25', comp: '2' } as Record<string, string>)[id] ?? (i.arch === 'turbofan' ? '25' : '2');

function OneMap({ name, map, sc, status, op, des }: { name: string; map: any; sc: any; status?: string; op: { Wc: number; PR: number; Nc?: number; SM?: number }; des: { Wc: number; PR: number } }) {
  const W = 420, H = 260, m = { l: 48, r: 12, t: 10, b: 34 };
  const d = map.d;
  const speeds: number[] = d.NcMap;
  const lines = speeds.map((nc: number) => d.RlineMap.map((rl: number) => { const r = map.read(sc, nc * sc.sNc, rl); return { Wc: r.Wc, PR: r.PR }; }));
  const stall = speeds.map((nc: number) => { const r = map.read(sc, nc * sc.sNc, d.RlineStall); return { Wc: r.Wc, PR: r.PR }; });
  const all = [...lines.flat(), ...stall, op, des];
  const [xmin, xmax, ymin, ymax] = mapBounds(all);
  const sx = (v: number) => m.l + ((v - xmin) / (xmax - xmin)) * (W - m.l - m.r);
  const sy = (v: number) => H - m.b - ((v - ymin) / (ymax - ymin)) * (H - m.t - m.b);
  const path = (pts: { Wc: number; PR: number }[]) => linePath(pts.map(p => ({ x: p.Wc, y: p.PR })), sx, sy);
  const ticksX = 5, ticksY = 5;
  return (
    <div className="chart">
      <h4>{name} map</h4>
      <div className="sub">corrected flow vs pressure ratio · speed lines {Math.round(speeds[0] / d.defaults.NcMap * 100)}–{Math.round(speeds[speeds.length - 1] / d.defaults.NcMap * 100)} % of map design speed · {map.name} map scaled to the design point{status ? ` · ${status}` : ''}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${name} compressor map`}>
        <g className="axis"><line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} /><line x1={m.l} x2={m.l} y1={m.t} y2={H - m.b} /></g>
        {Array.from({ length: ticksX + 1 }, (_, k) => xmin + ((xmax - xmin) * k) / ticksX).map((v) => <text key={v} x={sx(v)} y={H - m.b + 13} textAnchor="middle">{fmt(v, 0)}</text>)}
        {Array.from({ length: ticksY + 1 }, (_, k) => ymin + ((ymax - ymin) * k) / ticksY).map((v) => <text key={v} x={m.l - 5} y={sy(v) + 3.5} textAnchor="end">{fmt(v, 1)}</text>)}
        <text x={(m.l + W - m.r) / 2} y={H - 3} textAnchor="middle">corrected flow (kg/s)</text>
        <text transform={`translate(11,${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle">pressure ratio</text>
        {lines.map((pts: any, k: number) => <path key={k} d={path(pts)} fill="none" stroke="var(--series-1)" strokeOpacity={0.35 + (0.65 * k) / lines.length} strokeWidth={1.5} />)}
        {speeds.map((nc: number, k: number) => { const p = lines[k][0]; return <text key={nc} x={sx(p.Wc) - 4} y={sy(p.PR) - 3} textAnchor="end" fontSize={9}>{fmt(nc / d.defaults.NcMap * 100, 0)}%</text>; })}
        <path d={path(stall)} fill="none" stroke="var(--bad)" strokeWidth={1.5} strokeDasharray="5 3" />
        <circle cx={sx(des.Wc)} cy={sy(des.PR)} r={5} fill="none" stroke="var(--text-primary)" strokeWidth={1.5} />
        <circle cx={sx(op.Wc)} cy={sy(op.PR)} r={5} fill="var(--series-2)" stroke="var(--surface-2)" strokeWidth={2} />
      </svg>
      <div className="legendrow">
        <span><i style={{ background: 'var(--series-1)' }} />speed lines</span><span><i style={{ background: 'var(--bad)' }} />stall line</span>
        <span><i style={{ background: 'transparent', border: '1.5px solid var(--text-primary)', borderRadius: '50%' }} />design point</span><span><i style={{ background: 'var(--series-2)', borderRadius: '50%' }} />operating point{op.Nc !== undefined ? ` · Nc ${fmt(op.Nc, 1)} % · surge margin ${fmt(op.SM ?? NaN, 1)} %` : ''}</span>
      </div>
      <div className="sub">Reference map; variable-geometry and component-delta corrections are not drawn.</div>
    </div>
  );
}

/** Transient trajectory drawn on the first compressor map (HPC or the single compressor). */
export function MapTrajectory({ design, samples }: { design: EngineInputs; samples: TransientSample[] }) {
  const group = usePlotGroup();
  const dp = useMemo(() => { try { return makeDesignPoint(design); } catch { return null; } }, [design]);
  if (!dp || samples.length < 2) return null;
  const id = dp.comps.hpc ? 'hpc' : dp.comps.comp ? 'comp' : Object.keys(dp.comps)[0];
  const cd = dp.comps[id]; if (!cd) return null;
  const W = 420, H = 260, m = { l: 48, r: 12, t: 10, b: 34 };
  const d = cd.map.d;
  const speeds: number[] = d.NcMap;
  const lines = speeds.map((nc: number) => d.RlineMap.map((rl: number) => { const r = cd.map.read(cd.sc, nc * cd.sc.sNc, rl); return { Wc: r.Wc, PR: r.PR }; }));
  const stall = speeds.map((nc: number) => { const r = cd.map.read(cd.sc, nc * cd.sc.sNc, d.RlineStall); return { Wc: r.Wc, PR: r.PR }; });
  // samples without a gas-path solution (starter-only regime) carry no map point
  const traj = samples.map(s => s.gasPath !== false && s.converged && Number.isFinite(s.Wc?.[id]) && Number.isFinite(s.PR?.[id]) ? { Wc: s.Wc[id], PR: s.PR[id] } : { Wc: NaN, PR: NaN });
  const valid = traj.filter(p => Number.isFinite(p.Wc) && Number.isFinite(p.PR));
  const selectedIndex = group?.cursor?.axis === 'time (s)' ? samples.findIndex(s => s.t === group.cursor!.x) : -1;
  const selected = selectedIndex >= 0 && Number.isFinite(traj[selectedIndex].Wc) && Number.isFinite(traj[selectedIndex].PR) ? traj[selectedIndex] : null;
  if (!valid.length) return <div className="chart"><h4>{id.toUpperCase()} running line during the transient</h4><div className="sub">no converged gas-path map points to plot</div></div>;
  const [xmin, xmax, ymin, ymax] = mapBounds([...lines.flat(), ...stall, ...valid]);
  const sx = (v: number) => m.l + ((v - xmin) / (xmax - xmin)) * (W - m.l - m.r);
  const sy = (v: number) => H - m.b - ((v - ymin) / (ymax - ymin)) * (H - m.t - m.b);
  const path = (pts: { Wc: number; PR: number }[]) => linePath(pts.map(p => ({ x: p.Wc, y: p.PR })), sx, sy);
  return (
    <div className="chart">
      <h4>{id.toUpperCase()} running line during the transient</h4>
      <div className="sub">operating point trajectory on the reference map · first valid ○ last valid ● · gaps omit unsolved samples</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="transient trajectory on compressor map" tabIndex={0}
        onKeyDown={event => {
          if (event.key === 'Escape') { group?.setCursor(null); group?.setWindow(null); return; }
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const indices = traj.flatMap((p, i) => Number.isFinite(p.Wc) && Number.isFinite(p.PR) ? [i] : []);
          const at = indices.indexOf(selectedIndex);
          const index = event.key === 'Home' ? indices[0] : event.key === 'End' ? indices.at(-1)! : indices[Math.max(0, Math.min(indices.length - 1, at + (event.key === 'ArrowLeft' ? -1 : 1)))];
          group?.setCursor({ axis: 'time (s)', x: samples[index].t });
        }}
        onPointerMove={event => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const x = (event.clientX - bounds.left) / bounds.width * W, y = (event.clientY - bounds.top) / bounds.height * H;
          let index = -1, distance = Infinity;
          traj.forEach((p, i) => { const d = (sx(p.Wc) - x) ** 2 + (sy(p.PR) - y) ** 2; if (d < distance) { index = i; distance = d; } });
          if (index >= 0) group?.setCursor({ axis: 'time (s)', x: samples[index].t });
        }} onPointerLeave={e => { if (e.pointerType === 'mouse' && !document.activeElement?.matches('.chart svg')) group?.setCursor(null); }} onBlur={() => group?.setCursor(null)}>
        {Array.from({ length: 6 }, (_, i) => xmin + (xmax - xmin) * i / 5).map(v => <text key={v} x={sx(v)} y={H - m.b + 13} textAnchor="middle">{fmt(v, 1)}</text>)}
        {Array.from({ length: 6 }, (_, i) => ymin + (ymax - ymin) * i / 5).map(v => <text key={v} x={m.l - 5} y={sy(v) + 3.5} textAnchor="end">{fmt(v, 1)}</text>)}
        <g className="axis"><line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} /><line x1={m.l} x2={m.l} y1={m.t} y2={H - m.b} /></g>
        <text x={(m.l + W - m.r) / 2} y={H - 3} textAnchor="middle">corrected flow (kg/s)</text>
        <text transform={`translate(11,${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle">pressure ratio</text>
        {lines.map((pts: any, k: number) => <path key={k} d={path(pts)} fill="none" stroke="var(--series-1)" strokeOpacity={0.3 + (0.5 * k) / lines.length} strokeWidth={1.2} />)}
        <path d={path(stall)} fill="none" stroke="var(--bad)" strokeWidth={1.5} strokeDasharray="5 3" />
        <path d={path(traj)} fill="none" stroke="var(--series-2)" strokeWidth={2.5} strokeLinejoin="round" />
        <circle cx={sx(valid[0].Wc)} cy={sy(valid[0].PR)} r={5} fill="var(--surface-2)" stroke="var(--series-2)" strokeWidth={2} />
        <circle cx={sx(valid[valid.length - 1].Wc)} cy={sy(valid[valid.length - 1].PR)} r={5} fill="var(--series-2)" stroke="var(--surface-2)" strokeWidth={2} />
        {selected && <circle className="map-selection" data-time={samples[selectedIndex].t} cx={sx(selected.Wc)} cy={sy(selected.PR)} r={7} fill="var(--surface-2)" stroke="var(--text-primary)" strokeWidth={2.5} pointerEvents="none" />}
      </svg>
      <div className="legendrow"><span><i style={{ background: 'var(--series-1)' }} />speed lines</span><span><i style={{ background: 'var(--bad)' }} />stall line</span><span><i style={{ background: 'var(--series-2)' }} />trajectory</span></div>
    </div>
  );
}

function mapBounds(points: { Wc: number; PR: number }[]) {
  const [loW, hiW] = extent(points.map(p => p.Wc));
  const [loP, hiP] = extent(points.map(p => p.PR));
  return [Math.min(0, loW), Math.max(1e-6, hiW * 1.05), Math.min(1, loP - 0.05 * Math.max(hiP - loP, 0.1)), Math.max(1.05, hiP * 1.05)];
}
