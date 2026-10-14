import { EngineInputs } from './types';
import { defaultInputs } from './defaults';
import ref from '../data/pycycle_reference.json';
import { inputsFromReferenceCase } from './reference';

export interface Preset { name: string; group: string; inputs: EngineInputs }

function tj(name: string, mod: (i: EngineInputs) => void): Preset {
  const inputs = defaultInputs('turbojet'); mod(inputs); return { name, group: 'Turbojet', inputs };
}
function tf(name: string, mod: (i: EngineInputs) => void): Preset {
  const inputs = defaultInputs('turbofan'); mod(inputs); return { name, group: 'Turbofan', inputs };
}
function tp(name: string, mod: (i: EngineInputs) => void): Preset {
  const inputs = defaultInputs('turboprop'); mod(inputs); return { name, group: 'Turboprop', inputs };
}

export const PRESETS: Preset[] = [
  tj('1950s single-spool turbojet, take-off', (i) => { i.flight = { altitude_m: 0, mach: 0, dT_isa: 0, W_kgs: 75 }; i.comp = { PR: 7, eff: 0.84, MN: 0.3 }; i.burner.T4_K = 1150; i.hpt.eff = 0.88; i.coreNozzle = { type: 'CV', Cv: 0.98 }; }),
  tj('Afterburning turbojet, M1.6 at 12 km', (i) => { i.flight = { altitude_m: 12000, mach: 1.6, dT_isa: 0, W_kgs: 70 }; i.inlet.ramRecovery = 0.95; i.comp = { PR: 12, eff: 0.86, MN: 0.3 }; i.burner.T4_K = 1550; i.afterburner = { enabled: true, T7_K: 2050, dPqP: 0.06, eff: 0.92 }; i.coreNozzle = { type: 'CD', Cv: 0.985 }; }),
  tj('Supersonic cruise M2.0 at 15 km', (i) => { i.flight = { altitude_m: 15000, mach: 2.0, dT_isa: 0, W_kgs: 30 }; i.inlet.ramRecovery = 0.92; i.comp = { PR: 8, eff: 0.85, MN: 0.2 }; i.burner.T4_K = 1600; i.coreNozzle = { type: 'CD', Cv: 0.98 }; }),
  tf('High-bypass civil turbofan, cruise M0.8 at 11 km', () => {}),
  tf('High-bypass civil turbofan, take-off', (i) => { i.flight = { altitude_m: 0, mach: 0, dT_isa: 15, W_kgs: 420 }; i.fan.PR = 1.6; i.BPR = 6; i.lpc.PR = 1.9; i.hpc.PR = 11; i.burner.T4_K = 1650; }),
  tf('Ultra-high-bypass geared fan, cruise', (i) => { i.flight = { altitude_m: 11000, mach: 0.78, dT_isa: 0, W_kgs: 220 }; i.fan = { PR: 1.4, eff: 0.93, MN: 0.5 }; i.BPR = 12; i.lpc.PR = 2.8; i.hpc.PR = 14; i.burner.T4_K = 1600; i.coolInletFrac = 0.08; i.coolExitFrac = 0.03; }),
  tf('Low-bypass military turbofan, M0.9 at 9 km', (i) => { i.flight = { altitude_m: 9000, mach: 0.9, dT_isa: 0, W_kgs: 80 }; i.inlet.ramRecovery = 0.98; i.fan = { PR: 3.0, eff: 0.87, MN: 0.45 }; i.BPR = 0.8; i.lpc = { PR: 1.5, eff: 0.87, MN: 0.35 }; i.hpc = { PR: 6, eff: 0.86, MN: 0.3 }; i.burner.T4_K = 1700; i.coolInletFrac = 0.04; i.coreNozzle = { type: 'CD', Cv: 0.99 }; i.bypNozzle = { type: 'CD', Cv: 0.99 }; }),
  tp('Regional turboprop, take-off', () => {}),
  tp('Regional turboprop, cruise M0.45 at 7.6 km', (i) => { i.flight = { altitude_m: 7600, mach: 0.45, dT_isa: 0, W_kgs: 4.5 }; i.comp.PR = 11; i.burner.T4_K = 1300; i.prop.shaftPower_W = 0.9e6; }),
  tp('Small turboprop (PT6-class), take-off', (i) => { i.flight = { altitude_m: 0, mach: 0, dT_isa: 0, W_kgs: 3.3 }; i.comp = { PR: 8, eff: 0.80, MN: 0.25 }; i.burner.T4_K = 1250; i.hpt.eff = 0.87; i.lpt.eff = 0.88; i.prop = { shaftPower_W: 0.5e6, gearboxEff: 0.98, propEff: 0.88, diameter_m: 2.4 }; }),
];

export const REFERENCE_PRESETS: Preset[] = (ref as any).cases.filter((c: any) => !c.error).map((c: any) => ({
  name: `pyCycle: ${c.inputs.name}`, group: 'pyCycle reference', inputs: inputsFromReferenceCase(c),
}));
