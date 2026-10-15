import type { CompressorMapData, TurbineMapData } from './maps';

function axis(values: number[], name: string) {
  if (!Array.isArray(values) || values.length < 2 || values.some((v, i) => !Number.isFinite(v) || v <= 0 || (i > 0 && v <= values[i - 1]))) {
    throw new Error(`${name} needs at least two finite, positive, strictly increasing coordinates.`);
  }
}
function table(values: number[][][], rows: number, cols: number, name: string) {
  if (!Array.isArray(values) || !values.length || values.some(slice => !Array.isArray(slice) || slice.length !== rows || slice.some(row => !Array.isArray(row) || row.length !== cols || row.some(v => !Number.isFinite(v) || v <= 0 || (name === 'effMap' && v > 1))))) {
    throw new Error(`${name} must contain finite positive values in [alpha][${rows}][${cols}]; efficiencies must not exceed 1.`);
  }
}
export function validateCompressor(d: CompressorMapData): CompressorMapData {
  if (!d || typeof d !== 'object') throw new Error('Invalid compressor map.');
  axis(d.NcMap, 'NcMap'); axis(d.RlineMap, 'RlineMap');
  for (const k of ['WcMap', 'PRmap', 'effMap'] as const) table(d[k], d.NcMap.length, d.RlineMap.length, k);
  const defaults = { alphaMap: 0, NcMap: d.defaults?.NcMap ?? d.NcMap[Math.floor(d.NcMap.length / 2)], RlineMap: d.defaults?.RlineMap ?? d.RlineMap[Math.floor(d.RlineMap.length / 2)], PR: d.defaults?.PR ?? 1 };
  const RlineStall = d.RlineStall ?? d.RlineMap[0];
  if (![defaults.NcMap, defaults.RlineMap, defaults.PR, RlineStall].every(v => Number.isFinite(v) && v > 0)) throw new Error('Invalid compressor map reference coordinates.');
  return { ...d, defaults, RlineStall, alphaMap: d.alphaMap ?? [0, 90] };
}
export function validateTurbine(d: TurbineMapData): TurbineMapData {
  if (!d || typeof d !== 'object') throw new Error('Invalid turbine map.');
  axis(d.NpMap, 'NpMap'); axis(d.PRmap, 'PRmap');
  for (const k of ['WpMap', 'effMap'] as const) table(d[k], d.NpMap.length, d.PRmap.length, k);
  const defaults = { alphaMap: 1, NpMap: d.defaults?.NpMap ?? d.NpMap[Math.floor(d.NpMap.length / 2)], PRmap: d.defaults?.PRmap ?? d.PRmap[Math.floor(d.PRmap.length / 2)] };
  if (![defaults.NpMap, defaults.PRmap].every(v => Number.isFinite(v) && v > 0)) throw new Error('Invalid turbine map reference coordinates.');
  return { ...d, defaults, alphaMap: d.alphaMap ?? [1, 2] };
}
