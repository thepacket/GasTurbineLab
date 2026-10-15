import { useId, useState } from 'react';
import { usePlotGroup } from './PlotGroup';
import { extent, niceAxis, finitePoint, linePath, pointAtX, axisLabels } from './plotData';
import { fmt } from '../ui/format';

export interface Series { name: string; color: string; dash?: string; points: { x: number; y: number; label?: string }[] }

export function LineChart({ title, sub, series, xLabel, yLabel, xFmt, yFmt, height = 220, markers = false, labelPoints = false, xTicks }: {
  title: string; sub?: string; series: Series[]; xLabel: string; yLabel: string; xFmt?: (v: number) => string; yFmt?: (v: number) => string; height?: number; markers?: boolean; labelPoints?: boolean; xTicks?: number[];
}) {
  const W = 420, H = height, m = { l: 52, r: 14, t: 10, b: 36 };
  const valid = series.flatMap(s => s.points.filter(finitePoint));
  const X = niceAxis(...extent(valid.map(p => p.x)), 6), Y = niceAxis(...extent(valid.map(p => p.y)), 5);
  if (xTicks?.length) { X.lo = Math.min(...xTicks); X.hi = Math.max(...xTicks); if (X.lo === X.hi) { X.lo -= 0.5; X.hi += 0.5; } X.ticks = xTicks; }
  const fullX = { ...X };
  const group = usePlotGroup();
  const clipId = useId();
  const [localWindow, setLocalWindow] = useState<{ lo: number; hi: number; domain: string } | null>(null);
  const domain = `${fullX.lo}:${fullX.hi}`;
  const window = group ? group.window?.axis === xLabel ? group.window : null : localWindow?.domain === domain ? localWindow : null;
  if (window && window.lo >= fullX.lo && window.hi <= fullX.hi) {
    X.lo = window.lo; X.hi = window.hi;
    X.ticks = xTicks ? xTicks.filter(x => x >= X.lo && x <= X.hi) : niceAxis(X.lo, X.hi, 6).ticks.filter(x => x >= X.lo && x <= X.hi);
  }
  const sx = (v: number) => m.l + ((v - X.lo) / (X.hi - X.lo)) * (W - m.l - m.r);
  const sy = (v: number) => H - m.b - ((v - Y.lo) / (Y.hi - Y.lo)) * (H - m.t - m.b);
  const [hover, setHover] = useState<{ x: number; points: typeof series } | null>(null);
  const fx = xFmt ?? ((v) => fmt(v, 2)), fy = yFmt ?? ((v) => fmt(v, 2));
  const xLabels = axisLabels(X.ticks, fx), yLabels = axisLabels(Y.ticks, fy);
  const sharedX = group?.cursor?.axis === xLabel ? group.cursor.x : null;
  const hx = group ? sharedX : hover?.points === series ? hover.x : null;
  const hovered = hx !== null && hx >= X.lo && hx <= X.hi ? { x: hx } : null;
  const select = (x: number | null) => { if (group) group.setCursor(x === null ? null : { axis: xLabel, x }); else setHover(x === null ? null : { x, points: series }); };
  const zoom = (factor: number) => {
    const width = Math.min(fullX.hi - fullX.lo, (X.hi - X.lo) * factor);
    const center = hovered?.x ?? (X.lo + X.hi) / 2;
    const lo = Math.max(fullX.lo, Math.min(center - width / 2, fullX.hi - width));
    if (group) group.setWindow({ axis: xLabel, lo, hi: lo + width });
    else setLocalWindow({ lo, hi: lo + width, domain });
  };
  const reset = () => { if (group) group.setWindow(null); else setLocalWindow(null); };
  const onKey = (event: React.KeyboardEvent<SVGSVGElement>) => {
    const xs = [...new Set(valid.map(p => p.x))].filter(x => x >= X.lo && x <= X.hi).sort((a, b) => a - b);
    if (!xs.length) return;
    if (event.key === 'Escape') { select(null); reset(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = hovered ? xs.findIndex(x => x >= hovered.x) : -1;
    select(event.key === 'Home' ? xs[0] : event.key === 'End' ? xs.at(-1)! : xs[Math.max(0, Math.min(xs.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)))]);
  };
  const dash = (s: Series, i: number) => s.dash ?? ['', '6 3', '2 3', '8 3 2 3'][i % 4];
  const annotations: { point: Series['points'][number]; x: number; y: number; width: number }[] = [];
  if (labelPoints) for (const point of valid) {
    if (!point.label || point.x < X.lo || point.x > X.hi) continue;
    const width = point.label.length * 6 + 4;
    const x = Math.min(W - width - 2, sx(point.x) + 6);
    let y = Math.max(12, sy(point.y) - 6);
    // Keep nearby station labels readable; leaders retain their exact station association.
    for (let attempt = 0; attempt < 30 && annotations.some(a => Math.abs(a.y - y) < 12 && x < a.x + a.width && x + width > a.x); attempt++) y = y > 24 ? y - 12 : Math.min(H - m.b - 2, sy(point.y) + 18 + attempt * 12);
    annotations.push({ point, x, y, width });
  }
  const tipWidth = Math.min(W - 8, Math.max(142, ...series.map(s => 24 + 6 * (s.name.length + 18))));
  const tipHeight = 14 + 13 * series.length;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const xv = X.lo + ((e.clientX - r.left) / r.width * W - m.l) / (W - m.l - m.r) * (X.hi - X.lo);
    const visible = valid.filter(p => p.x >= X.lo && p.x <= X.hi);
    if (!visible.length) return;
    const nearest = visible.reduce((best, p) => Math.abs(p.x - xv) < Math.abs(best.x - xv) ? p : best);
    select(nearest.x);
  };
  return (
    <div className="chart">
      <div className="chart-heading"><h4>{title}</h4>{valid.length > 1 && <div className="plot-tools">
        <button className="iconbtn" aria-label={`Zoom in ${title}`} title="Zoom in" disabled={X.hi - X.lo < (fullX.hi - fullX.lo) / 64} onClick={() => zoom(0.5)}>+</button>
        <button className="iconbtn" aria-label={`Zoom out ${title}`} title="Zoom out" disabled={!window} onClick={() => zoom(2)}>−</button>
        <button className="iconbtn" aria-label={`Reset zoom ${title}`} title="Reset zoom" disabled={!window} onClick={reset}>↺</button>
      </div>}</div>{sub && <div className="sub">{sub}</div>}
      {!valid.length ? <div className="sub">No valid data to plot.</div> : <svg viewBox={`0 0 ${W} ${H}`} tabIndex={0} onPointerMove={onMove} onPointerLeave={e => { if (e.pointerType === 'mouse' && !document.activeElement?.matches('.chart svg')) select(null); }} onKeyDown={onKey} onBlur={() => select(null)} role="img" aria-label={title}>
        <defs><clipPath id={clipId}><rect x={m.l - 5} y={m.t - 5} width={W - m.l - m.r + 10} height={H - m.t - m.b + 10} /></clipPath></defs>
        <g className="grid">{Y.ticks.map((t) => <line key={t} x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} />)}</g>
        <g className="axis"><line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} /><line x1={m.l} x2={m.l} y1={m.t} y2={H - m.b} /></g>
        {X.ticks.map((t, i) => <text key={t} x={sx(t)} y={H - m.b + 14} textAnchor="middle">{xLabels[i]}</text>)}
        {Y.ticks.map((t, i) => <text key={t} x={m.l - 6} y={sy(t) + 3.5} textAnchor="end">{yLabels[i]}</text>)}
        <text x={(m.l + W - m.r) / 2} y={H - 4} textAnchor="middle">{xLabel}</text>
        <text transform={`translate(12,${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>
        {series.map((s, index) => (
          <g key={s.name} clipPath={`url(#${clipId})`}>
            <path d={linePath(s.points, sx, sy)} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={dash(s, index)} strokeLinejoin="round" />
            {s.points.map((p, i) => finitePoint(p) && (markers || labelPoints || ((!s.points[i - 1] || !finitePoint(s.points[i - 1])) && (!s.points[i + 1] || !finitePoint(s.points[i + 1])))) && (
              <g key={i}>
                <circle cx={sx(p.x)} cy={sy(p.y)} r={4} fill={s.color} stroke="var(--surface-2)" strokeWidth={2} />
              </g>
            ))}
          </g>
        ))}
        {annotations.map((a, i) => <g key={i}>
          {Math.abs(a.y - (sy(a.point.y) - 6)) > 1 && <line x1={sx(a.point.x)} y1={sy(a.point.y)} x2={a.x} y2={a.y - 3} stroke="var(--text-muted)" strokeWidth={0.5} />}
          <text className="ptlabel" x={a.x} y={a.y}>{a.point.label}</text>
        </g>)}
        {hovered && (
          <g className="plot-inspection" data-x={hovered.x} pointerEvents="none">
            <line x1={sx(hovered.x)} x2={sx(hovered.x)} y1={m.t} y2={H - m.b} stroke="var(--line-strong)" />
            {series.map((s) => { const p = pointAtX(s.points, hovered.x); return p && Number.isFinite(p.y) ? <circle key={s.name} cx={sx(p.x)} cy={sy(p.y)} r={4.5} fill={s.color} stroke="var(--surface-2)" strokeWidth={2} /> : null; })}
            <g transform={`translate(${Math.max(4, Math.min(sx(hovered.x) + 8, W - tipWidth - 4))},${Math.max(4, Math.min(m.t + 4, H - tipHeight - 4))})`}>
              <rect width={tipWidth} height={tipHeight} rx={5} fill="var(--surface-1)" stroke="var(--line-strong)" />
              <text x={6} y={11} fill="var(--text-primary)">{xLabel.split(' ')[0]} {fx(hovered.x)}</text>
              {series.map((s, k) => <text key={s.name} x={6} y={24 + 13 * k}><tspan fill={s.color}>■</tspan> {s.name} {(() => { const p = pointAtX(s.points, hovered.x); return p ? `${p.label ? p.label + ': ' : ''}${fy(p.y)}` : '–'; })()}</text>)}
            </g>
          </g>
        )}
      </svg>}
      {series.length > 1 && <div className="legendrow">{series.map((s, i) => <span key={s.name}><i className="line-swatch" style={{ borderColor: s.color, borderTopStyle: dash(s, i) ? 'dashed' : 'solid' }} />{s.name}</span>)}</div>}
    </div>
  );
}
