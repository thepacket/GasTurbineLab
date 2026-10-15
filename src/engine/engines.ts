/**
 * Nominal commercial-engine presets, not manufacturer performance decks.
 * Per-entry evidence and unresolved fields: reference/catalogue-provenance.json.
 * The original source list mentioned brochures, TCDS and Jane's without exact
 * citations; unverified legacy values must not be treated as measured data.
 * Internal T4, efficiencies, pressure splits and cooling are model assumptions.
 * T4 is calibrated to the nominal preset rating at sea-level static ISA.
 */
import { Architecture, EngineInputs } from './types';
import { defaultInputs } from './defaults';
import { solveEngine } from './cycle';

export type Era = 'first' | 'second' | 'third' | 'fourth'; // 1950s-60s / 1970s-80s / 1990s-2000s / 2010s+

export interface EngineSpec {
  name: string;
  maker: string;
  application: string;
  arch: Architecture;
  era: Era;
  year: number;
  /** take-off (sea-level static, ISA) net thrust in kN (turbojet / turbofan) */
  thrust_kN?: number;
  /** afterburning take-off thrust, kN (turbojet) */
  reheat_kN?: number;
  /** take-off shaft power in kW (turboprop) */
  power_kW?: number;
  BPR?: number;
  OPR: number;
  fanDiameter_m?: number;
  airflow_kgs?: number; // published where known; otherwise estimated from fan diameter
  propDiameter_m?: number;
  FPR?: number; // published or well-known fan pressure ratio (optional)
  spools?: 2 | 3;
  notes?: string;
}

const LBF = 4.44822; // N
const HP = 0.7457; // kW

export const ENGINES: EngineSpec[] = [
  // ---------------------------------------------------------------- turbofans: CFM International
  { name: 'CFM56-3B1', maker: 'CFM International', application: 'Boeing 737-300/-500', arch: 'turbofan', era: 'second', year: 1984, thrust_kN: 20000 * LBF / 1000, BPR: 6.0, OPR: 27.5, fanDiameter_m: 1.52, airflow_kgs: 297 },
  { name: 'CFM56-5B4', maker: 'CFM International', application: 'Airbus A320', arch: 'turbofan', era: 'third', year: 1994, thrust_kN: 27000 * LBF / 1000, BPR: 5.7, OPR: 32.6, fanDiameter_m: 1.735, airflow_kgs: 385 },
  { name: 'CFM56-5C4', maker: 'CFM International', application: 'Airbus A340-300', arch: 'turbofan', era: 'third', year: 1993, thrust_kN: 34000 * LBF / 1000, BPR: 6.4, OPR: 37.4, fanDiameter_m: 1.836, airflow_kgs: 466 },
  { name: 'CFM56-7B27', maker: 'CFM International', application: 'Boeing 737-800/-900', arch: 'turbofan', era: 'third', year: 1997, thrust_kN: 27300 * LBF / 1000, BPR: 5.1, OPR: 32.7, fanDiameter_m: 1.55, airflow_kgs: 355 },
  { name: 'LEAP-1A26', maker: 'CFM International', application: 'Airbus A320neo', arch: 'turbofan', era: 'fourth', year: 2016, thrust_kN: 27120 * LBF / 1000, BPR: 11.0, OPR: 33.3, fanDiameter_m: 1.98, notes: 'OPR quoted at take-off; ~40 at top of climb.' },
  { name: 'LEAP-1B28', maker: 'CFM International', application: 'Boeing 737 MAX 8', arch: 'turbofan', era: 'fourth', year: 2017, thrust_kN: 29317 * LBF / 1000, BPR: 8.6, OPR: 40, fanDiameter_m: 1.76 },
  // ---------------------------------------------------------------- GE Aerospace
  { name: 'CF6-50C2', maker: 'GE Aerospace', application: 'DC-10-30, A300B4, 747-200', arch: 'turbofan', era: 'second', year: 1971, thrust_kN: 52500 * LBF / 1000, BPR: 4.26, OPR: 29.3, fanDiameter_m: 2.19, airflow_kgs: 670 },
  { name: 'CF6-80C2B1F', maker: 'GE Aerospace', application: 'Boeing 747-400', arch: 'turbofan', era: 'second', year: 1985, thrust_kN: 57900 * LBF / 1000, BPR: 5.31, OPR: 30.4, fanDiameter_m: 2.36, airflow_kgs: 800 },
  { name: 'CF34-3B1', maker: 'GE Aerospace', application: 'Bombardier CRJ200', arch: 'turbofan', era: 'third', year: 1995, thrust_kN: 9220 * LBF / 1000, BPR: 6.2, OPR: 21, fanDiameter_m: 1.12 },
  { name: 'CF34-8C5', maker: 'GE Aerospace', application: 'Bombardier CRJ900', arch: 'turbofan', era: 'third', year: 2001, thrust_kN: 13790 * LBF / 1000, BPR: 5.0, OPR: 28, fanDiameter_m: 1.17 },
  { name: 'GE90-94B', maker: 'GE Aerospace', application: 'Boeing 777-200ER', arch: 'turbofan', era: 'third', year: 1995, thrust_kN: 93700 * LBF / 1000, BPR: 8.4, OPR: 40, fanDiameter_m: 3.12, airflow_kgs: 1400 },
  { name: 'GE90-115B', maker: 'GE Aerospace', application: 'Boeing 777-300ER', arch: 'turbofan', era: 'third', year: 2003, thrust_kN: 115300 * LBF / 1000, BPR: 9.0, OPR: 42, fanDiameter_m: 3.25, airflow_kgs: 1642 },
  { name: 'GEnx-1B76', maker: 'GE Aerospace', application: 'Boeing 787-9', arch: 'turbofan', era: 'fourth', year: 2011, thrust_kN: 76100 * LBF / 1000, BPR: 9.1, OPR: 43, fanDiameter_m: 2.82 },
  { name: 'GE9X-105B1A', maker: 'GE Aerospace', application: 'Boeing 777-9', arch: 'turbofan', era: 'fourth', year: 2020, thrust_kN: 110000 * LBF / 1000, BPR: 9.9, OPR: 52, fanDiameter_m: 3.40, notes: 'GE quotes 60:1 overall pressure ratio at top of climb; 52 assumed at take-off.' },
  { name: 'Passport 20-19BB1A', maker: 'GE Aerospace', application: 'Bombardier Global 7500', arch: 'turbofan', era: 'fourth', year: 2018, thrust_kN: 18920 * LBF / 1000, BPR: 5.6, OPR: 45, fanDiameter_m: 1.32 },
  // ---------------------------------------------------------------- Pratt & Whitney
  { name: 'JT8D-9A', maker: 'Pratt & Whitney', application: 'Boeing 727/737-200, DC-9', arch: 'turbofan', era: 'first', year: 1964, thrust_kN: 14500 * LBF / 1000, BPR: 1.04, OPR: 15.9, fanDiameter_m: 1.0, airflow_kgs: 144, FPR: 1.9 },
  { name: 'JT8D-219', maker: 'Pratt & Whitney', application: 'McDonnell Douglas MD-80', arch: 'turbofan', era: 'second', year: 1980, thrust_kN: 21700 * LBF / 1000, BPR: 1.77, OPR: 19.2, fanDiameter_m: 1.25, airflow_kgs: 221, FPR: 1.95 },
  { name: 'JT9D-7R4G2', maker: 'Pratt & Whitney', application: 'Boeing 747-200/-300', arch: 'turbofan', era: 'second', year: 1982, thrust_kN: 54750 * LBF / 1000, BPR: 4.8, OPR: 26.7, fanDiameter_m: 2.37, airflow_kgs: 769 },
  { name: 'PW2037', maker: 'Pratt & Whitney', application: 'Boeing 757-200', arch: 'turbofan', era: 'second', year: 1984, thrust_kN: 37000 * LBF / 1000, BPR: 6.0, OPR: 27.6, fanDiameter_m: 1.99, airflow_kgs: 608 },
  { name: 'PW4062', maker: 'Pratt & Whitney', application: 'Boeing 747-400, 767-300ER', arch: 'turbofan', era: 'second', year: 1987, thrust_kN: 62000 * LBF / 1000, BPR: 4.85, OPR: 32, fanDiameter_m: 2.39, airflow_kgs: 773 },
  { name: 'PW4084', maker: 'Pratt & Whitney', application: 'Boeing 777-200', arch: 'turbofan', era: 'third', year: 1995, thrust_kN: 84000 * LBF / 1000, BPR: 6.4, OPR: 34.4, fanDiameter_m: 2.84, airflow_kgs: 1180 },
  { name: 'PW1127G-JM', maker: 'Pratt & Whitney', application: 'Airbus A320neo (geared turbofan)', arch: 'turbofan', era: 'fourth', year: 2016, thrust_kN: 27075 * LBF / 1000, BPR: 12.5, OPR: 38, fanDiameter_m: 2.06, notes: 'Geared fan; gearbox not modelled. P&W quotes up to 50:1 overall pressure ratio at altitude.' },
  { name: 'PW1524G', maker: 'Pratt & Whitney', application: 'Airbus A220-300 (geared turbofan)', arch: 'turbofan', era: 'fourth', year: 2016, thrust_kN: 24000 * LBF / 1000, BPR: 12, OPR: 38, fanDiameter_m: 1.85, notes: 'Geared fan; gearbox not modelled.' },
  // ---------------------------------------------------------------- IAE / Engine Alliance
  { name: 'V2527-A5', maker: 'IAE', application: 'Airbus A320', arch: 'turbofan', era: 'third', year: 1993, thrust_kN: 26500 * LBF / 1000, BPR: 4.8, OPR: 27.2, fanDiameter_m: 1.6, airflow_kgs: 355 },
  { name: 'GP7270', maker: 'Engine Alliance', application: 'Airbus A380', arch: 'turbofan', era: 'fourth', year: 2007, thrust_kN: 74735 * LBF / 1000, BPR: 8.7, OPR: 43.9, fanDiameter_m: 2.95 },
  // ---------------------------------------------------------------- Rolls-Royce
  { name: 'Conway RCo.12 Mk 508', maker: 'Rolls-Royce', application: 'Boeing 707-420, DC-8-40', arch: 'turbofan', era: 'first', year: 1959, thrust_kN: 17500 * LBF / 1000, BPR: 0.3, OPR: 14, airflow_kgs: 122, FPR: 2.4, notes: 'First production turbofan in airline service.' },
  { name: 'Spey 512-14DW', maker: 'Rolls-Royce', application: 'BAC One-Eleven 500, Trident', arch: 'turbofan', era: 'first', year: 1968, thrust_kN: 12550 * LBF / 1000, BPR: 0.64, OPR: 20.7, airflow_kgs: 94, FPR: 2.6 },
  { name: 'Tay 650-15', maker: 'Rolls-Royce', application: 'Fokker 100', arch: 'turbofan', era: 'second', year: 1988, thrust_kN: 15100 * LBF / 1000, BPR: 3.1, OPR: 16.6, fanDiameter_m: 1.14, airflow_kgs: 187 },
  { name: 'RB211-535E4', maker: 'Rolls-Royce', application: 'Boeing 757-200', arch: 'turbofan', era: 'second', year: 1984, thrust_kN: 43100 * LBF / 1000, BPR: 4.3, OPR: 25.8, fanDiameter_m: 1.88, airflow_kgs: 522, spools: 3 },
  { name: 'RB211-524H', maker: 'Rolls-Royce', application: 'Boeing 747-400, 767-300', arch: 'turbofan', era: 'second', year: 1989, thrust_kN: 60600 * LBF / 1000, BPR: 4.3, OPR: 33, fanDiameter_m: 2.19, airflow_kgs: 728, spools: 3 },
  { name: 'Trent 772B-60', maker: 'Rolls-Royce', application: 'Airbus A330', arch: 'turbofan', era: 'third', year: 1995, thrust_kN: 71100 * LBF / 1000, BPR: 5.0, OPR: 36.4, fanDiameter_m: 2.47, airflow_kgs: 920, spools: 3 },
  { name: 'Trent 892', maker: 'Rolls-Royce', application: 'Boeing 777-300', arch: 'turbofan', era: 'third', year: 1996, thrust_kN: 90000 * LBF / 1000, BPR: 5.8, OPR: 41, fanDiameter_m: 2.79, airflow_kgs: 1200, spools: 3 },
  { name: 'Trent 970-84', maker: 'Rolls-Royce', application: 'Airbus A380', arch: 'turbofan', era: 'fourth', year: 2007, thrust_kN: 78300 * LBF / 1000, BPR: 8.5, OPR: 39, fanDiameter_m: 2.95, airflow_kgs: 1245, spools: 3 },
  { name: 'Trent 1000-C', maker: 'Rolls-Royce', application: 'Boeing 787', arch: 'turbofan', era: 'fourth', year: 2011, thrust_kN: 74400 * LBF / 1000, BPR: 10, OPR: 50, fanDiameter_m: 2.85, spools: 3 },
  { name: 'Trent XWB-84', maker: 'Rolls-Royce', application: 'Airbus A350-900', arch: 'turbofan', era: 'fourth', year: 2015, thrust_kN: 84200 * LBF / 1000, BPR: 9.6, OPR: 50, fanDiameter_m: 3.0, spools: 3 },
  { name: 'BR715-A1-30', maker: 'Rolls-Royce Deutschland', application: 'Boeing 717', arch: 'turbofan', era: 'third', year: 1999, thrust_kN: 21000 * LBF / 1000, BPR: 4.7, OPR: 32, fanDiameter_m: 1.47 },
  { name: 'AE 3007A1', maker: 'Rolls-Royce', application: 'Embraer ERJ-145', arch: 'turbofan', era: 'third', year: 1996, thrust_kN: 7580 * LBF / 1000, BPR: 5.0, OPR: 23, fanDiameter_m: 0.98, airflow_kgs: 127 },
  // ---------------------------------------------------------------- business / regional small turbofans
  { name: 'TFE731-2', maker: 'Honeywell (Garrett)', application: 'Learjet 35, Falcon 10', arch: 'turbofan', era: 'second', year: 1972, thrust_kN: 3500 * LBF / 1000, BPR: 2.67, OPR: 14, fanDiameter_m: 0.72, airflow_kgs: 51, notes: 'Geared fan; gearbox not modelled.' },
  { name: 'HTF7000 (AS907)', maker: 'Honeywell', application: 'Bombardier Challenger 300', arch: 'turbofan', era: 'third', year: 2002, thrust_kN: 7028 * LBF / 1000, BPR: 4.4, OPR: 28, fanDiameter_m: 0.87 },
  { name: 'FJ44-1A', maker: 'Williams International', application: 'Cessna CitationJet', arch: 'turbofan', era: 'third', year: 1992, thrust_kN: 1900 * LBF / 1000, BPR: 3.28, OPR: 12.8, fanDiameter_m: 0.53, airflow_kgs: 28.6 },
  // ---------------------------------------------------------------- turbojets
  { name: 'Avon RA.29 Mk 524', maker: 'Rolls-Royce', application: 'de Havilland Comet 4', arch: 'turbojet', era: 'first', year: 1958, thrust_kN: 10500 * LBF / 1000, OPR: 10, airflow_kgs: 70 },
  { name: 'JT3C-6 (dry)', maker: 'Pratt & Whitney', application: 'Boeing 707-120, DC-8-10', arch: 'turbojet', era: 'first', year: 1958, thrust_kN: 11200 * LBF / 1000, OPR: 12.5, airflow_kgs: 82, notes: '13,500 lbf with water injection (not modelled).' },
  { name: 'JT4A-11', maker: 'Pratt & Whitney', application: 'Boeing 707-220, DC-8-20', arch: 'turbojet', era: 'first', year: 1959, thrust_kN: 17500 * LBF / 1000, OPR: 12, airflow_kgs: 115 },
  { name: 'CJ805-3B', maker: 'General Electric', application: 'Convair 880', arch: 'turbojet', era: 'first', year: 1960, thrust_kN: 11650 * LBF / 1000, OPR: 13, airflow_kgs: 75.6 },
  { name: 'CJ610-6', maker: 'General Electric', application: 'Learjet 24/25', arch: 'turbojet', era: 'first', year: 1965, thrust_kN: 2950 * LBF / 1000, OPR: 6.8, airflow_kgs: 20 },
  { name: 'Olympus 593 Mk 610 (dry)', maker: 'Rolls-Royce / Snecma', application: 'Concorde', arch: 'turbojet', era: 'second', year: 1976, thrust_kN: 31350 * LBF / 1000, OPR: 15.5, airflow_kgs: 186, notes: 'Two-spool turbojet with variable con-di nozzle.' },
  { name: 'Olympus 593 Mk 610 (reheat)', maker: 'Rolls-Royce / Snecma', application: 'Concorde, take-off with afterburner', arch: 'turbojet', era: 'second', year: 1976, thrust_kN: 31350 * LBF / 1000, reheat_kN: 38050 * LBF / 1000, OPR: 15.5, airflow_kgs: 186, notes: 'Afterburner exit temperature calibrated to the 38,050 lbf reheat rating.' },
  // ---------------------------------------------------------------- turboprops
  { name: 'Dart Mk 532-7', maker: 'Rolls-Royce', application: 'HS 748, Fokker F27', arch: 'turboprop', era: 'first', year: 1965, power_kW: 2100 * HP, OPR: 5.75, airflow_kgs: 11.4, propDiameter_m: 3.66, notes: 'Two-stage centrifugal compressor.' },
  { name: '501-D13', maker: 'Allison', application: 'Lockheed L-188 Electra, Convair 580', arch: 'turboprop', era: 'first', year: 1957, power_kW: 3750 * HP, OPR: 9.5, airflow_kgs: 14.7, propDiameter_m: 4.11 },
  { name: 'TPE331-10', maker: 'Honeywell (Garrett)', application: 'Fairchild Metro III, Jetstream 31', arch: 'turboprop', era: 'second', year: 1978, power_kW: 1000 * HP, OPR: 10.8, propDiameter_m: 2.69, notes: 'Single-shaft engine; modelled with a free power turbine.' },
  { name: 'PT6A-114A', maker: 'Pratt & Whitney Canada', application: 'Cessna 208B Grand Caravan', arch: 'turboprop', era: 'second', year: 1990, power_kW: 675 * HP, OPR: 8.0, propDiameter_m: 2.69, notes: 'Reverse-flow combustor and centrifugal stage; modelled as a straight-through gas generator.' },
  { name: 'PT6A-67D', maker: 'Pratt & Whitney Canada', application: 'Beechcraft 1900D', arch: 'turboprop', era: 'second', year: 1991, power_kW: 1279 * HP, OPR: 12, propDiameter_m: 2.78 },
  { name: 'PW118B', maker: 'Pratt & Whitney Canada', application: 'Embraer EMB-120 Brasilia', arch: 'turboprop', era: 'second', year: 1985, power_kW: 1800 * HP, OPR: 12, propDiameter_m: 3.2 },
  { name: 'PW127F', maker: 'Pratt & Whitney Canada', application: 'ATR 72-500', arch: 'turboprop', era: 'third', year: 1996, power_kW: 2750 * HP, OPR: 14.5, propDiameter_m: 3.93 },
  { name: 'PW150A', maker: 'Pratt & Whitney Canada', application: 'De Havilland Dash 8-400', arch: 'turboprop', era: 'third', year: 1999, power_kW: 5071 * HP, OPR: 18, propDiameter_m: 4.11 },
  { name: 'CT7-9B', maker: 'GE Aerospace', application: 'Saab 340B', arch: 'turboprop', era: 'second', year: 1989, power_kW: 1750 * HP, OPR: 17, propDiameter_m: 3.35 },
  { name: 'AE 2100A', maker: 'Rolls-Royce (Allison)', application: 'Saab 2000', arch: 'turboprop', era: 'third', year: 1994, power_kW: 4152 * HP, OPR: 16.6, propDiameter_m: 3.81 },
  { name: '250-B17F', maker: 'Rolls-Royce (Allison)', application: 'Beechcraft/other light twins', arch: 'turboprop', era: 'second', year: 1980, power_kW: 450 * HP, OPR: 7.2, propDiameter_m: 2.0 },
  { name: 'Catalyst', maker: 'GE Aerospace (Avio)', application: 'Beechcraft Denali', arch: 'turboprop', era: 'fourth', year: 2023, power_kW: 1300 * HP, OPR: 16, propDiameter_m: 2.67 },
];

const ERA_EFF: Record<Era, { fan: number; comp: number; turb: number; cool: [number, number]; dPqP: number; T4max: number }> = {
  first: { fan: 0.84, comp: 0.83, turb: 0.87, cool: [0.0, 0.0], dPqP: 0.06, T4max: 1350 },
  second: { fan: 0.87, comp: 0.86, turb: 0.89, cool: [0.04, 0.015], dPqP: 0.05, T4max: 1650 },
  third: { fan: 0.90, comp: 0.88, turb: 0.90, cool: [0.06, 0.02], dPqP: 0.045, T4max: 1850 },
  fourth: { fan: 0.92, comp: 0.90, turb: 0.915, cool: [0.08, 0.03], dPqP: 0.04, T4max: 2000 },
};

/** Fan-face airflow at take-off from fan diameter (hub/tip 0.3, axial Mach ~0.6). */
const airflowFromDiameter = (d: number) => 190 * (Math.PI * d * d) / 4;
/** Typical take-off fan pressure ratio versus bypass ratio. */
const fprFromBPR = (bpr: number) => Math.min(1.9, Math.max(1.35, 1.78 - 0.034 * bpr));

export interface CalibratedEngine { spec: EngineSpec; inputs: EngineInputs; note: string; achieved: number; target: number }

export function calibrateEngine(spec: EngineSpec): CalibratedEngine {
  const e = ERA_EFF[spec.era];
  const inp = defaultInputs(spec.arch);
  inp.flight = { altitude_m: 0, mach: 0, dT_isa: 0, W_kgs: 1 };
  inp.inlet = { ramRecovery: 0.995, MN: 0.6 };
  inp.burner.dPqP = e.dPqP; inp.burner.eff = 0.995; inp.burner.fuel_h_Jkg = 0;
  inp.mechEff = 0.995; inp.HPX_W = 0;
  inp.afterburner.enabled = false;

  let W = spec.airflow_kgs ?? (spec.fanDiameter_m ? airflowFromDiameter(spec.fanDiameter_m) : 0);
  let estimated: string[] = [];

  if (spec.arch === 'turbofan') {
    const bpr = spec.BPR!;
    const fpr = spec.FPR ?? fprFromBPR(bpr);
    const hpcMax = spec.spools === 3 ? 18 : 20;
    const lpc = Math.max(1.15, Math.min(3.0, spec.OPR / (fpr * hpcMax)));
    const hpc = spec.OPR / (fpr * lpc);
    inp.BPR = bpr;
    inp.fan = { PR: fpr, eff: e.fan, MN: bpr > 3 ? 0.5 : 0.45 };
    inp.lpc = { PR: lpc, eff: e.comp + 0.01, MN: 0.35 };
    inp.hpc = { PR: hpc, eff: e.comp, MN: 0.3 };
    inp.coolInletFrac = e.cool[0]; inp.coolExitFrac = e.cool[1];
    inp.hpt = { eff: e.turb, MN: 0.3 }; inp.lpt = { eff: e.turb + 0.01, MN: 0.35 };
    inp.coreNozzle = { type: 'CV', Cv: 0.985 }; inp.bypNozzle = { type: 'CV', Cv: 0.99 }; inp.bypDuct_dPqP = 0.015;
    inp.burner.MN = 0.15;
    if (!spec.FPR) estimated.push(`fan PR ${fpr.toFixed(2)}`);
    estimated.push(`booster ${lpc.toFixed(2)} × HPC ${hpc.toFixed(1)}`);
  } else if (spec.arch === 'turbojet') {
    inp.comp = { PR: spec.OPR, eff: e.comp, MN: 0.25 };
    inp.hpt = { eff: e.turb, MN: 0.4 };
    inp.coreNozzle = { type: spec.reheat_kN || spec.OPR > 14 ? 'CD' : 'CV', Cv: 0.985 };
    inp.burner.MN = 0.2;
  } else {
    inp.comp = { PR: spec.OPR, eff: e.comp - 0.02, MN: 0.25 };
    inp.hpt = { eff: e.turb - 0.01, MN: 0.35 }; inp.lpt = { eff: e.turb, MN: 0.35 };
    inp.coreNozzle = { type: 'CV', Cv: 0.98 };
    inp.burner.MN = 0.15;
    inp.prop = { shaftPower_W: spec.power_kW! * 1000, gearboxEff: 0.985, gearRatio: inp.prop.gearRatio, propEff: 0.9, diameter_m: spec.propDiameter_m ?? 3.0 };
    if (!W) { W = (spec.power_kW! / (90 + 8 * spec.OPR)); estimated.push(`airflow ${W.toFixed(1)} kg/s`); }
  }
  if (!spec.airflow_kgs && spec.arch !== 'turboprop') estimated.push(`airflow ${W.toFixed(0)} kg/s from fan diameter`);
  inp.flight.W_kgs = W;

  // calibrate T4 (and afterburner T7) to the published rating
  let target: number, achieved = 0;
  const metric = (i: EngineInputs) => { const r = solveEngine(i); return spec.arch === 'turboprop' ? r.components.find((c) => c.id === 'nozz')!.values.PR : r.perf.Fn / 1000; };
  if (spec.arch === 'turboprop') {
    target = 1.12; // residual exhaust pressure ratio at take-off, typical of free-turbine turboprops
  } else {
    target = spec.thrust_kN!;
  }
  const T4floor = spec.era === 'first' ? 1050 : 1150;
  const bisectT4 = () => {
    let lo = T4floor, hi = e.T4max + 150;
    for (let k = 0; k < 40; k++) {
      const mid = 0.5 * (lo + hi);
      inp.burner.T4_K = mid;
      let m: number;
      try { m = metric(inp); } catch { m = -1; }
      if (m < target) lo = mid; else hi = mid;
    }
    inp.burner.T4_K = Math.round(0.5 * (lo + hi));
  };
  bisectT4();
  achieved = metric(inp);
  if (Math.abs(achieved / target - 1) > 0.005) {
    // The T4 floor binds: the airflow estimate is off. Hold a plausible T4 for the era and solve for airflow instead
    // (thrust is near-linear in airflow; for a turboprop a larger core flow lowers the residual exhaust pressure ratio).
    inp.burner.T4_K = T4floor + 100;
    let a = 0.4 * W, b = 2.5 * W;
    for (let k = 0; k < 50; k++) {
      const mid = 0.5 * (a + b); inp.flight.W_kgs = mid;
      let m: number; try { m = metric(inp); } catch { m = -1; }
      const tooLow = spec.arch === 'turboprop' ? m < target : m < target; // turboprop: more core flow leaves more residual pressure
      if (tooLow) a = mid; else b = mid;
    }
    inp.flight.W_kgs = 0.5 * (a + b);
    estimated = estimated.filter((x) => !x.startsWith('airflow'));
    estimated.push(`airflow ${inp.flight.W_kgs.toFixed(spec.arch === 'turboprop' ? 1 : 0)} kg/s (solved for the rating at T4 ${inp.burner.T4_K} K)`);
    W = inp.flight.W_kgs;
    achieved = metric(inp);
  }
  if (spec.reheat_kN) {
    inp.afterburner = { enabled: true, T7_K: 1800, dPqP: 0.06, eff: 0.92 };
    let a = 1200, b = 2300;
    for (let k = 0; k < 40; k++) {
      const mid = 0.5 * (a + b); inp.afterburner.T7_K = mid;
      let m: number; try { m = solveEngine(inp).perf.Fn / 1000; } catch { m = -1; }
      if (m < spec.reheat_kN) a = mid; else b = mid;
    }
    inp.afterburner.T7_K = Math.round(0.5 * (a + b));
    achieved = solveEngine(inp).perf.Fn / 1000;
    target = spec.reheat_kN;
  }
  const r = solveEngine(inp);
  const t3 = r.stations.find((s) => s.id === '3')!.Tt;
  const pub = spec.arch === 'turboprop'
    ? `${spec.power_kW!.toFixed(0)} kW (${(spec.power_kW! / HP).toFixed(0)} shp) take-off, OPR ${spec.OPR}${spec.propDiameter_m ? `, propeller Ø ${spec.propDiameter_m} m` : ''}`
    : `${spec.thrust_kN!.toFixed(1)} kN (${(spec.thrust_kN! * 1000 / LBF).toFixed(0)} lbf)${spec.reheat_kN ? ` dry / ${spec.reheat_kN.toFixed(1)} kN reheat` : ''} take-off, ${spec.BPR !== undefined ? `BPR ${spec.BPR}, ` : ''}OPR ${spec.OPR}${spec.fanDiameter_m ? `, fan Ø ${spec.fanDiameter_m} m` : ''}${spec.airflow_kgs ? `, ${spec.airflow_kgs} kg/s` : ''}`;
  const note = `${spec.maker} ${spec.name} — ${spec.application} (${spec.year}). Published: ${pub}. Estimated: T4 ${inp.burner.T4_K} K${spec.reheat_kN ? `, T7 ${inp.afterburner.T7_K} K` : ''} (calibrated to the rating), T3 ${t3.toFixed(0)} K, ${estimated.join(', ')}${estimated.length ? ', ' : ''}${spec.era}-generation efficiencies.${spec.notes ? ' ' + spec.notes : ''}`;
  return { spec, inputs: inp, note, achieved, target };
}

let cache: CalibratedEngine[] | null = null;
export function calibratedEngines(): CalibratedEngine[] {
  if (!cache) cache = ENGINES.map(calibrateEngine);
  return cache;
}
