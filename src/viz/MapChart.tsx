import { useMemo } from 'react';
import { EngineInputs, EngineResult } from '../engine/types';
import { makeDesignPoint } from '../engine/offdesign';
import { correctedFlow } from '../engine/maps';
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
        return <OneMap key={c.id} name={c.name} map={cd.map} sc={cd.sc} NcDes={cd.NcDes} op={{ Wc, PR: c.values.PR, Nc: c.values.Nc_pct, SM: c.values.surgeMargin_pct }} des={{ Wc: WcD, PR: design_c.values.PR }} />;
      })}
    </div>
  );
}
const inletId = (i: EngineInputs, id: string) => ({ fan: '2', lpc: '22', ipc: '22', hpc: '25', comp: '2' } as Record<string, string>)[id] ?? (i.arch === 'turbofan' ? '25' : '2');

function OneMap({ name, map, sc, NcDes, op, des }: { name: string; map: any; sc: any; NcDes: number; op: { Wc: number; PR: number; Nc?: number; SM?: number }; des: { Wc: number; PR: number } }) {
  const W = 420, H = 260, m = { l: 48, r: 12, t: 10, b: 34 };
  const d = map.d;
  const speeds: number[] = d.NcMap.filter((n: number) => n >= 0.5);
  const lines = speeds.map((nc: number) => d.RlineMap.map((rl: number) => { const r = map.read(sc, nc * sc.sNc, rl); return { Wc: r.Wc, PR: r.PR }; }));
  const stall = speeds.map((nc: number) => { const r = map.read(sc, nc * sc.sNc, d.RlineStall); return { Wc: r.Wc, PR: r.PR }; });
  const allW = lines.flat().map((p: any) => p.Wc), allP = lines.flat().map((p: any) => p.PR);
  const xmin = 0, xmax = Math.max(...allW, op.Wc) * 1.05, ymin = 1, ymax = Math.max(...allP, op.PR) * 1.05;
  const sx = (v: number) => m.l + ((v - xmin) / (xmax - xmin)) * (W - m.l - m.r);
  const sy = (v: number) => H - m.b - ((v - ymin) / (ymax - ymin)) * (H - m.t - m.b);
  const path = (pts: { Wc: number; PR: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.Wc).toFixed(1)},${sy(p.PR).toFixed(1)}`).join('');
  const ticksX = 5, ticksY = 5;
  return (
    <div className="chart">
      <h4>{name} map</h4>
      <div className="sub">corrected flow vs pressure ratio · speed lines {Math.round(speeds[0] * 100)}–{Math.round(speeds[speeds.length - 1] * 100)} % of map design speed · {map.name} map scaled to the design point</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${name} compressor map`}>
        <g className="axis"><line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} /><line x1={m.l} x2={m.l} y1={m.t} y2={H - m.b} /></g>
        {Array.from({ length: ticksX + 1 }, (_, k) => xmin + ((xmax - xmin) * k) / ticksX).map((v) => <text key={v} x={sx(v)} y={H - m.b + 13} textAnchor="middle">{fmt(v, 0)}</text>)}
        {Array.from({ length: ticksY + 1 }, (_, k) => ymin + ((ymax - ymin) * k) / ticksY).map((v) => <text key={v} x={m.l - 5} y={sy(v) + 3.5} textAnchor="end">{fmt(v, 1)}</text>)}
        <text x={(m.l + W - m.r) / 2} y={H - 3} textAnchor="middle">corrected flow (kg/s)</text>
        <text transform={`translate(11,${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle">pressure ratio</text>
        {lines.map((pts: any, k: number) => <path key={k} d={path(pts)} fill="none" stroke="var(--series-1)" strokeOpacity={0.35 + (0.65 * k) / lines.length} strokeWidth={1.5} />)}
        {speeds.map((nc: number, k: number) => { const p = lines[k][0]; return <text key={nc} x={sx(p.Wc) - 4} y={sy(p.PR) - 3} textAnchor="end" fontSize={9}>{fmt(nc * 100, 0)}%</text>; })}
        <path d={path(stall)} fill="none" stroke="var(--bad)" strokeWidth={1.5} strokeDasharray="5 3" />
        <circle cx={sx(des.Wc)} cy={sy(des.PR)} r={5} fill="none" stroke="var(--text-primary)" strokeWidth={1.5} />
        <circle cx={sx(op.Wc)} cy={sy(op.PR)} r={5} fill="var(--series-2)" stroke="var(--surface-2)" strokeWidth={2} />
      </svg>
      <div className="legendrow">
        <span><i style={{ background: 'var(--series-1)' }} />speed lines</span><span><i style={{ background: 'var(--bad)' }} />stall line</span>
        <span><i style={{ background: 'transparent', border: '1.5px solid var(--text-primary)', borderRadius: '50%' }} />design point</span><span><i style={{ background: 'var(--series-2)', borderRadius: '50%' }} />operating point{op.Nc !== undefined ? ` · Nc ${fmt(op.Nc, 1)} % · surge margin ${fmt(op.SM ?? NaN, 1)} %` : ''}</span>
      </div>
      <div style={{ display: 'none' }}>{NcDes}</div>
    </div>
  );
}

/** Transient trajectory drawn on the first compressor map (HPC or the single compressor). */
export function MapTrajectory({ design, samples }: { design: EngineInputs; samples: TransientSample[] }) {
  const dp = useMemo(() => { try { return makeDesignPoint(design); } catch { return null; } }, [design]);
  if (!dp || samples.length < 2) return null;
  const id = dp.comps.hpc ? 'hpc' : dp.comps.comp ? 'comp' : Object.keys(dp.comps)[0];
  const cd = dp.comps[id]; if (!cd) return null;
  const W = 420, H = 260, m = { l: 48, r: 12, t: 10, b: 34 };
  const d = cd.map.d;
  const speeds: number[] = d.NcMap.filter((n: number) => n >= 0.5);
  const lines = speeds.map((nc: number) => d.RlineMap.map((rl: number) => { const r = cd.map.read(cd.sc, nc * cd.sc.sNc, rl); return { Wc: r.Wc, PR: r.PR }; }));
  const stall = speeds.map((nc: number) => { const r = cd.map.read(cd.sc, nc * cd.sc.sNc, d.RlineStall); return { Wc: r.Wc, PR: r.PR }; });
  // samples without a gas-path solution (starter-only regime) carry no map point
  const traj = samples.filter((s) => s.gasPath !== false && Number.isFinite(s.Wc?.[id]) && Number.isFinite(s.PR?.[id])).map((s) => ({ Wc: s.Wc[id], PR: s.PR[id] }));
  if (traj.length < 2) return <div className="chart"><h4>{id.toUpperCase()} running line during the transient</h4><div className="sub">no gas-path solutions to plot (starter-only regime)</div></div>;
  const allW = [...lines.flat().map((p: any) => p.Wc), ...traj.map((p) => p.Wc)], allP = [...lines.flat().map((p: any) => p.PR), ...traj.map((p) => p.PR)];
  const xmin = 0, xmax = Math.max(...allW) * 1.05, ymin = 1, ymax = Math.max(...allP) * 1.05;
  const sx = (v: number) => m.l + ((v - xmin) / (xmax - xmin)) * (W - m.l - m.r);
  const sy = (v: number) => H - m.b - ((v - ymin) / (ymax - ymin)) * (H - m.t - m.b);
  const path = (pts: { Wc: number; PR: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.Wc).toFixed(1)},${sy(p.PR).toFixed(1)}`).join('');
  return (
    <div className="chart">
      <h4>{id.toUpperCase()} running line during the transient</h4>
      <div className="sub">operating point trajectory on the scaled map · start ○ end ●</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="transient trajectory on compressor map">
        <g className="axis"><line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} /><line x1={m.l} x2={m.l} y1={m.t} y2={H - m.b} /></g>
        <text x={(m.l + W - m.r) / 2} y={H - 3} textAnchor="middle">corrected flow (kg/s)</text>
        <text transform={`translate(11,${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle">pressure ratio</text>
        {lines.map((pts: any, k: number) => <path key={k} d={path(pts)} fill="none" stroke="var(--series-1)" strokeOpacity={0.3 + (0.5 * k) / lines.length} strokeWidth={1.2} />)}
        <path d={path(stall)} fill="none" stroke="var(--bad)" strokeWidth={1.5} strokeDasharray="5 3" />
        <path d={path(traj)} fill="none" stroke="var(--series-2)" strokeWidth={2.5} strokeLinejoin="round" />
        <circle cx={sx(traj[0].Wc)} cy={sy(traj[0].PR)} r={5} fill="var(--surface-2)" stroke="var(--series-2)" strokeWidth={2} />
        <circle cx={sx(traj[traj.length - 1].Wc)} cy={sy(traj[traj.length - 1].PR)} r={5} fill="var(--series-2)" stroke="var(--surface-2)" strokeWidth={2} />
      </svg>
      <div className="legendrow"><span><i style={{ background: 'var(--series-1)' }} />speed lines</span><span><i style={{ background: 'var(--bad)' }} />stall line</span><span><i style={{ background: 'var(--series-2)' }} />trajectory</span></div>
    </div>
  );
}
