/** Guided teaching scenarios: each sets up the lab and walks through what to look at. */
import { EngineInputs } from '../engine/types';
import { defaultInputs } from '../engine/defaults';

export interface Scenario {
  id: string; title: string; summary: string;
  setup: () => EngineInputs;
  view: 'section' | 'explore' | 'compare' | 'results' | 'transient' | 'mission';
  steps: { title: string; text: string }[];
  explore?: { mode: 'design' | 'offdesign'; param: string };
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'bpr', title: 'Why bypass ratio raises propulsive efficiency', summary: 'Same core, same fuel: moving energy into a larger, slower stream converts more of it into thrust.',
    setup: () => { const i = defaultInputs('turbofan'); return i; }, view: 'explore', explore: { mode: 'design', param: 'BPR' },
    steps: [
      { title: 'Start from the cruise turbofan', text: 'The default design is an 8:1 bypass civil turbofan at Mach 0.8 and 11 km. Open Explore and sweep bypass ratio from 0.5 to 14.' },
      { title: 'Watch specific thrust fall', text: 'Specific thrust drops steadily: the same core power accelerates ever more air, so each kilogram leaves more slowly.' },
      { title: 'Watch propulsive efficiency climb', text: 'Propulsive efficiency is 2V0/(Vjet+V0). Slower jets waste less kinetic energy in the wake, so overall efficiency rises and TSFC falls, until the fan pressure ratio becomes too high for the bypass ratio and the LP turbine runs out of expansion. Look for the TSFC minimum.' },
      { title: 'See it on the T–s diagram', text: 'In Results, the bypass branch barely moves on the T–s diagram: almost all of its energy is pressure work from the fan, not heat. That is the whole point of a turbofan.' },
    ],
  },
  {
    id: 't4', title: 'Why turbine inlet temperature sets take-off thrust', summary: 'With fixed airflow, the only way to add energy is to burn hotter. Materials decide the limit.',
    setup: () => { const i = defaultInputs('turbofan'); i.flight = { altitude_m: 0, mach: 0, dT_isa: 15, W_kgs: 420 }; i.burner.T4_K = 1650; return i; }, view: 'explore', explore: { mode: 'design', param: 'T4' },
    steps: [
      { title: 'Hot day, sea level', text: 'The setup is a take-off at ISA+15. Sweep T4 from 1100 K to 2000 K in Explore.' },
      { title: 'Thrust is almost linear in T4', text: 'Fuel flow and net thrust both rise with T4; specific thrust follows because airflow is fixed at the design point.' },
      { title: 'The cost', text: 'Cooling bleed, blade life and NOx all rise steeply. Check the NOx emission index card in Results at 1650 K and again at 1900 K: the P3–T3 correlation grows exponentially with compressor exit temperature.' },
      { title: 'Watch T3', text: 'The warning banner appears when HPC exit temperature exceeds 950 K. OPR and T4 are coupled through the compressor exit temperature, which limits disc and casing materials.' },
    ],
  },
  {
    id: 'opr', title: 'Overall pressure ratio and thermal efficiency', summary: 'Higher pressure ratio means a hotter compressor exit and a larger temperature ratio across the cycle.',
    setup: () => defaultInputs('turbojet'), view: 'explore', explore: { mode: 'design', param: 'PR' },
    steps: [
      { title: 'Turbojet, sea level', text: 'Sweep compressor pressure ratio from 3 to 30 on the simple turbojet.' },
      { title: 'Thermal efficiency', text: 'Thermal efficiency rises with pressure ratio as the ideal Brayton cycle predicts, but flattens: component losses and the fixed T4 cap the useful work.' },
      { title: 'Specific thrust has an optimum', text: 'Net thrust per unit airflow peaks at a moderate pressure ratio for a given T4. Beyond it, the compressor consumes an increasing share of the turbine work.' },
    ],
  },
  {
    id: 'altitude', title: 'What altitude does to a fixed engine', summary: 'Off-design: the same hardware at 11 km with falling pressure and temperature.',
    setup: () => { const i = defaultInputs('turbofan'); i.flight = { altitude_m: 0, mach: 0, dT_isa: 0, W_kgs: 420 }; i.burner.T4_K = 1650; return i; }, view: 'explore', explore: { mode: 'offdesign', param: 'od_alt' },
    steps: [
      { title: 'Design at sea level', text: 'This engine was sized for take-off. Switch Explore to off-design sweeps and sweep altitude from 0 to 15 km at constant T4.' },
      { title: 'Thrust falls with density', text: 'Net thrust drops roughly with ambient pressure because mass flow through the fixed nozzle scales with inlet pressure.' },
      { title: 'Corrected speeds rise', text: 'Colder air raises corrected speed at constant mechanical speed: the fan and booster move toward their stall lines. Look at the spool speed and surge margin charts, and at the compressor maps in Results.' },
    ],
  },
  {
    id: 'throttle', title: 'Part-power operation and the TSFC bucket', summary: 'Throttling a fixed engine moves it along its running line on every map.',
    setup: () => defaultInputs('turbofan'), view: 'explore', explore: { mode: 'offdesign', param: 'od_T4' },
    steps: [
      { title: 'Sweep the throttle', text: 'In off-design sweeps, sweep T4 from 1000 K to 1900 K.' },
      { title: 'TSFC has a bucket', text: 'At low power the engine runs well off its design efficiencies; at high power the jet velocity is high and propulsive efficiency falls. The minimum TSFC sits a little below the design point.' },
      { title: 'Spools decouple', text: 'The LP spool slows faster than the HP spool as power is reduced. Bypass ratio rises at part power because the core flow collapses faster than the fan flow.' },
    ],
  },
  {
    id: 'surge', title: 'Acceleration and surge margin', summary: 'A fuel step drives the compressor toward stall before the spool can speed up.',
    setup: () => { const i = defaultInputs('turbofan'); i.flight = { altitude_m: 0, mach: 0, dT_isa: 0, W_kgs: 420 }; i.burner.T4_K = 1650; return i; }, view: 'transient',
    steps: [
      { title: 'Run a slam acceleration', text: 'Open Transient with the default schedule: a fuel step from a 1250 K idle-like point to the take-off setting.' },
      { title: 'Watch the HPC surge margin', text: 'Extra fuel raises turbine inlet temperature instantly, the turbine delivers more work than the compressor absorbs, but the spool takes seconds to accelerate. Until it does, the compressor runs at a higher pressure ratio for its speed: its operating point climbs toward the stall line.' },
      { title: 'Add the limiter', text: 'Set the ratio-unit limit (Wf/P3) to about 1.15 and run again. The fuel controller holds the margin at the cost of a slower acceleration. This is exactly what an acceleration schedule in a FADEC does.' },
    ],
  },
  {
    id: 'mission', title: 'From cycle to block fuel', summary: 'The fixed engine flies a profile against an aircraft drag polar and the fuel burn is integrated.',
    setup: () => { const i = defaultInputs('turbofan'); i.flight = { altitude_m: 0, mach: 0, dT_isa: 0, W_kgs: 420 }; i.burner.T4_K = 1650; return i; }, view: 'mission',
    steps: [
      { title: 'Fly the default mission', text: 'Take-off, climb at Mach 0.72, 2000 km cruise at Mach 0.78 and 11 km, descent and a 30-minute hold.' },
      { title: 'Where the fuel goes', text: 'Cruise dominates. Climb burns at high thrust and poor TSFC; descent is nearly free. Compare the per-segment fuel in the table.' },
      { title: 'Trade a design change', text: 'Raise bypass ratio or fan efficiency in Build, then run the mission again: cruise fuel falls, but check that climb thrust is still available. Points limited by the N1 or N2 redline are flagged.' },
    ],
  },
];
