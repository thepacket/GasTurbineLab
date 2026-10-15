/** Numerical helpers shared by plots. Keep invalid samples as breaks, not interpolated data. */
export interface PlotPoint { x: number; y: number; label?: string }
export const finitePoint = (p: PlotPoint) => Number.isFinite(p.x) && Number.isFinite(p.y);
export function extent(values: number[], fallback: [number, number] = [0, 1]): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return lo === Infinity ? fallback : [lo, hi];
}
export function niceAxis(lo: number, hi: number, n = 5) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (!(hi > lo)) { const pad = Math.max(Math.abs(lo) * 0.05, 1e-6); lo -= pad; hi += pad; }
  const step0 = 10 ** Math.floor(Math.log10((hi - lo) / n));
  const step = [1, 2, 2.5, 5, 10].map(m => m * step0).find(s => (hi - lo) / s <= n) ?? step0 * 10;
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
  // Integer iteration avoids nontermination and enormous tick lists at small spans.
  const count = Math.min(100, Math.round((b - a) / step));
  return { lo: a, hi: b, ticks: Array.from({ length: count + 1 }, (_, i) => Number((a + i * step).toPrecision(14))) };
}
export function linePath(points: PlotPoint[], sx: (v: number) => number, sy: (v: number) => number) {
  return points.map((p, i) => finitePoint(p) ? `${i > 0 && finitePoint(points[i - 1]) ? 'L' : 'M'}${sx(p.x).toFixed(3)},${sy(p.y).toFixed(3)}` : '').join('');
}
/** A common x cursor must never pair values just because they have the same array index. */
export function pointAtX(points: PlotPoint[], x: number) { return points.find(p => p.x === x && finitePoint(p)); }
export function axisLabels(ticks: number[], format: (v: number) => string) {
  const labels = ticks.map(format);
  if (new Set(labels).size === labels.length) return labels;
  for (let precision = 3; precision <= 17; precision++) {
    const precise = ticks.map(v => Number(v.toPrecision(precision)).toString());
    if (new Set(precise).size === precise.length) return precise;
  }
  return ticks.map(String);
}
