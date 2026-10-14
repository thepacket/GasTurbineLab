import { defaultInputs } from './defaults';
import { EngineInputs } from './types';

/** Map a pyCycle reference-case input record onto EngineInputs. */
export function inputsFromReferenceCase(c: any): EngineInputs {
  const i = c.inputs;
  const inp = defaultInputs(c.architecture);
  inp.flight = { altitude_m: i.alt_m, mach: i.mach, dT_isa: 0, W_kgs: i.W_kgs, altIsGeopotential: true };
  inp.inlet.ramRecovery = i.ram_recovery;
  inp.burner.T4_K = i.T4_K; inp.burner.dPqP = i.dPqP_b; inp.burner.eff = 1; inp.burner.fuel_h_Jkg = 0;
  inp.mechEff = 1; inp.HPX_W = 0;
  if (c.architecture === 'turbojet') {
    inp.inlet.MN = 0.6;
    inp.comp = { PR: i.PR, eff: i.eff_c, MN: 0.2 };
    inp.burner.MN = 0.2;
    inp.hpt = { eff: i.eff_t, MN: 0.4 };
    inp.coreNozzle = { type: 'CD', Cv: i.Cv };
    inp.afterburner.enabled = false;
  } else if (c.architecture === 'turbofan') {
    inp.inlet.MN = 0.65;
    inp.fan = { PR: i.FPR, eff: i.eff_fan, MN: 0.45 };
    inp.BPR = i.BPR;
    inp.lpc = { PR: i.LPCPR, eff: i.eff_lpc, MN: 0.35 };
    inp.hpc = { PR: i.HPCPR, eff: i.eff_hpc, MN: 0.3 };
    inp.coolInletFrac = i.cool1_fracW; inp.coolExitFrac = i.cool2_fracW;
    inp.burner.MN = 0.15;
    inp.hpt = { eff: i.eff_hpt, MN: 0.3 };
    inp.lpt = { eff: i.eff_lpt, MN: 0.35 };
    inp.coreNozzle = { type: 'CV', Cv: i.Cv };
    inp.bypNozzle = { type: 'CV', Cv: i.Cv };
    inp.bypDuct_dPqP = i.dPqP_byp;
  } else {
    inp.inlet.MN = 0.4;
    inp.comp = { PR: i.PR, eff: i.eff_c, MN: 0.25 };
    inp.burner.MN = 0.15;
    inp.hpt = { eff: i.eff_t, MN: 0.35 };
    inp.lpt = { eff: i.eff_pt, MN: 0.35 };
    inp.coreNozzle = { type: 'CV', Cv: i.Cv };
    inp.prop.shaftPower_W = i.shaft_power_W;
  }
  return inp;
}
