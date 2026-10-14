import { useState } from 'react';
import { fmt } from '../ui/format';

export interface Series { name: string; color: string; points: { x: number; y: number; label?: string }[] }

const nice = (lo: number, hi: number, n = 5) => {
  if (!(hi > lo)) { hi = lo + 1; }
  const span = hi - lo, step0 = Math.pow(10, Math.floor(Math.log10(span / n)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * step0).find((s) => span / s <= n) ?? step0 * 10;
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = a; v <= b + 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  return { lo: a, hi: b, ticks };
};

export function LineChart({ title, sub, series, xLabel, yLabel, xFmt, yFmt, height = 220, markers = false, labelPoints = false }: {
  title: string; sub?: string; series: Series[]; xLabel: string; yLabel: string; xFmt?: (v: number) => string; yFmt?: (v: number) => string; height?: number; markers?: boolean; labelPoints?: boolean;
}) {
  const W = 420, H = height, m = { l: 52, r: 14, t: 10, b: 36 };
  const xs = series.flatMap((s) => s.points.map((p) => p.x)), ys = series.flatMap((s) => s.points.map((p) => p.y)).filter(Number.isFinite);
  const X = nice(Math.min(...xs), Math.max(...xs), 6), Y = nice(Math.min(...ys), Math.max(...ys), 5);
  const sx = (v: number) => m.l + ((v - X.lo) / (X.hi - X.lo)) * (W - m.l - m.r);
  const sy = (v: number) => H - m.b - ((v - Y.lo) / (Y.hi - Y.lo)) * (H - m.t - m.b);
  const [hover, setHover] = useState<{ i: number; x: number } | null>(null);
  const fx = xFmt ?? ((v) => fmt(v, 2)), fy = yFmt ?? ((v) => fmt(v, 2));
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const xv = X.lo + ((e.clientX - r.left) / r.width * W - m.l) / (W - m.l - m.r) * (X.hi - X.lo);
    const pts = series[0].points; let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].x - xv) < Math.abs(pts[best].x - xv)) best = i;
    setHover({ i: best, x: pts[best].x });
  };
  return (
    <div className="chart">
      <h4>{title}</h4>{sub && <div className="sub">{sub}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={title}>
        <g className="grid">{Y.ticks.map((t) => <line key={t} x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} />)}</g>
        <g className="axis"><line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} /><line x1={m.l} x2={m.l} y1={m.t} y2={H - m.b} /></g>
        {X.ticks.map((t) => <text key={t} x={sx(t)} y={H - m.b + 14} textAnchor="middle">{fx(t)}</text>)}
        {Y.ticks.map((t) => <text key={t} x={m.l - 6} y={sy(t) + 3.5} textAnchor="end">{fy(t)}</text>)}
        <text x={(m.l + W - m.r) / 2} y={H - 4} textAnchor="middle">{xLabel}</text>
        <text transform={`translate(12,${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>
        {series.map((s) => (
          <g key={s.name}>
            <path d={s.points.filter((p) => Number.isFinite(p.y)).map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('')} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
            {(markers || labelPoints) && s.points.map((p, i) => Number.isFinite(p.y) && (
              <g key={i}>
                <circle cx={sx(p.x)} cy={sy(p.y)} r={4} fill={s.color} stroke="var(--surface-2)" strokeWidth={2} />
                {labelPoints && p.label && <text className="ptlabel" x={sx(p.x) + 6} y={sy(p.y) - 6}>{p.label}</text>}
              </g>
            ))}
          </g>
        ))}
        {hover && (
          <g>
            <line x1={sx(hover.x)} x2={sx(hover.x)} y1={m.t} y2={H - m.b} stroke="var(--line-strong)" />
            {series.map((s) => { const p = s.points[hover.i]; return p && Number.isFinite(p.y) ? <circle key={s.name} cx={sx(p.x)} cy={sy(p.y)} r={4.5} fill={s.color} stroke="var(--surface-2)" strokeWidth={2} /> : null; })}
            <g transform={`translate(${Math.min(sx(hover.x) + 8, W - 150)},${m.t + 4})`}>
              <rect width={142} height={14 + 13 * series.length} rx={5} fill="var(--surface-1)" stroke="var(--line-strong)" />
              <text x={6} y={11} fill="var(--text-primary)">{xLabel.split(' ')[0]} {fx(hover.x)}</text>
              {series.map((s, k) => <text key={s.name} x={6} y={24 + 13 * k}><tspan fill={s.color}>■</tspan> {s.name} {Number.isFinite(s.points[hover.i]?.y) ? fy(s.points[hover.i].y) : '–'}</text>)}
            </g>
          </g>
        )}
      </svg>
      {series.length > 1 && <div className="legendrow">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>}
    </div>
  );
}
