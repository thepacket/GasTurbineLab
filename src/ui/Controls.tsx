import { Store } from '../state/store';
import { Architecture } from '../engine/types';
import { PRESETS, REFERENCE_PRESETS } from '../engine/presets';
import { ENGINES, calibrateEngine } from '../engine/engines';
import { fmt } from './format';
import { t } from './i18n';
import { useState } from 'react';

interface SliderProps { label: string; path: string; value: number; min: number; max: number; step: number; unit?: string; scale?: number; digits?: number; store: Store }
function Slider({ label, path, value, min, max, step, unit, scale = 1, digits, store }: SliderProps) {
  const shown = value * scale;
  const d = digits ?? (step * scale < 0.01 ? 3 : step * scale < 0.1 ? 2 : step * scale < 1 ? 1 : 0);
  const commit = (v: number) => { if (Number.isFinite(v)) store.set(path, v / scale); };
  return (
    <div className="control">
      <label>{t(label)}</label>
      <div className="val">
        <input className="num" type="number" aria-label={label + (unit ? ` (${unit})` : '')} value={Number(shown.toFixed(d))} step={step * scale} onChange={(e) => commit(parseFloat(e.target.value))} />
        <span className="unit">{unit ?? ''}</span>
      </div>
      <input type="range" min={min * scale} max={max * scale} step={step * scale} value={shown} onChange={(e) => commit(parseFloat(e.target.value))} aria-label={label} />
    </div>
  );
}

const ADVANCED = new Set(['Variable geometry & bleeds', 'Secondary air system', 'Installation', 'Spool inertia', 'Design shaft speeds', 'Turbine cooling', 'Fuel & gas model', 'Afterburner']);
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const key = 'gtl.section.' + title;
  const [open, setOpen] = useState<boolean>(() => { try { const v = localStorage.getItem(key); return v !== null ? v === '1' : !ADVANCED.has(title); } catch { return !ADVANCED.has(title); } });
  const toggle = () => { setOpen(!open); try { localStorage.setItem(key, open ? '0' : '1'); } catch { /* ignore */ } };
  return (
    <div className={`section${open ? '' : ' collapsed'}`}>
      <h3>
        <button className="sectiontoggle" onClick={toggle} aria-expanded={open} aria-controls={key}><span className="chev" aria-hidden>{open ? '▾' : '▸'}</span>{t(title)}{ADVANCED.has(title) && <span className="adv">advanced</span>}</button>
        {hint && <span className="hint">{hint}</span>}
      </h3>
      {open && <div id={key}>{children}</div>}
    </div>
  );
}

function OdSlider(p: Omit<SliderProps, 'store'> & { store: Store }) {
  const { store, ...rest } = p;
  const shown = rest.value * (rest.scale ?? 1);
  const d = rest.digits ?? (rest.step * (rest.scale ?? 1) < 0.01 ? 3 : rest.step * (rest.scale ?? 1) < 0.1 ? 2 : rest.step * (rest.scale ?? 1) < 1 ? 1 : 0);
  const commit = (v: number) => { if (Number.isFinite(v)) store.setOd(rest.path, v / (rest.scale ?? 1)); };
  return (
    <div className="control">
      <label>{rest.label}</label>
      <div className="val"><input className="num" type="number" aria-label={rest.label + (rest.unit ? ` (${rest.unit})` : '')} value={Number(shown.toFixed(d))} step={rest.step * (rest.scale ?? 1)} onChange={(e) => commit(parseFloat(e.target.value))} /><span className="unit">{rest.unit ?? ''}</span></div>
      <input type="range" min={rest.min * (rest.scale ?? 1)} max={rest.max * (rest.scale ?? 1)} step={rest.step * (rest.scale ?? 1)} value={shown} onChange={(e) => commit(parseFloat(e.target.value))} aria-label={rest.label} />
    </div>
  );
}

export function Controls({ store }: { store: Store }) {
  const i = store.state.inputs;
  const od = store.state.od;
  const designWf = 'error' in store.design ? 1 : store.design.perf.Wfuel;
  const S = (p: Omit<SliderProps, 'store'>) => <Slider {...p} store={store} />;
  const arch = i.arch;
  const presets = [...PRESETS, ...REFERENCE_PRESETS];
  return (
    <div>
      <Section title="Architecture">
        <div className="segmented" style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
          {(['turbojet', 'turbofan', 'turboprop'] as Architecture[]).map((a) => (
            <button key={a} className={arch === a ? 'on' : ''} onClick={() => store.dispatch({ type: 'arch', arch: a })}>{t(a[0].toUpperCase() + a.slice(1))}</button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <select className="select" value="" onChange={(e) => { const p = presets.find((x) => x.name === e.target.value); if (p) store.dispatch({ type: 'inputs', inputs: JSON.parse(JSON.stringify(p.inputs)), note: p.group === 'pyCycle reference' ? 'pyCycle reference case: inputs identical to the validation run.' : undefined }); }} aria-label="Load generic preset">
            <option value="">{t('Generic preset…')}</option>
            {['Turbojet', 'Turbofan', 'Turboprop', 'pyCycle reference'].map((g) => (
              <optgroup key={g} label={g}>{presets.filter((p) => p.group === g).map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>
            ))}
          </select>
          <button className="btn" onClick={() => store.dispatch({ type: 'reset' })} title="Reset to defaults">{t('Reset')}</button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <select className="select" value="" onChange={(e) => { const spec = ENGINES.find((x) => x.name === e.target.value); if (spec) { const c = calibrateEngine(spec); store.dispatch({ type: 'inputs', inputs: c.inputs, note: c.note }); } }} aria-label="Load commercial engine">
            <option value="">{t('Commercial engine…')}</option>
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

      <Section title="Operating point" hint={store.odBusy ? 'solving…' : undefined}>
        <div className="segmented" style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <button className={store.state.mode === 'design' ? 'on' : ''} aria-pressed={!!(store.state.mode === 'design')} onClick={() => store.dispatch({ type: 'mode', mode: 'design' })}>{t('Design point')}</button>
          <button className={store.state.mode === 'offdesign' ? 'on' : ''} aria-pressed={!!(store.state.mode === 'offdesign')} onClick={() => store.dispatch({ type: 'mode', mode: 'offdesign' })}>{t('Off-design')}</button>
        </div>
        {store.state.mode === 'offdesign' ? (
          <div style={{ marginTop: 8 }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 4 }}>Geometry, maps and areas are frozen at the design point below; speeds, flows and bypass ratio float.</div>
            <OdSlider label="Altitude" path="altitude_m" value={od.altitude_m} min={0} max={20000} step={100} unit="m" store={store} />
            <OdSlider label="Mach number" path="mach" value={od.mach} min={0} max={2.5} step={0.01} unit="M" store={store} />
            <OdSlider label="ΔT from ISA" path="dT_isa" value={od.dT_isa} min={-40} max={40} step={1} unit="K" store={store} />
            <div className="control">
              <label>Throttle by</label>
              <div className="segmented">
                <button className={od.throttle.mode === 'T4' ? 'on' : ''} aria-pressed={!!(od.throttle.mode === 'T4')} onClick={() => store.setOd('throttle', { mode: 'T4', value: i.burner.T4_K })}>T4</button>
                <button className={od.throttle.mode === 'Wf' ? 'on' : ''} aria-pressed={!!(od.throttle.mode === 'Wf')} onClick={() => store.setOd('throttle', { mode: 'Wf', value: designWf })}>Fuel flow</button>
                <button className={od.throttle.mode === 'NHP' ? 'on' : ''} aria-pressed={!!(od.throttle.mode === 'NHP')} onClick={() => store.setOd('throttle', { mode: 'NHP', value: 1 })}>N HP</button>
              </div>
            </div>
            {od.throttle.mode === 'T4' && <OdSlider label="Turbine inlet temperature T4" path="throttle.value" value={od.throttle.value} min={900} max={2100} step={5} unit="K" store={store} />}
            {od.throttle.mode === 'Wf' && <OdSlider label="Fuel flow" path="throttle.value" value={od.throttle.value} min={designWf * 0.2} max={designWf * 1.3} step={designWf / 200} unit="kg/s" store={store} digits={4} />}
            {od.throttle.mode === 'NHP' && <OdSlider label="HP spool speed" path="throttle.value" value={od.throttle.value} min={0.6} max={1.1} step={0.001} unit="% design" scale={100} digits={1} store={store} />}
            {arch === 'turboprop' && <OdSlider label="Propeller load (shaft power)" path="propPower_W" value={od.propPower_W ?? i.prop.shaftPower_W} min={50e3} max={i.prop.shaftPower_W * 1.2} step={5e3} unit="kW" scale={1e-3} digits={0} store={store} />}
            <OdSlider label="Power extraction" path="HPX_W" value={od.HPX_W ?? 0} min={0} max={1000e3} step={5e3} unit="kW" scale={1e-3} digits={0} store={store} />
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>All sliders below define the design point: component pressure ratios and efficiencies are specified, turbine pressure ratios are solved for the shaft balance, and nozzle and mixer areas follow.</div>
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
          <Section title="Layout">
            <div className="control">
              <label>Spools</label>
              <div className="segmented">
                <button className={i.spools === 2 ? 'on' : ''} aria-pressed={!!(i.spools === 2)} onClick={() => { if (i.spools === 3) { const core = i.ipc.PR * i.hpc.PR; const inp = { ...i, spools: 2 as const, lpc: { ...i.lpc, PR: Math.min(3, Math.sqrt(core) * 0.45 + 1) }, hpc: { ...i.hpc, PR: core / Math.min(3, Math.sqrt(core) * 0.45 + 1) } }; store.dispatch({ type: 'inputs', inputs: inp, note: store.state.note ?? undefined }); } }}>Two (fan + booster)</button>
                <button className={i.spools === 3 ? 'on' : ''} aria-pressed={!!(i.spools === 3)} onClick={() => { if (i.spools === 2) { const core = i.lpc.PR * i.hpc.PR; const ipc = Math.sqrt(core) * 0.9, hpc = core / ipc; store.dispatch({ type: 'inputs', inputs: { ...i, spools: 3 as const, ipc: { ...i.ipc, PR: ipc }, hpc: { ...i.hpc, PR: hpc } }, note: store.state.note ?? undefined }); } }}>Three (IP spool)</button>
              </div>
            </div>
            <div className="control">
              <label>Exhaust</label>
              <div className="segmented">
                <button className={!i.mixed ? 'on' : ''} aria-pressed={!!(!i.mixed)} onClick={() => store.set('mixed', false)}>Separate flow</button>
                <button className={i.mixed ? 'on' : ''} aria-pressed={!!(i.mixed)} onClick={() => store.set('mixed', true)}>Mixed flow</button>
              </div>
            </div>
            {S({ label: 'Fan gear ratio (1 = direct drive)', path: 'fanGear.ratio', value: i.fanGear.ratio, min: 1, max: 4, step: 0.01 })}
            {i.fanGear.ratio !== 1 && S({ label: 'Fan gearbox efficiency', path: 'fanGear.eff', value: i.fanGear.eff, min: 0.97, max: 1, step: 0.001 })}
            {i.mixed && (
              <div className="control">
                <label>Mixer sizing</label>
                <div className="segmented">
                  <button className={(i.mixer.designedStream ?? 'bypass') === 'bypass' ? 'on' : ''} aria-pressed={!!((i.mixer.designedStream ?? 'bypass') === 'bypass')} onClick={() => store.set('mixer.designedStream', 'bypass')}>Core Mach given</button>
                  <button className={i.mixer.designedStream === 'core' ? 'on' : ''} aria-pressed={!!(i.mixer.designedStream === 'core')} onClick={() => store.set('mixer.designedStream', 'core')}>Bypass Mach given</button>
                </div>
              </div>
            )}
            {i.mixed && i.mixer.designedStream !== 'core' && S({ label: 'Mixer core Mach (sizing)', path: 'mixer.MNcore', value: i.mixer.MNcore, min: 0.2, max: 0.7, step: 0.01 })}
            {i.mixed && i.mixer.designedStream === 'core' && S({ label: 'Mixer bypass Mach (sizing)', path: 'mixer.MNbyp', value: i.mixer.MNbyp ?? 0.45, min: 0.2, max: 0.7, step: 0.01 })}
            {i.mixed && S({ label: 'Mixer pressure loss ΔP/P', path: 'mixer.dPqP', value: i.mixer.dPqP, min: 0, max: 0.05, step: 0.001 })}
          </Section>
          <Section title="Fan & bypass">
            {S({ label: 'Fan pressure ratio', path: 'fan.PR', value: i.fan.PR, min: 1.1, max: 4, step: 0.01 })}
            {S({ label: 'Fan isentropic efficiency', path: 'fan.eff', value: i.fan.eff, min: 0.75, max: 0.95, step: 0.001 })}
            {S({ label: 'Bypass ratio', path: 'BPR', value: i.BPR, min: 0.2, max: 15, step: 0.1 })}
            {S({ label: 'Bypass duct loss ΔP/P', path: 'bypDuct_dPqP', value: i.bypDuct_dPqP, min: 0, max: 0.05, step: 0.001 })}
          </Section>
          <Section title="Core compressors">
            {i.spools === 2 && S({ label: 'Booster (LPC) pressure ratio', path: 'lpc.PR', value: i.lpc.PR, min: 1, max: 5, step: 0.01 })}
            {i.spools === 2 && S({ label: 'Booster efficiency', path: 'lpc.eff', value: i.lpc.eff, min: 0.75, max: 0.95, step: 0.001 })}
            {i.spools === 3 && S({ label: 'IP compressor pressure ratio', path: 'ipc.PR', value: i.ipc.PR, min: 1.5, max: 10, step: 0.01 })}
            {i.spools === 3 && S({ label: 'IP compressor efficiency', path: 'ipc.eff', value: i.ipc.eff, min: 0.75, max: 0.95, step: 0.001 })}
            {S({ label: 'HPC pressure ratio', path: 'hpc.PR', value: i.hpc.PR, min: 2, max: 30, step: 0.1 })}
            {S({ label: 'HPC efficiency', path: 'hpc.eff', value: i.hpc.eff, min: 0.75, max: 0.95, step: 0.001 })}
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
        {arch === 'turbofan' && i.spools === 3 && S({ label: 'IP turbine efficiency', path: 'ipt.eff', value: i.ipt.eff, min: 0.8, max: 0.95, step: 0.001 })}
        {arch !== 'turbojet' && S({ label: arch === 'turbofan' ? 'LP turbine efficiency' : 'Power turbine efficiency', path: 'lpt.eff', value: i.lpt.eff, min: 0.8, max: 0.95, step: 0.001 })}
        {S({ label: 'Shaft mechanical efficiency', path: 'mechEff', value: i.mechEff, min: 0.95, max: 1, step: 0.001 })}
        {S({ label: 'Power extraction (HP shaft)', path: 'HPX_W', value: i.HPX_W, min: 0, max: 1000e3, step: 5e3, unit: 'kW', scale: 1e-3, digits: 0 })}
      </Section>

      {(arch === 'turbojet' || (arch === 'turbofan' && i.mixed)) && (
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
          {S({ label: 'Gear ratio (turbine rpm / propeller rpm)', path: 'prop.gearRatio', value: i.prop.gearRatio, min: 5, max: 30, step: 0.1 })}
        </Section>
      )}

      <Section title={arch === 'turbofan' ? 'Nozzles' : 'Nozzle'}>
        {arch !== 'turboprop' && (
          <div className="control">
            <label>{arch === 'turbofan' ? (i.mixed ? 'Mixed nozzle type' : 'Core nozzle type') : 'Nozzle type'}</label>
            <div className="segmented">
              <button className={i.coreNozzle.type === 'CV' ? 'on' : ''} aria-pressed={!!(i.coreNozzle.type === 'CV')} onClick={() => store.set('coreNozzle.type', 'CV')}>Convergent</button>
              <button className={i.coreNozzle.type === 'CD' ? 'on' : ''} aria-pressed={!!(i.coreNozzle.type === 'CD')} onClick={() => store.set('coreNozzle.type', 'CD')}>Con-di</button>
            </div>
          </div>
        )}
        {S({ label: arch === 'turbofan' ? 'Core velocity coefficient Cv' : 'Velocity coefficient Cv', path: 'coreNozzle.Cv', value: i.coreNozzle.Cv, min: 0.9, max: 1, step: 0.001 })}
        {arch === 'turbofan' && !i.mixed && (
          <>
            <div className="control">
              <label>Bypass nozzle type</label>
              <div className="segmented">
                <button className={i.bypNozzle.type === 'CV' ? 'on' : ''} aria-pressed={!!(i.bypNozzle.type === 'CV')} onClick={() => store.set('bypNozzle.type', 'CV')}>Convergent</button>
                <button className={i.bypNozzle.type === 'CD' ? 'on' : ''} aria-pressed={!!(i.bypNozzle.type === 'CD')} onClick={() => store.set('bypNozzle.type', 'CD')}>Con-di</button>
              </div>
            </div>
            {S({ label: 'Bypass velocity coefficient Cv', path: 'bypNozzle.Cv', value: i.bypNozzle.Cv, min: 0.9, max: 1, step: 0.001 })}
          </>
        )}
      </Section>

      <Section title="Variable geometry & bleeds" hint="design values">
        {S({ label: 'Customer bleed (HPC exit)', path: 'geometry.customerBleed_kgs', value: i.geometry.customerBleed_kgs, min: 0, max: arch === 'turboprop' ? 1 : 5, step: 0.01, unit: 'kg/s' })}
        {S({ label: 'Handling bleed (booster / compressor exit)', path: 'geometry.handlingBleedFrac', value: i.geometry.handlingBleedFrac, min: 0, max: 0.2, step: 0.005, unit: '%', scale: 100, digits: 1 })}
        {S({ label: 'Variable stator flow gain', path: 'geometry.vsvFlowGain', value: i.geometry.vsvFlowGain, min: -1, max: 1, step: 0.01 })}
        {store.state.mode === 'offdesign' && (
          <>
            <OdSlider label="Off-design: nozzle throat area A8" path="geometry.A8scale" value={od.geometry?.A8scale ?? i.geometry.A8scale} min={0.7} max={1.4} step={0.01} unit="× design" store={store} />
            <OdSlider label="Off-design: customer bleed" path="geometry.customerBleed_kgs" value={od.geometry?.customerBleed_kgs ?? i.geometry.customerBleed_kgs} min={0} max={5} step={0.01} unit="kg/s" store={store} />
            <OdSlider label="Off-design: handling bleed" path="geometry.handlingBleedFrac" value={od.geometry?.handlingBleedFrac ?? i.geometry.handlingBleedFrac} min={0} max={0.2} step={0.005} unit="%" scale={100} digits={1} store={store} />
          </>
        )}
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>Variable stator gain: map corrected flow × (1 + gain·(Nc/Nc,des − 1)) on the fan and HPC. Negative gain closes stators at low speed.</div>
      </Section>

      {arch === 'turbofan' && (
        <Section title="Secondary air system" hint="orifice network, off-design">
          <label className="toggle"><input type="checkbox" checked={!!i.sas?.enabled} onChange={(e) => store.set('sas.enabled', e.target.checked)} /> Compute bleed and cooling flows from pressures off-design</label>
          {i.sas?.enabled && (
            <>
              {S({ label: 'Interstage seal feed pressure (0 = P25, 1 = P3)', path: 'sas.interstageFrac', value: i.sas.interstageFrac, min: 0, max: 1, step: 0.05 })}
              {S({ label: 'Turbine cavity pressure / P45', path: 'sas.cavityPressureFrac', value: i.sas.cavityPressureFrac, min: 0.6, max: 1.1, step: 0.01 })}
              {S({ label: 'Overboard leakage at design', path: 'sas.leakFrac', value: i.sas.leakFrac, min: 0, max: 0.02, step: 0.001, unit: '% W25', scale: 100, digits: 1 })}
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>Orifices are sized at the design point to pass the design cooling, customer and leakage flows. Off-design, each flow follows the compressible orifice law on the gas-path pressures; a reversed interstage seal is flagged as hot-gas ingestion.</div>
            </>
          )}
        </Section>
      )}

      <Section title="Installation" hint="nacelle, inlet, afterbody">
        <label className="toggle"><input type="checkbox" checked={i.installation.enabled} onChange={(e) => store.set('installation.enabled', e.target.checked)} /> Report installed thrust</label>
        {i.installation.enabled && (
          <>
            {S({ label: 'Design inlet capture ratio A0/A_highlight', path: 'installation.captureRatioDesign', value: i.installation.captureRatioDesign, min: 0.6, max: 1, step: 0.01 })}
            {S({ label: 'Nacelle skin-friction coefficient', path: 'installation.nacelleCf', value: i.installation.nacelleCf, min: 0.001, max: 0.006, step: 0.0001, digits: 4 })}
            {S({ label: 'Afterbody drag coefficient', path: 'installation.afterbodyCd', value: i.installation.afterbodyCd, min: 0, max: 0.1, step: 0.001 })}
          </>
        )}
      </Section>

      <Section title="Spool inertia" hint="for transients">
        {arch === 'turbofan' && S({ label: 'LP spool', path: 'inertia.LP', value: i.inertia.LP, min: 0.5, max: 400, step: 0.5, unit: 'kg·m²' })}
        {arch === 'turbofan' && i.spools === 3 && S({ label: 'IP spool', path: 'inertia.IP', value: i.inertia.IP, min: 0.5, max: 100, step: 0.5, unit: 'kg·m²' })}
        {S({ label: arch === 'turbofan' ? 'HP spool' : arch === 'turboprop' ? 'Gas-generator spool' : 'Spool', path: 'inertia.HP', value: i.inertia.HP, min: 0.05, max: 60, step: 0.05, unit: 'kg·m²' })}
      </Section>

      <Section title="Design shaft speeds" hint="for corrected-speed maps">
        {arch === 'turbofan' && S({ label: 'LP spool', path: 'speeds.LP', value: i.speeds.LP, min: 1000, max: 20000, step: 10, unit: 'rpm' })}
        {arch === 'turbofan' && i.spools === 3 && S({ label: 'IP spool', path: 'speeds.IP', value: i.speeds.IP, min: 2000, max: 20000, step: 10, unit: 'rpm' })}
        {S({ label: arch === 'turbofan' ? 'HP spool' : arch === 'turboprop' ? 'Gas-generator spool' : 'Spool', path: 'speeds.HP', value: i.speeds.HP, min: 3000, max: 60000, step: 10, unit: 'rpm' })}
        {arch === 'turboprop' && S({ label: 'Power turbine', path: 'speeds.PT', value: i.speeds.PT, min: 3000, max: 45000, step: 10, unit: 'rpm' })}
      </Section>

      <Section title="Turbine cooling" hint="effectiveness model">
        <div className="control">
          <label>Cooling flow</label>
          <div className="segmented">
            <button className={i.cooling.mode === 'fixed' ? 'on' : ''} aria-pressed={!!(i.cooling.mode === 'fixed')} onClick={() => store.set('cooling.mode', 'fixed')}>Fixed fractions</button>
            <button className={i.cooling.mode === 'computed' ? 'on' : ''} aria-pressed={!!(i.cooling.mode === 'computed')} onClick={() => store.set('cooling.mode', 'computed')}>From metal temperature</button>
          </div>
        </div>
        {i.cooling.mode === 'fixed' ? (
          <>
            {S({ label: 'Cooling bleed entering before the first turbine row (does work)', path: 'coolInletFrac', value: i.coolInletFrac, min: 0, max: 0.2, step: 0.005, unit: '%', scale: 100, digits: 1 })}
            {S({ label: 'Cooling bleed entering after the turbine (no work)', path: 'coolExitFrac', value: i.coolExitFrac, min: 0, max: 0.1, step: 0.005, unit: '%', scale: 100, digits: 1 })}
          </>
        ) : (
          S({ label: 'Target blade metal temperature', path: 'cooling.targetMetal_K', value: i.cooling.targetMetal_K, min: 1000, max: 1400, step: 5, unit: 'K' })
        )}
        {S({ label: 'Maximum cooling effectiveness', path: 'cooling.effectivenessMax', value: i.cooling.effectivenessMax, min: 0.4, max: 0.85, step: 0.01 })}
        {S({ label: 'Coolant temperature rise (pre-swirl, ducting)', path: 'cooling.coolantTempRise_K', value: i.cooling.coolantTempRise_K, min: 0, max: 150, step: 5, unit: 'K' })}
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>ε = (T4 − T_metal)/(T4 − T_coolant), ε(m) = ε_max·m/(m + 3 %). Metal temperature and a creep-life estimate (25 000 h at 1200 K, halving every 20 K) are reported under the turbine.</div>
      </Section>

      <Section title="Fuel & gas model" hint="CEA polynomials">
        <div className="control">
          <label>Fuel</label>
          <select className="select" style={{ width: 'auto' }} value={i.fuel ?? 'jetA'} onChange={(e) => store.set('fuel', e.target.value)} aria-label="Fuel">
            <option value="jetA">Jet-A (kerosene, C12H23)</option><option value="saf">Synthetic paraffinic kerosene (SAF)</option><option value="hydrogen">Hydrogen</option><option value="methane">Methane (LNG)</option>
          </select>
        </div>
        {S({ label: 'Ambient relative humidity', path: 'humidity.relative', value: i.humidity?.relative ?? 0, min: 0, max: 1, step: 0.01, unit: '%', scale: 100, digits: 0 })}
        <div className="control">
          <label>Chemistry</label>
          <div className="segmented">
            <button className={(i.chemistry ?? 'equilibrium') === 'equilibrium' ? 'on' : ''} aria-pressed={!!((i.chemistry ?? 'equilibrium') === 'equilibrium')} onClick={() => store.set('chemistry', 'equilibrium')}>Equilibrium</button>
            <button className={i.chemistry === 'frozen' ? 'on' : ''} aria-pressed={!!(i.chemistry === 'frozen')} onClick={() => store.set('chemistry', 'frozen')}>Frozen</button>
          </div>
        </div>
        {S({ label: 'Fuel enthalpy as supplied', path: 'burner.fuel_h_Jkg', value: i.burner.fuel_h_Jkg, min: -2000e3, max: 500e3, step: 10e3, unit: 'kJ/kg', scale: 1e-3, digits: 0 })}
        {S({ label: 'Lower heating value (efficiency metrics)', path: 'LHV_Jkg', value: i.LHV_Jkg, min: 40e6, max: 45e6, step: 0.1e6, unit: 'MJ/kg', scale: 1e-6, digits: 1 })}
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>
          Fuel enthalpy 0 kJ/kg reproduces pyCycle's convention. Stoichiometric FAR for Jet-A in dry air is {fmt(0.0678, 4)}.
        </div>
      </Section>
    </div>
  );
}
