/** Perceptually ordered thermal ramp (monotonic lightness) for gas temperature. */
const STOPS: [number, string][] = [
  [0, '#1c2a4a'], [0.2, '#2a4f8f'], [0.4, '#4e7fb6'], [0.55, '#b58a4a'], [0.7, '#d95926'], [0.85, '#f2a541'], [1, '#fbe7a1'],
];
function hex(c: string) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
export function thermal(t: number): string {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < STOPS.length; i++) {
    if (x <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
      const f = (x - a) / (b - a);
      const A = hex(ca), B = hex(cb);
      const m = A.map((v, k) => Math.round(v + (B[k] - v) * f));
      return `rgb(${m[0]},${m[1]},${m[2]})`;
    }
  }
  return STOPS[STOPS.length - 1][1];
}
export const T_MIN = 200, T_MAX = 2100;
export const tempColor = (T: number) => thermal((T - T_MIN) / (T_MAX - T_MIN));
export const thermalGradient = `linear-gradient(90deg, ${STOPS.map(([p, c]) => `${c} ${p * 100}%`).join(', ')})`;
