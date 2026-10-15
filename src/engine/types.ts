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
  lpc: CompressorInputs; // booster on the LP shaft (2-spool)
  hpc: CompressorInputs;
  /** three-spool layout: fan on LP, IPC/IPT on an intermediate shaft, HPC/HPT on HP */
  spools: 2 | 3;
  ipc: CompressorInputs;
  ipt: TurbineInputs;
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
  /** mixed-flow turbofan: bypass and core streams join in a constant-area mixer ahead of one nozzle */
  mixed: boolean;
  mixer: { MNcore: number; dPqP: number; designedStream?: 'core' | 'bypass'; MNbyp?: number }; // designedStream: which stream's Mach is specified; the other matches its static pressure
  /** fan drive gearbox (ratio 1 = direct drive) */
  fanGear: { ratio: number; eff: number };
  /** design shaft speeds, rpm (for corrected-speed bookkeeping and off-design maps) */
  speeds: { LP: number; IP: number; HP: number; PT: number };
  /** Afterburner (turbojet, mixed turbofan) */
  afterburner: { enabled: boolean; T7_K: number; dPqP: number; eff: number };
  /** Turboprop */
  prop: {
    shaftPower_W: number; // required delivered shaft power (power turbine output)
    gearboxEff: number;
    gearRatio: number; // power-turbine rpm / propeller rpm
    propEff: number; // profile/aerodynamic efficiency factor (induced losses computed by actuator-disc theory)
    diameter_m: number;
  };
  /** lower heating value used only for efficiency reporting */
  LHV_Jkg: number;
  /** gas chemistry: CEA-style equilibrium (default) or frozen complete combustion */
  chemistry?: 'equilibrium' | 'frozen';
  /** variable geometry and bleeds (design values; off-design overrides in OffDesignInputs) */
  geometry: {
    customerBleed_kgs: number; // extracted at HPC exit, not returned
    handlingBleedFrac: number; // fraction of booster/LPC exit flow dumped (to bypass duct, or overboard on a turbojet/turboprop)
    A8scale: number; // exhaust-nozzle throat area multiplier relative to the design throat (variable-area nozzle)
    vsvFlowGain: number; // variable stator effect: map corrected-flow multiplier = 1 + gain*(Nc/NcDes - 1)
  };
  /** installation (nacelle/inlet/afterbody drag) */
  installation: { enabled: boolean; captureRatioDesign: number; nacelleCf: number; afterbodyCd: number };
  /** polar moments of inertia, kg m^2, for transients */
  inertia: { LP: number; IP: number; HP: number; PT: number };
  /** component map choices (built-in names or custom map ids) */
  mapIds?: Record<string, string>;
  /** fuel type and ambient humidity */
  fuel: 'jetA' | 'saf' | 'hydrogen' | 'methane';
  humidity: { relative: number }; // 0..1 relative humidity at the ambient condition
  /** secondary air system: orifice network sized at the design point; off-design flows follow the gas-path pressures */
  sas?: { enabled: boolean; interstageFrac: number; leakFrac: number; cavityPressureFrac: number };
  /** turbine cooling model: fixed fractions, or computed from a target blade metal temperature */
  cooling: { mode: 'fixed' | 'computed'; targetMetal_K: number; effectivenessMax: number; coolantTempRise_K: number };
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
  kind: 'inlet' | 'compressor' | 'splitter' | 'duct' | 'burner' | 'turbine' | 'nozzle' | 'shaft' | 'propeller' | 'afterburner' | 'mixer' | 'gearbox';
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
  /** installed performance */
  installedFn: number; inletDrag: number; nacelleDrag: number; afterbodyDrag: number; installedTSFC_mg_Ns: number;
  /** emissions */
  EI_NOx_g_kg: number; EI_CO_g_kg: number; NOx_g_s: number; CO_g_s: number; CO2_g_s: number;
  /** jet mixing noise, overall sound pressure level at 1 m sideline (Lighthill scaling), dB */
  jetNoise_dB: number;
}

export interface ShaftResult { name: string; powerIn_W: number; powerOut_W: number; turbinePR: number; rpm: number; outputRpm?: number }

export interface EngineResult {
  inputs: EngineInputs;
  stations: Station[];
  components: ComponentResult[];
  perf: Performance;
  warnings: string[];
  shafts: ShaftResult[];
  /** off-design bookkeeping (undefined for a design-point result) */
  offDesign?: {
    converged: boolean; iterations: number; residualNorm: number; throttle: string; x: Record<string, number>; shaftImbalance_W?: Record<string, number>;
    /** largest physical flow-matching error over the compressors (kept apart from the R-line penalty) */
    flowMismatch?: number;
    /** compressors running beyond the tabulated R-line range of their map (extrapolated) */
    mapViolations?: string[];
  };
}
