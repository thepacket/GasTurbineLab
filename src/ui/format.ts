export const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }) : '–');
export const fmtSig = (v: number, s = 3) => (Number.isFinite(v) ? Number(v.toPrecision(s)).toLocaleString() : '–');
export const kPa = (pa: number) => fmt(pa / 1000, pa > 1e6 ? 0 : 1);
export const kN = (n: number) => fmt(n / 1000, Math.abs(n) > 1e5 ? 1 : 2);
export const kW = (w: number) => (Math.abs(w) >= 1e6 ? fmt(w / 1e6, 2) + ' MW' : fmt(w / 1e3, 0) + ' kW');
export const pct = (x: number, d = 1) => fmt(x * 100, d) + ' %';
