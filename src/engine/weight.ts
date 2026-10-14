/**
 * Engine weight and size estimate from the solved geometry and cycle.
 * Component correlations follow the style of NASA WATE++ / Raymer: fan and
 * compressors scale with annulus area and stage count, turbines with inlet
 * area and temperature, the combustor with volume, the nacelle with wetted
 * area.  Coefficients were tuned so that generic engines land near published
 * dry weights (CFM56-7B ≈ 2.4 t, GE90-115B ≈ 8.3 t, PT6A-67 ≈ 0.25 t).  Estimates only.
 */
import { EngineResult } from './types';
import { buildGeometry } from '../viz/geometry';

export interface WeightBreakdown { parts: { name: string; mass_kg: number }[]; total_kg: number; length_m: number; diameter_m: number; thrustToWeight: number; powerToWeight_kW_kg: number }

export function estimateWeight(r: EngineResult): WeightBreakdown {
  const g = buildGeometry(r);
  const inp = r.inputs;
  const parts: { name: string; mass_kg: number }[] = [];
  const st = (id: string) => r.stations.find((s) => s.id === id);
  const annulus = (A: number) => A; // m²
  const PI = Math.PI;
  if (inp.arch === 'turbofan') {
    const Dfan = 2 * Math.sqrt(st('2')!.A / (PI * (1 - 0.09)));
    parts.push({ name: 'Fan rotor and case', mass_kg: 135 * Math.pow(Dfan, 2.4) });
    if (inp.fanGear.ratio !== 1) parts.push({ name: 'Fan gearbox', mass_kg: 0.09 * (r.components.find((c) => c.id === 'fan')!.values.power_W / 1000) });
    const lp = inp.spools === 3 ? 'ipc' : 'lpc';
    parts.push({ name: inp.spools === 3 ? 'IP compressor' : 'Booster', mass_kg: 55 * annulus(st('22')!.A) * (3 + (inp.spools === 3 ? 6 : 2) * Math.log(getPR(r, lp))) });
    parts.push({ name: 'HP compressor', mass_kg: 60 * annulus(st('25')!.A) * (4 + 4 * Math.log(getPR(r, 'hpc'))) * (1 + 0.5 * Math.max(0, st('3')!.Tt - 700) / 300) });
    parts.push({ name: 'Combustor', mass_kg: 180 * annulus(st('3')!.A) * 2.2 });
    parts.push({ name: 'HP turbine', mass_kg: 110 * annulus(st('4')!.A) * (1 + 0.6 * Math.log(getPR(r, 'hpt'))) * (1 + (st('4')!.Tt - 1400) / 1500) });
    if (inp.spools === 3) parts.push({ name: 'IP turbine', mass_kg: 80 * annulus(st('45')!.A) * (1 + 0.6 * Math.log(getPR(r, 'ipt'))) });
    parts.push({ name: 'LP turbine', mass_kg: 95 * annulus(st(inp.spools === 3 ? '47' : '45')!.A) * (1 + 0.9 * Math.log(getPR(r, 'lpt'))) });
    parts.push({ name: inp.mixed ? 'Mixer and nozzle' : 'Core and bypass nozzles', mass_kg: 25 * (st('9')!.A + (st('19')?.A ?? st('6')?.A ?? 0)) * 4 });
    parts.push({ name: 'Nacelle and accessories', mass_kg: 14 * PI * 2 * g.rMax * g.length + 0.0015 * r.perf.Fn });
  } else if (inp.arch === 'turbojet') {
    parts.push({ name: 'Compressor', mass_kg: 65 * annulus(st('2')!.A) * (4 + 4 * Math.log(getPR(r, 'comp'))) });
    parts.push({ name: 'Combustor', mass_kg: 180 * annulus(st('3')!.A) * 2.2 });
    parts.push({ name: 'Turbine', mass_kg: 110 * annulus(st('4')!.A) * (1 + 0.6 * Math.log(getPR(r, 'turb'))) });
    if (inp.afterburner.enabled) parts.push({ name: 'Afterburner and variable nozzle', mass_kg: 60 * st('9')!.A * 6 + 0.003 * r.perf.Fn });
    else parts.push({ name: 'Nozzle', mass_kg: 25 * st('9')!.A * 4 });
    parts.push({ name: 'Casing and accessories', mass_kg: 12 * PI * 2 * g.rMax * g.length + 0.001 * r.perf.Fn });
  } else {
    parts.push({ name: 'Compressor', mass_kg: 65 * annulus(st('2')!.A) * (4 + 4 * Math.log(getPR(r, 'comp'))) });
    parts.push({ name: 'Combustor', mass_kg: 180 * annulus(st('3')!.A) * 2.2 });
    parts.push({ name: 'Gas-generator turbine', mass_kg: 110 * annulus(st('4')!.A) * (1 + 0.6 * Math.log(getPR(r, 'turb'))) });
    parts.push({ name: 'Power turbine', mass_kg: 95 * annulus(st('45')!.A) * (1 + 0.9 * Math.log(getPR(r, 'pt'))) });
    parts.push({ name: 'Reduction gearbox', mass_kg: 0.12 * (r.perf.shaftPower_W / 1000) });
    parts.push({ name: 'Exhaust and accessories', mass_kg: 20 * st('9')!.A * 4 + 10 * PI * 2 * g.rMax * g.length });
  }
  // global calibration factor against published dry weights (structure, bearings, systems not itemised)
  for (const p of parts) p.mass_kg *= 1.5;
  const total = parts.reduce((s, p) => s + p.mass_kg, 0);
  return { parts, total_kg: total, length_m: g.length, diameter_m: 2 * g.rMax, thrustToWeight: r.perf.Fn / (total * 9.80665), powerToWeight_kW_kg: r.perf.shaftPower_W / 1000 / total };
}
const getPR = (r: EngineResult, id: string) => Math.max(1.01, r.components.find((c) => c.id === id)?.values.PR ?? 1.5);
