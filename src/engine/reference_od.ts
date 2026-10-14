/** Inputs reproducing the pyCycle off-design / mixed-flow reference cases (src/data/pycycle_offdesign.json). */
import ref from '../data/pycycle_offdesign.json';
import { defaultInputs } from './defaults';
import { EngineInputs } from './types';
const R = ref as any;

export function turbojetInputs(): EngineInputs {
  const c = R.turbojet.inputs; const inp = defaultInputs('turbojet');
  inp.flight = { altitude_m: c.alt_m, mach: c.mach, dT_isa: 0, W_kgs: c.W_kgs, altIsGeopotential: true };
  inp.inlet = { ramRecovery: 0.99, MN: 0.6 }; inp.comp = { PR: c.PR, eff: c.eff_c, MN: 0.2 }; inp.burner = { ...inp.burner, T4_K: c.T4_K, dPqP: 0.03, eff: 1, fuel_h_Jkg: 0, MN: 0.2 };
  inp.hpt = { eff: c.eff_t, MN: 0.4 }; inp.coreNozzle = { type: 'CD', Cv: 0.99 }; inp.mechEff = 1; inp.HPX_W = 0; inp.coolInletFrac = 0; inp.coolExitFrac = 0; inp.cooling.mode = 'fixed';
  inp.speeds = { LP: 8070, IP: 8070, HP: 8070, PT: 8070 }; inp.chemistry = 'equilibrium'; inp.fuel = 'jetA'; inp.humidity = { relative: 0 };
  return inp;
}
export function hbtfInputs(): EngineInputs {
  const c = R.hbtf.inputs; const inp = defaultInputs('turbofan');
  inp.flight = { altitude_m: c.alt_m, mach: c.mach, dT_isa: 0, W_kgs: c.W_kgs, altIsGeopotential: true };
  inp.inlet = { ramRecovery: 0.995, MN: 0.65 }; inp.fan = { PR: c.FPR, eff: c.eff_fan, MN: 0.45 }; inp.BPR = c.BPR;
  inp.lpc = { PR: c.LPCPR, eff: c.eff_lpc, MN: 0.35 }; inp.hpc = { PR: c.HPCPR, eff: c.eff_hpc, MN: 0.3 }; inp.spools = 2; inp.mixed = false;
  inp.coolInletFrac = 0.05; inp.coolExitFrac = 0.02; inp.cooling.mode = 'fixed';
  inp.burner = { ...inp.burner, T4_K: c.T4_K, dPqP: 0.04, eff: 1, fuel_h_Jkg: 0, MN: 0.15 };
  inp.hpt = { eff: c.eff_hpt, MN: 0.3 }; inp.lpt = { eff: c.eff_lpt, MN: 0.35 };
  inp.coreNozzle = { type: 'CV', Cv: 0.995 }; inp.bypNozzle = { type: 'CV', Cv: 0.995 }; inp.bypDuct_dPqP = 0.01; inp.mechEff = 1; inp.HPX_W = 0; inp.fanGear = { ratio: 1, eff: 1 };
  inp.speeds = { LP: 4666.1, IP: 8000, HP: 14705.7, PT: 0 }; inp.chemistry = 'equilibrium'; inp.fuel = 'jetA'; inp.humidity = { relative: 0 };
  return inp;
}
export function mixedInputs(): EngineInputs {
  const c = R.mixed.inputs; const inp = hbtfInputs();
  inp.flight = { altitude_m: c.alt_m, mach: c.mach, dT_isa: 0, W_kgs: c.W_kgs, altIsGeopotential: true };
  inp.inlet = { ramRecovery: 0.98, MN: 0.6 }; inp.fan = { PR: c.FPR, eff: c.eff_fan, MN: 0.45 }; inp.BPR = c.BPR;
  inp.lpc = { PR: c.LPCPR, eff: c.eff_lpc, MN: 0.35 }; inp.hpc = { PR: c.HPCPR, eff: c.eff_hpc, MN: 0.3 };
  inp.coolInletFrac = 0.04; inp.coolExitFrac = 0.02; inp.burner = { ...inp.burner, T4_K: c.T4_K, dPqP: 0.04, eff: 1, fuel_h_Jkg: 0, MN: 0.15 };
  inp.hpt = { eff: c.eff_hpt, MN: 0.3 }; inp.lpt = { eff: c.eff_lpt, MN: 0.35 }; inp.bypDuct_dPqP = 0.015;
  inp.mixed = true; inp.mixer = { MNcore: 0.35, dPqP: 0, designedStream: 'core', MNbyp: 0.45 }; inp.coreNozzle = { type: 'CV', Cv: 0.99 };
  return inp;
}

