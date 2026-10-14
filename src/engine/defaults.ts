import { Architecture, EngineInputs } from './types';

export function defaultInputs(arch: Architecture): EngineInputs {
  const base: EngineInputs = {
    arch,
    flight: { altitude_m: 0, mach: 0, dT_isa: 0, W_kgs: 50 },
    inlet: { ramRecovery: 0.99, MN: 0.6 },
    comp: { PR: 13.5, eff: 0.86, MN: 0.2 },
    fan: { PR: 1.6, eff: 0.9, MN: 0.45 },
    BPR: 6,
    lpc: { PR: 1.9, eff: 0.89, MN: 0.35 },
    hpc: { PR: 11, eff: 0.87, MN: 0.3 },
    coolInletFrac: 0.05,
    coolExitFrac: 0.02,
    burner: { T4_K: 1500, dPqP: 0.03, eff: 1.0, fuel_h_Jkg: 0, MN: 0.2 },
    hpt: { eff: 0.9, MN: 0.4 },
    lpt: { eff: 0.91, MN: 0.35 },
    mechEff: 1.0,
    HPX_W: 0,
    coreNozzle: { type: 'CD', Cv: 0.99 },
    bypNozzle: { type: 'CV', Cv: 0.995 },
    bypDuct_dPqP: 0.01,
    afterburner: { enabled: false, T7_K: 2000, dPqP: 0.05, eff: 0.95 },
    prop: { shaftPower_W: 1.4e6, gearboxEff: 0.985, propEff: 0.9, diameter_m: 3.9 },
    LHV_Jkg: 43.0e6,
  };
  if (arch === 'turbofan') {
    base.flight = { altitude_m: 11000, mach: 0.8, dT_isa: 0, W_kgs: 170 };
    base.inlet = { ramRecovery: 0.995, MN: 0.65 };
    base.fan = { PR: 1.65, eff: 0.91, MN: 0.45 };
    base.BPR = 8;
    base.lpc = { PR: 2.0, eff: 0.89, MN: 0.35 };
    base.hpc = { PR: 12, eff: 0.87, MN: 0.3 };
    base.burner = { T4_K: 1550, dPqP: 0.04, eff: 1.0, fuel_h_Jkg: 0, MN: 0.15 };
    base.hpt = { eff: 0.89, MN: 0.3 };
    base.lpt = { eff: 0.91, MN: 0.35 };
    base.coreNozzle = { type: 'CV', Cv: 0.995 };
  } else if (arch === 'turboprop') {
    base.flight = { altitude_m: 0, mach: 0, dT_isa: 0, W_kgs: 7 };
    base.inlet = { ramRecovery: 0.99, MN: 0.4 };
    base.comp = { PR: 10, eff: 0.83, MN: 0.25 };
    base.burner = { T4_K: 1350, dPqP: 0.04, eff: 1.0, fuel_h_Jkg: 0, MN: 0.15 };
    base.hpt = { eff: 0.88, MN: 0.35 };
    base.lpt = { eff: 0.9, MN: 0.35 };
    base.coreNozzle = { type: 'CV', Cv: 0.98 };
  }
  return base;
}
