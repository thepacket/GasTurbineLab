/** US Standard Atmosphere 1976 (geopotential layers to 86 km). SI units. */
const R_AIR = 287.05287;
const G0 = 9.80665;
const RE = 6356766; // m, effective Earth radius used by USSA76

const LAYERS: { hb: number; Tb: number; L: number }[] = [
  { hb: 0, Tb: 288.15, L: -0.0065 },
  { hb: 11000, Tb: 216.65, L: 0 },
  { hb: 20000, Tb: 216.65, L: 0.001 },
  { hb: 32000, Tb: 228.65, L: 0.0028 },
  { hb: 47000, Tb: 270.65, L: 0 },
  { hb: 51000, Tb: 270.65, L: -0.0028 },
  { hb: 71000, Tb: 214.65, L: -0.002 },
  { hb: 84852, Tb: 186.946, L: 0 },
];
const PB: number[] = [101325];
for (let i = 1; i < LAYERS.length; i++) {
  const p = LAYERS[i - 1];
  const dh = LAYERS[i].hb - p.hb;
  PB[i] = p.L === 0 ? PB[i - 1] * Math.exp((-G0 * dh) / (R_AIR * p.Tb)) : PB[i - 1] * Math.pow(p.Tb / (p.Tb + p.L * dh), G0 / (R_AIR * p.L));
}

export interface Ambient { T: number; P: number; rho: number; a: number }

/** @param altitude altitude in m (geometric unless `geopotential`). @param dT ISA temperature offset in K. pyCycle treats altitude as geopotential. */
export function isa(altitude: number, dT = 0, geopotential = false): Ambient {
  const h = geopotential ? altitude : (RE * altitude) / (RE + altitude); // geopotential
  let i = LAYERS.length - 1;
  while (i > 0 && h < LAYERS[i].hb) i--;
  const L = LAYERS[i];
  const dh = h - L.hb;
  const Tstd = L.Tb + L.L * dh;
  const P = L.L === 0 ? PB[i] * Math.exp((-G0 * dh) / (R_AIR * L.Tb)) : PB[i] * Math.pow(L.Tb / Tstd, G0 / (R_AIR * L.L));
  const T = Tstd + dT;
  return { T, P, rho: P / (R_AIR * T), a: Math.sqrt(1.4 * R_AIR * T) };
}
