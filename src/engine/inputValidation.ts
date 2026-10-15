import type { EngineInputs } from './types';
import type { OffDesignInputs } from './offdesign';
import { isa } from './atmosphere';

const number = (value: number, name: string, low: number, high = Infinity, inclusive = false) => {
  if (!Number.isFinite(value) || (inclusive ? value < low : value <= low) || value > high) throw new Error(`Invalid ${name}: expected a finite value ${inclusive ? 'at least' : 'above'} ${low}${Number.isFinite(high) ? ` and at most ${high}` : ''}.`);
};
function flight(f: { altitude_m: number; mach: number; dT_isa: number }) {
  number(f.altitude_m, 'altitude', -2000, 86000, true);
  number(f.mach, 'Mach number', 0, 10, true);
  if (!Number.isFinite(f.dT_isa) || isa(f.altitude_m, f.dT_isa).T <= 0) throw new Error('Invalid ambient temperature.');
}
/** Input-domain checks, separate from gas-path feasibility and Newton convergence. */
export function validateEngineInputs(i: EngineInputs) {
  if (!['turbojet', 'turbofan', 'turboprop'].includes(i.arch)) throw new Error('Unknown engine architecture.');
  if (!['jetA', 'saf', 'hydrogen', 'methane'].includes(i.fuel ?? 'jetA')) throw new Error('Unknown fuel.');
  if (!['frozen', 'equilibrium'].includes(i.chemistry ?? 'equilibrium')) throw new Error('Unknown chemistry model.');
  flight(i.flight); number(i.flight.W_kgs, 'inlet mass flow', 0);
  number(i.BPR, 'bypass ratio', 0, Infinity, true);
  number(i.inlet.ramRecovery, 'inlet pressure recovery', 0, 1);
  number(i.inlet.MN, 'inlet sizing Mach', 0);
  for (const key of ['comp', 'fan', 'lpc', 'hpc', 'ipc'] as const) {
    number(i[key].PR, `${key} pressure ratio`, 1, Infinity, true);
    number(i[key].eff, `${key} efficiency`, 0, 1);
    number(i[key].MN, `${key} sizing Mach`, 0);
  }
  for (const key of ['hpt', 'lpt', 'ipt'] as const) number(i[key].eff, `${key} efficiency`, 0, 1);
  for (const key of ['burner', 'afterburner'] as const) {
    number(i[key].eff, `${key} combustion efficiency`, 0, 1);
    number(i[key].dPqP, `${key} pressure loss`, 0, 1 - Number.EPSILON, true);
  }
  number(i.burner.T4_K, 'turbine inlet temperature', 0);
  number(i.LHV_Jkg, 'fuel heating value', 0);
  number(i.mechEff, 'mechanical efficiency', 0, 1);
  number(i.coolInletFrac, 'inlet cooling fraction', 0, 1, true);
  number(i.coolExitFrac, 'exit cooling fraction', 0, 1, true);
  if (i.coolInletFrac + i.coolExitFrac >= 1) throw new Error('Cooling fractions must leave positive combustor airflow.');
  number(i.geometry.handlingBleedFrac, 'handling bleed fraction', 0, 1 - Number.EPSILON, true);
  number(i.geometry.customerBleed_kgs, 'customer bleed flow', 0, Infinity, true);
  number(i.geometry.A8scale, 'nozzle area multiplier', 0);
  number(i.speeds.HP, 'HP speed', 0);
  if (i.arch === 'turbofan') { number(i.speeds.LP, 'LP speed', 0); if (i.spools === 3) number(i.speeds.IP, 'IP speed', 0); }
  number(i.fanGear.ratio, 'fan gear ratio', 0); number(i.fanGear.eff, 'fan gearbox efficiency', 0, 1);
  if (i.arch === 'turboprop') {
    number(i.prop.diameter_m, 'propeller diameter', 0); number(i.prop.gearRatio, 'propeller gear ratio', 0);
    number(i.prop.propEff, 'propeller efficiency', 0, 1); number(i.prop.gearboxEff, 'propeller gearbox efficiency', 0, 1);
  }
  for (const key of ['coreNozzle', 'bypNozzle'] as const) { if (!['CV', 'CD'].includes(i[key].type)) throw new Error('Unknown nozzle type.'); number(i[key].Cv, `${key} velocity coefficient`, 0, 1); }
}
export function validateOperatingPoint(od: OffDesignInputs) {
  flight(od);
  if (!['T4', 'Wf', 'NHP', 'NLP', 'Fn'].includes(od.throttle.mode)) throw new Error('Unknown throttle mode.');
  number(od.throttle.value, 'throttle target', 0, Infinity, od.burnerLit === false && od.throttle.mode === 'Wf');
}
