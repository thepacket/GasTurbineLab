export type Architecture = 'turbojet' | 'turbofan' | 'turboprop';
export type NozzleType = 'CV' | 'CD';

export interface FlightInputs {
  altitude_m: number;
  mach: number;
  dT_isa: number; // K
  W_kgs: number; // total engine inlet mass flow
  altIsGeopotential?: boolean; // pyCycle convention
}
export interface CompressorInputs { PR: number; eff: number; MN: number }
export interface TurbineInputs { eff: number; MN: number }
export interface BurnerInputs {
  T4_K: number;
  dPqP: number;
  eff: number; // combustion efficiency (fraction of fuel energy released)
  fuel_h_Jkg: number; // absolute enthalpy of the fuel as supplied (pyCycle default 0)
  MN: number;
}
export interface NozzleInputs { type: NozzleType; Cv: number }

export interface EngineInputs {
  arch: Architecture;
  flight: FlightInputs;
  inlet: { ramRecovery: number; MN: number };
  /** Single compressor (turbojet / turboprop) */
  comp: CompressorInputs;
  /** Turbofan components */
  fan: CompressorInputs;
  BPR: number;
  lpc: CompressorInputs;
  hpc: CompressorInputs;
  /** fraction of HPC inlet flow bled at HPC exit, returned to HPT at inlet (does work) / exit (no work) */
  coolInletFrac: number;
  coolExitFrac: number;
  burner: BurnerInputs;
  hpt: TurbineInputs; // turbojet: the only turbine; turboprop: gas-generator turbine
  lpt: TurbineInputs; // turbofan LPT; turboprop power turbine
  mechEff: number; // shaft mechanical efficiency
  HPX_W: number; // customer power extraction on HP shaft
  coreNozzle: NozzleInputs;
  bypNozzle: NozzleInputs;
  bypDuct_dPqP: number;
  /** Turbojet afterburner */
  afterburner: { enabled: boolean; T7_K: number; dPqP: number; eff: number };
  /** Turboprop */
  prop: {
    shaftPower_W: number; // required delivered shaft power (power turbine output)
    gearboxEff: number;
    propEff: number; // profile/aerodynamic efficiency factor (induced losses computed by actuator-disc theory)
    diameter_m: number;
  };
  /** lower heating value used only for efficiency reporting */
  LHV_Jkg: number;
}

export interface Station {
  id: string; // SAE ARP755 station number
  name: string;
  Pt: number; Tt: number; ht: number; s: number;
  W: number; FAR: number;
  Ps: number; Ts: number; V: number; MN: number; A: number;
  gamma: number; cp: number; R: number;
  /** position along the cross-section, 0..1 */
  x: number;
  stream: 'core' | 'bypass' | 'ambient';
}

export interface ComponentResult {
  id: string;
  kind: 'inlet' | 'compressor' | 'splitter' | 'duct' | 'burner' | 'turbine' | 'nozzle' | 'shaft' | 'propeller' | 'afterburner';
  name: string;
  values: Record<string, number>;
}

export interface Performance {
  Fn: number; Fg: number; ramDrag: number; // N
  Fg_core: number; Fg_byp: number;
  TSFC_kg_Nh: number; // kg/(N h)
  TSFC_mg_Ns: number;
  Wfuel: number;
  specificThrust: number; // N/(kg/s)
  OPR: number;
  FAR: number;
  thermalEff: number; propulsiveEff: number; overallEff: number;
  V0: number;
  // turboprop
  shaftPower_W: number; propThrust: number; jetThrust: number; ESHP_W: number; PSFC_kg_kWh: number;
  heatRate_W: number;
}

export interface EngineResult {
  inputs: EngineInputs;
  stations: Station[];
  components: ComponentResult[];
  perf: Performance;
  warnings: string[];
  shafts: { name: string; powerIn_W: number; powerOut_W: number; turbinePR: number }[];
}
