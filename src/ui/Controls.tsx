import { Store } from '../state/store';
import { Architecture } from '../engine/types';
import { PRESETS, REFERENCE_PRESETS } from '../engine/presets';
import { ENGINES, calibrateEngine } from '../engine/engines';
import { fmt } from './format';

interface SliderProps { label: string; path: string; value: number; min: number; max: number; step: number; unit?: string; scale?: number; digits?: number; store: Store }
function Slider({ label, path, value, min, max, step, unit, scale = 1, digits, store }: SliderProps) {
  const shown = value * scale;
  const d = digits ?? (step * scale < 0.01 ? 3 : step * scale < 0.1 ? 2 : step * scale < 1 ? 1 : 0);
  const commit = (v: number) => { if (Number.isFinite(v)) store.set(path, v / scale); };
  return (
    <div className="control">
      <label>{label}</label>
      <div className="val">
        <input className="num" type="number" value={Number(shown.toFixed(d))} step={step * scale} onChange={(e) => commit(parseFloat(e.target.value))} />
        <span className="unit">{unit ?? ''}</span>
      </div>
      <input type="range" min={min * scale} max={max * scale} step={step * scale} value={shown} onChange={(e) => commit(parseFloat(e.target.value))} aria-label={label} />
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="section">
      <h3>{title}{hint && <span className="hint">{hint}</span>}</h3>
      {children}
    </div>
  );
}

export function Controls({ store }: { store: Store }) {
  const i = store.state.inputs;
  const S = (p: Omit<SliderProps, 'store'>) => <Slider {...p} store={store} />;
  const arch = i.arch;
  const presets = [...PRESETS, ...REFERENCE_PRESETS];
  return (
    <div>
      <Section title="Architecture">
        <div className="segmented" style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
          {(['turbojet', 'turbofan', 'turboprop'] as Architecture[]).map((a) => (
            <button key={a} className={arch === a ? 'on' : ''} onClick={() => store.dispatch({ type: 'arch', arch: a })}>{a[0].toUpperCase() + a.slice(1)}</button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <select className="select" value="" onChange={(e) => { const p = presets.find((x) => x.name === e.target.value); if (p) store.dispatch({ type: 'inputs', inputs: JSON.parse(JSON.stringify(p.inputs)), note: p.group === 'pyCycle reference' ? 'pyCycle reference case: inputs identical to the validation run.' : undefined }); }} aria-label="Load generic preset">
            <option value="">Generic preset…</option>
            {['Turbojet', 'Turbofan', 'Turboprop', 'pyCycle reference'].map((g) => (
              <optgroup key={g} label={g}>{presets.filter((p) => p.group === g).map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>
            ))}
          </select>
          <button className="btn" onClick={() => store.dispatch({ type: 'reset' })} title="Reset to defaults">Reset</button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <select className="select" value="" onChange={(e) => { const spec = ENGINES.find((x) => x.name === e.target.value); if (spec) { const c = calibrateEngine(spec); store.dispatch({ type: 'inputs', inputs: c.inputs, note: c.note }); } }} aria-label="Load commercial engine">
            <option value="">Commercial engine…</option>
            {(['turbofan', 'turbojet', 'turboprop'] as const).map((a) => (
              <optgroup key={a} label={a[0].toUpperCase() + a.slice(1) + 's'}>
                {ENGINES.filter((x) => x.arch === a).slice().sort((p, q) => p.maker.localeCompare(q.maker) || p.year - q.year).map((x) => <option key={x.name} value={x.name}>{x.maker} {x.name} · {x.application}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        {store.state.note && (
          <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.45 }}>
            {store.state.note}
            {!store.state.note.startsWith('pyCycle') && <div style={{ marginTop: 4, color: 'var(--text-muted)' }}>Take-off rating at sea level, ISA, static. Internal values are estimates; only the published figures are manufacturer data.</div>}
          </div>
        )}
      </Section>

      <Section title="Flight condition" hint="ISA 1976">
        {S({ label: 'Altitude', path: 'flight.altitude_m', value: i.flight.altitude_m, min: 0, max: 20000, step: 100, unit: 'm' })}
        {S({ label: 'Mach number', path: 'flight.mach', value: i.flight.mach, min: 0, max: 2.5, step: 0.01, unit: 'M' })}
        {S({ label: 'ΔT from ISA', path: 'flight.dT_isa', value: i.flight.dT_isa, min: -40, max: 40, step: 1, unit: 'K' })}
        {S({ label: 'Inlet mass flow', path: 'flight.W_kgs', value: i.flight.W_kgs, min: 1, max: arch === 'turboprop' ? 30 : 2000, step: arch === 'turboprop' ? 0.1 : 1, unit: 'kg/s' })}
      </Section>

      <Section title="Inlet">
        {S({ label: 'Ram recovery  Pt2 / Pt0', path: 'inlet.ramRecovery', value: i.inlet.ramRecovery, min: 0.8, max: 1, step: 0.001 })}
        {S({ label: 'Exit Mach (sizing)', path: 'inlet.MN', value: i.inlet.MN, min: 0.2, max: 0.8, step: 0.01 })}
      </Section>

      {arch === 'turbofan' && (
        <>
          <Section title="Fan & bypass">
            {S({ label: 'Fan pressure ratio', path: 'fan.PR', value: i.fan.PR, min: 1.1, max: 4, step: 0.01 })}
            {S({ label: 'Fan isentropic efficiency', path: 'fan.eff', value: i.fan.eff, min: 0.75, max: 0.95, step: 0.001 })}
            {S({ label: 'Bypass ratio', path: 'BPR', value: i.BPR, min: 0.2, max: 15, step: 0.1 })}
            {S({ label: 'Bypass duct loss ΔP/P', path: 'bypDuct_dPqP', value: i.bypDuct_dPqP, min: 0, max: 0.05, step: 0.001 })}
          </Section>
          <Section title="Core compressors">
            {S({ label: 'Booster (LPC) pressure ratio', path: 'lpc.PR', value: i.lpc.PR, min: 1, max: 5, step: 0.01 })}
            {S({ label: 'Booster efficiency', path: 'lpc.eff', value: i.lpc.eff, min: 0.75, max: 0.95, step: 0.001 })}
            {S({ label: 'HPC pressure ratio', path: 'hpc.PR', value: i.hpc.PR, min: 2, max: 30, step: 0.1 })}
            {S({ label: 'HPC efficiency', path: 'hpc.eff', value: i.hpc.eff, min: 0.75, max: 0.95, step: 0.001 })}
            {S({ label: 'Turbine cooling bleed (does work)', path: 'coolInletFrac', value: i.coolInletFrac, min: 0, max: 0.15, step: 0.005, unit: '% W25', scale: 100, digits: 1 })}
            {S({ label: 'Turbine cooling bleed (exit)', path: 'coolExitFrac', value: i.coolExitFrac, min: 0, max: 0.1, step: 0.005, unit: '% W25', scale: 100, digits: 1 })}
          </Section>
        </>
      )}
      {arch !== 'turbofan' && (
        <Section title="Compressor">
          {S({ label: 'Pressure ratio', path: 'comp.PR', value: i.comp.PR, min: 2, max: 30, step: 0.1 })}
          {S({ label: 'Isentropic efficiency', path: 'comp.eff', value: i.comp.eff, min: 0.7, max: 0.95, step: 0.001 })}
        </Section>
      )}

      <Section title="Combustor">
        {S({ label: 'Turbine inlet temperature T4', path: 'burner.T4_K', value: i.burner.T4_K, min: 900, max: 2100, step: 5, unit: 'K' })}
        {S({ label: 'Pressure loss ΔP/P', path: 'burner.dPqP', value: i.burner.dPqP, min: 0, max: 0.1, step: 0.001 })}
        {S({ label: 'Combustion efficiency', path: 'burner.eff', value: i.burner.eff, min: 0.9, max: 1, step: 0.001 })}
      </Section>

      <Section title={arch === 'turbofan' ? 'Turbines' : arch === 'turboprop' ? 'Turbines' : 'Turbine'}>
        {S({ label: arch === 'turbofan' ? 'HP turbine efficiency' : arch === 'turboprop' ? 'Gas-generator turbine efficiency' : 'Turbine efficiency', path: 'hpt.eff', value: i.hpt.eff, min: 0.8, max: 0.95, step: 0.001 })}
        {arch !== 'turbojet' && S({ label: arch === 'turbofan' ? 'LP turbine efficiency' : 'Power turbine efficiency', path: 'lpt.eff', value: i.lpt.eff, min: 0.8, max: 0.95, step: 0.001 })}
        {S({ label: 'Shaft mechanical efficiency', path: 'mechEff', value: i.mechEff, min: 0.95, max: 1, step: 0.001 })}
        {S({ label: 'Power extraction (HP shaft)', path: 'HPX_W', value: i.HPX_W, min: 0, max: 1000e3, step: 5e3, unit: 'kW', scale: 1e-3, digits: 0 })}
      </Section>

      {arch === 'turbojet' && (
        <Section title="Afterburner">
          <label className="toggle"><input type="checkbox" checked={i.afterburner.enabled} onChange={(e) => store.set('afterburner.enabled', e.target.checked)} /> Afterburner lit</label>
          {i.afterburner.enabled && (
            <>
              {S({ label: 'Afterburner exit temperature T7', path: 'afterburner.T7_K', value: i.afterburner.T7_K, min: 1400, max: 2300, step: 5, unit: 'K' })}
              {S({ label: 'Pressure loss ΔP/P', path: 'afterburner.dPqP', value: i.afterburner.dPqP, min: 0, max: 0.15, step: 0.001 })}
              {S({ label: 'Combustion efficiency', path: 'afterburner.eff', value: i.afterburner.eff, min: 0.8, max: 1, step: 0.001 })}
            </>
          )}
        </Section>
      )}

      {arch === 'turboprop' && (
        <Section title="Propeller & gearbox" hint="actuator-disc model">
          {S({ label: 'Delivered shaft power', path: 'prop.shaftPower_W', value: i.prop.shaftPower_W, min: 100e3, max: 8000e3, step: 10e3, unit: 'kW', scale: 1e-3, digits: 0 })}
          {S({ label: 'Propeller diameter', path: 'prop.diameter_m', value: i.prop.diameter_m, min: 1.5, max: 6, step: 0.05, unit: 'm' })}
          {S({ label: 'Propeller profile efficiency', path: 'prop.propEff', value: i.prop.propEff, min: 0.7, max: 1, step: 0.005 })}
          {S({ label: 'Gearbox efficiency', path: 'prop.gearboxEff', value: i.prop.gearboxEff, min: 0.95, max: 1, step: 0.001 })}
        </Section>
      )}

      <Section title={arch === 'turbofan' ? 'Nozzles' : 'Nozzle'}>
        {arch !== 'turboprop' && (
          <div className="control">
            <label>{arch === 'turbofan' ? 'Core nozzle type' : 'Nozzle type'}</label>
            <div className="segmented">
              <button className={i.coreNozzle.type === 'CV' ? 'on' : ''} onClick={() => store.set('coreNozzle.type', 'CV')}>Convergent</button>
              <button className={i.coreNozzle.type === 'CD' ? 'on' : ''} onClick={() => store.set('coreNozzle.type', 'CD')}>Con-di</button>
            </div>
          </div>
        )}
        {S({ label: arch === 'turbofan' ? 'Core velocity coefficient Cv' : 'Velocity coefficient Cv', path: 'coreNozzle.Cv', value: i.coreNozzle.Cv, min: 0.9, max: 1, step: 0.001 })}
        {arch === 'turbofan' && (
          <>
            <div className="control">
              <label>Bypass nozzle type</label>
              <div className="segmented">
                <button className={i.bypNozzle.type === 'CV' ? 'on' : ''} onClick={() => store.set('bypNozzle.type', 'CV')}>Convergent</button>
                <button className={i.bypNozzle.type === 'CD' ? 'on' : ''} onClick={() => store.set('bypNozzle.type', 'CD')}>Con-di</button>
              </div>
            </div>
            {S({ label: 'Bypass velocity coefficient Cv', path: 'bypNozzle.Cv', value: i.bypNozzle.Cv, min: 0.9, max: 1, step: 0.001 })}
          </>
        )}
      </Section>

      <Section title="Fuel & gas model" hint="Jet-A, CEA polynomials">
        {S({ label: 'Fuel enthalpy as supplied', path: 'burner.fuel_h_Jkg', value: i.burner.fuel_h_Jkg, min: -2000e3, max: 500e3, step: 10e3, unit: 'kJ/kg', scale: 1e-3, digits: 0 })}
        {S({ label: 'Lower heating value (efficiency metrics)', path: 'LHV_Jkg', value: i.LHV_Jkg, min: 40e6, max: 45e6, step: 0.1e6, unit: 'MJ/kg', scale: 1e-6, digits: 1 })}
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>
          Fuel enthalpy 0 kJ/kg reproduces pyCycle's convention. Stoichiometric FAR for Jet-A in dry air is {fmt(0.0678, 4)}.
        </div>
      </Section>
    </div>
  );
}
