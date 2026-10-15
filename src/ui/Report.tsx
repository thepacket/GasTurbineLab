import { Store } from '../state/store';
import { EngineResult } from '../engine/types';
import { estimateWeight } from '../engine/weight';
import { fmt, kPa, kW } from './format';

/** Escape text for insertion into HTML. Every string that can originate from a user, a shared link or a saved design passes through this. */
export const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Build a self-contained HTML engineering report and open it for printing / saving as PDF. */
export function buildReport(result: EngineResult, store: Store, extras?: { missionHtml?: string }): string {
  const i = result.inputs;
  const p = result.perf;
  const w = (() => { try { return estimateWeight(result); } catch { return null; } })();
  const row = (k: string, v: string) => `<tr><td>${esc(k)}</td><td class="n">${esc(v)}</td></tr>`;
  const inputsRows = [
    row('Architecture', `${i.arch}${i.arch === 'turbofan' ? ` · ${i.spools} spools · ${i.mixed ? 'mixed' : 'separate'} flow${i.fanGear.ratio !== 1 ? ` · geared ${fmt(i.fanGear.ratio, 2)}` : ''}` : ''}`),
    row('Flight condition', `${fmt(i.flight.altitude_m, 0)} m · M ${fmt(i.flight.mach, 2)} · ΔT ISA ${fmt(i.flight.dT_isa, 0)} K · W ${fmt(i.flight.W_kgs, 1)} kg/s`),
    row('Fuel · chemistry', `${i.fuel ?? 'jetA'} · ${i.chemistry ?? 'equilibrium'}`),
    ...(i.arch === 'turbofan' ? [row('Fan PR · BPR', `${fmt(i.fan.PR, 3)} · ${fmt(i.BPR, 2)}`), row(i.spools === 3 ? 'IPC PR' : 'Booster PR', fmt(i.spools === 3 ? i.ipc.PR : i.lpc.PR, 3)), row('HPC PR', fmt(i.hpc.PR, 2))] : [row('Compressor PR', fmt(i.comp.PR, 2))]),
    row('T4', `${fmt(i.burner.T4_K, 0)} K`), row('Component efficiencies', i.arch === 'turbofan' ? `fan ${i.fan.eff} · booster ${i.lpc.eff} · HPC ${i.hpc.eff} · HPT ${i.hpt.eff} · LPT ${i.lpt.eff}` : `compressor ${i.comp.eff} · turbine ${i.hpt.eff}${i.arch === 'turboprop' ? ` · power turbine ${i.lpt.eff}` : ''}`),
    row('Cooling', i.cooling.mode === 'computed' ? `computed for ${i.cooling.targetMetal_K} K metal` : `${fmt(100 * i.coolInletFrac, 1)} % + ${fmt(100 * i.coolExitFrac, 1)} %`),
    ...(i.arch === 'turboprop' ? [row('Shaft power · propeller', `${kW(i.prop.shaftPower_W)} · Ø ${i.prop.diameter_m} m`)] : []),
  ].join('');
  const perfRows = (i.arch === 'turboprop' ? [row('Shaft power', kW(p.shaftPower_W)), row('Propeller thrust', `${fmt(p.propThrust / 1000, 2)} kN`), row('Jet thrust', `${fmt(p.jetThrust / 1000, 2)} kN`), row('PSFC', `${fmt(p.PSFC_kg_kWh, 3)} kg/kWh`)] : [row('Net thrust', `${fmt(p.Fn / 1000, 2)} kN`), row('TSFC', `${fmt(p.TSFC_mg_Ns, 2)} mg/(N·s) · ${fmt(p.TSFC_kg_Nh, 4)} kg/(N·h)`), row('Specific thrust', `${fmt(p.specificThrust, 1)} N·s/kg`), ...(i.installation.enabled ? [row('Installed net thrust', `${fmt(p.installedFn / 1000, 2)} kN`)] : [])])
    .concat([row('Fuel flow', `${fmt(p.Wfuel, 4)} kg/s`), row('OPR · FAR', `${fmt(p.OPR, 1)} · ${fmt(p.FAR, 4)}`), row('Thermal · propulsive · overall efficiency', `${fmt(100 * p.thermalEff, 1)} % · ${fmt(100 * p.propulsiveEff, 1)} % · ${fmt(100 * p.overallEff, 1)} %`), row('EI NOx · EI CO · CO₂', `${fmt(p.EI_NOx_g_kg, 1)} g/kg · ${fmt(p.EI_CO_g_kg, 1)} g/kg · ${fmt(p.CO2_g_s / 1000, 2)} kg/s`), row('Jet noise OASPL (1 m)', `${fmt(p.jetNoise_dB, 0)} dB`)]).join('');
  const stationRows = result.stations.map((s) => `<tr><td>${esc(s.id)}</td><td>${esc(s.name)}</td><td class="n">${kPa(s.Pt)}</td><td class="n">${fmt(s.Tt, 1)}</td><td class="n">${fmt(s.W, 2)}</td><td class="n">${kPa(s.Ps)}</td><td class="n">${fmt(s.MN, 3)}</td><td class="n">${fmt(s.V, 0)}</td><td class="n">${Number.isFinite(s.A) ? fmt(s.A, 4) : '∞'}</td></tr>`).join('');
  const compRows = result.components.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(Object.entries(c.values).map(([k, v]) => `${k.replace(/_/g, ' ')} = ${typeof v === 'number' ? (Math.abs(v) >= 1000 ? fmt(v, 0) : fmt(v, 3)) : v}`).join(' · '))}</td></tr>`).join('');
  const shaftRows = result.shafts.map((s) => row(`${s.name} (${fmt(s.rpm, 0)} rpm)`, `turbine ${kW(s.powerIn_W)} → load ${kW(s.powerOut_W)} · turbine PR ${fmt(s.turbinePR, 3)}`)).join('');
  const weightRows = w ? w.parts.map((x) => row(x.name, `${fmt(x.mass_kg, 0)} kg`)).join('') + row('Assembly mass (estimate)', `${fmt(w.total_kg, 0)} kg`) + row('Length · diameter', `${fmt(w.length_m, 2)} m · ${fmt(w.diameter_m, 2)} m`) : '';
  const svg = (document.querySelector('svg.cross')?.outerHTML ?? '').replace(/<(script|foreignObject)[\s\S]*?<\/\1>/gi, '').replace(/\son[a-z]+="[^"]*"/gi, '');
  const warn = result.warnings.map((x) => `<li>${esc(x)}</li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Gas Turbine Lab report</title>
<style>body{font-family:ui-sans-serif,system-ui,sans-serif;color:#111;margin:32px;max-width:1000px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:22px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}table{border-collapse:collapse;width:100%;font-size:12.5px}td,th{padding:4px 8px;border-bottom:1px solid #e5e5e5;text-align:left;vertical-align:top}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.meta{color:#666;font-size:12px}svg{max-width:100%;height:auto;background:#0f1113;border-radius:8px}ul{font-size:12.5px}@media print{body{margin:12mm}}</style></head><body>
<h1>Gas Turbine Lab — engineering report</h1>
<div class="meta">${esc(new Date().toLocaleString())} · ${result.offDesign ? `off-design point (${esc(result.offDesign.throttle)})` : 'design point'}${store.state.note ? ` · ${esc(store.state.note)}` : ''}</div>
${warn ? `<h2>Warnings</h2><ul>${warn}</ul>` : ''}
<h2>Inputs</h2><table>${inputsRows}</table>
<h2>Performance</h2><table>${perfRows}</table>
<h2>Shafts</h2><table>${shaftRows}</table>
${svg ? `<h2>Cross-section</h2>${svg}` : ''}
<h2>Stations</h2><table><tr><th>St.</th><th>Name</th><th>Pt kPa</th><th>Tt K</th><th>W kg/s</th><th>Ps kPa</th><th>M</th><th>V m/s</th><th>A m²</th></tr>${stationRows}</table>
<h2>Components</h2><table>${compRows}</table>
${weightRows ? `<h2>Weight and size (estimate)</h2><table>${weightRows}</table>` : ''}
${extras?.missionHtml ?? ''}
<p class="meta">Gas model: NASA CEA polynomials (janaf) with ${i.chemistry === 'frozen' ? 'frozen complete-combustion' : 'Gibbs-minimisation equilibrium'} chemistry; validated against pyCycle. Emissions, noise and weight are correlation estimates.</p>
</body></html>`;
}

export function openReport(result: EngineResult, store: Store) {
  const html = buildReport(result, store);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) { const a = document.createElement('a'); a.href = url; a.download = 'gas-turbine-lab-report.html'; a.click(); }
}
export function downloadReport(result: EngineResult, store: Store) {
  const blob = new Blob([buildReport(result, store)], { type: 'text/html' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'gas-turbine-lab-report.html'; a.click();
}
