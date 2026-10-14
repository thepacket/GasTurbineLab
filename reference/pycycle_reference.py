"""
Generate pyCycle (NASA, CEA thermodynamics) design-point reference data for
GasTurbineLab validation.  Run with:

    python -m venv venv && ./venv/bin/pip install om-pycycle
    ./venv/bin/python reference/pycycle_reference.py > src/data/pycycle_reference.json

Nothing in the web app depends on Python at runtime - the JSON is bundled.
"""
import json, sys
import numpy as np
import openmdao.api as om
import pycycle.api as pyc

PSI = 'Pa'; R = 'degK'; LB = 'kg/s'; LBF = 'N'; HP = 'W'


def solver(grp):
    grp.nonlinear_solver = om.NewtonSolver()
    grp.nonlinear_solver.options['atol'] = 1e-8
    grp.nonlinear_solver.options['rtol'] = 1e-8
    grp.nonlinear_solver.options['iprint'] = -1
    grp.nonlinear_solver.options['maxiter'] = 60
    grp.nonlinear_solver.options['solve_subsystems'] = True
    grp.nonlinear_solver.options['max_sub_solves'] = 100
    grp.nonlinear_solver.linesearch = om.BoundsEnforceLS()
    grp.nonlinear_solver.linesearch.options['bound_enforcement'] = 'scalar'
    grp.nonlinear_solver.linesearch.options['iprint'] = -1
    grp.linear_solver = om.DirectSolver()


# ---------------------------------------------------------------- turbojet
class Turbojet(pyc.Cycle):
    def setup(self):
        self.add_subsystem('fc', pyc.FlightConditions())
        self.add_subsystem('inlet', pyc.Inlet())
        self.add_subsystem('comp', pyc.Compressor(map_data=pyc.AXI5, map_extrap=True), promotes_inputs=['Nmech'])
        self.add_subsystem('burner', pyc.Combustor(fuel_type='Jet-A(g)'))
        self.add_subsystem('turb', pyc.Turbine(map_data=pyc.LPT2269, map_extrap=True), promotes_inputs=['Nmech'])
        self.add_subsystem('nozz', pyc.Nozzle(nozzType='CD', lossCoef='Cv'))
        self.add_subsystem('shaft', pyc.Shaft(num_ports=2), promotes_inputs=['Nmech'])
        self.add_subsystem('perf', pyc.Performance(num_nozzles=1, num_burners=1))

        self.connect('inlet.Fl_O:tot:P', 'perf.Pt2')
        self.connect('comp.Fl_O:tot:P', 'perf.Pt3')
        self.connect('burner.Wfuel', 'perf.Wfuel_0')
        self.connect('inlet.F_ram', 'perf.ram_drag')
        self.connect('nozz.Fg', 'perf.Fg_0')
        self.connect('comp.trq', 'shaft.trq_0')
        self.connect('turb.trq', 'shaft.trq_1')
        self.connect('fc.Fl_O:stat:P', 'nozz.Ps_exhaust')

        bal = self.add_subsystem('balance', om.BalanceComp())
        bal.add_balance('FAR', eq_units='degR', lower=1e-4, val=.017)
        self.connect('balance.FAR', 'burner.Fl_I:FAR')
        self.connect('burner.Fl_O:tot:T', 'balance.lhs:FAR')
        bal.add_balance('turb_PR', val=1.5, lower=1.001, upper=8, eq_units='hp', rhs_val=0.)
        self.connect('balance.turb_PR', 'turb.PR')
        self.connect('shaft.pwr_net', 'balance.lhs:turb_PR')

        self.pyc_connect_flow('fc.Fl_O', 'inlet.Fl_I')
        self.pyc_connect_flow('inlet.Fl_O', 'comp.Fl_I')
        self.pyc_connect_flow('comp.Fl_O', 'burner.Fl_I')
        self.pyc_connect_flow('burner.Fl_O', 'turb.Fl_I')
        self.pyc_connect_flow('turb.Fl_O', 'nozz.Fl_I')
        solver(self)
        super().setup()


def run_turbojet(case):
    p = om.Problem(); p.model = Turbojet(); p.setup(check=False); p.set_solver_print(level=-1)
    p.set_val('fc.alt', case['alt_m'], units='m'); p.set_val('fc.MN', max(case['mach'], 1e-6))
    p.set_val('fc.W', case['W_kgs'], units='kg/s')
    p.set_val('inlet.ram_recovery', case['ram_recovery']); p.set_val('inlet.MN', 0.60)
    p.set_val('comp.PR', case['PR']); p.set_val('comp.eff', case['eff_c']); p.set_val('comp.MN', 0.20)
    p.set_val('burner.dPqP', case['dPqP_b']); p.set_val('burner.MN', 0.20)
    p.set_val('balance.rhs:FAR', case['T4_K'], units='degK')
    p.set_val('turb.eff', case['eff_t']); p.set_val('turb.MN', 0.40)
    p.set_val('nozz.Cv', case['Cv']); p.set_val('Nmech', 8070.0, units='rpm')
    p.set_val('shaft.HPX', case.get('HPX_W', 0.0), units='W')
    p.run_model()
    check_converged(p)
    out = {'stations': {}}
    for name, st in [('inlet.Fl_O', '2'), ('comp.Fl_O', '3'), ('burner.Fl_O', '4'), ('turb.Fl_O', '5'), ('nozz.Fl_O', '9')]:
        out['stations'][st] = station(p, name)
    out['stations']['0'] = station(p, 'fc.Fl_O')
    out['perf'] = {
        'Fn_N': float(p.get_val('perf.Fn', units='N')[0]),
        'Fg_N': float(p.get_val('perf.Fg', units='N')[0]),
        'TSFC_kg_per_N_h': float(p.get_val('perf.TSFC', units='lbm/(h*lbf)')[0]) * 0.45359237 / 4.4482216,
        'Wfuel_kgs': float(p.get_val('perf.Wfuel', units='kg/s')[0]),
        'FAR': float(p['balance.FAR'][0]),
        'turb_PR': float(p['balance.turb_PR'][0]),
        'OPR': float(p['perf.OPR'][0]),
        'nozz_PR': float(p['nozz.PR'][0]),
        'nozz_Ath_m2': float(p.get_val('nozz.Throat:stat:area', units='m**2')[0]),
        'comp_power_W': float(p.get_val('comp.power', units='W')[0]),
    }
    return out


def check_converged(p):
    """Raise if the Newton solver did not drive the balances to zero."""
    import numpy as np
    res = []
    for bal in ['FAR', 'turb_PR', 'lpt_PR', 'hpt_PR', 'pt_PR']:
        try:
            lhs = p['balance.lhs:' + bal][0]; rhs = p['balance.rhs:' + bal][0]
        except KeyError:
            continue
        res.append(abs(lhs - rhs) / max(abs(rhs), 1.0))
    if not res or not np.all(np.isfinite(res)) or max(res) > 1e-5:
        raise RuntimeError('solver did not converge: residuals %s' % res)


def station(p, name):
    return {
        'Pt_Pa': float(p.get_val(name + ':tot:P', units='Pa')[0]),
        'Tt_K': float(p.get_val(name + ':tot:T', units='degK')[0]),
        'ht_J_kg': float(p.get_val(name + ':tot:h', units='J/kg')[0]),
        'W_kgs': float(p.get_val(name + ':stat:W', units='kg/s')[0]),
        'Ps_Pa': float(p.get_val(name + ':stat:P', units='Pa')[0]),
        'Ts_K': float(p.get_val(name + ':stat:T', units='degK')[0]),
        'V_ms': float(p.get_val(name + ':stat:V', units='m/s')[0]),
        'MN': float(p.get_val(name + ':stat:MN')[0]),
        'A_m2': float(p.get_val(name + ':stat:area', units='m**2')[0]),
    }


# ---------------------------------------------------------------- turbofan (separate flow, 2 spool)
class Turbofan(pyc.Cycle):
    def setup(self):
        self.add_subsystem('fc', pyc.FlightConditions())
        self.add_subsystem('inlet', pyc.Inlet())
        self.add_subsystem('fan', pyc.Compressor(map_data=pyc.FanMap, bleed_names=[], map_extrap=True), promotes_inputs=[('Nmech', 'LP_Nmech')])
        self.add_subsystem('splitter', pyc.Splitter())
        self.add_subsystem('duct4', pyc.Duct())
        self.add_subsystem('lpc', pyc.Compressor(map_data=pyc.LPCMap, map_extrap=True), promotes_inputs=[('Nmech', 'LP_Nmech')])
        self.add_subsystem('hpc', pyc.Compressor(map_data=pyc.HPCMap, bleed_names=['cool1', 'cool2'], map_extrap=True), promotes_inputs=[('Nmech', 'HP_Nmech')])
        self.add_subsystem('burner', pyc.Combustor(fuel_type='Jet-A(g)'))
        self.add_subsystem('hpt', pyc.Turbine(map_data=pyc.HPTMap, bleed_names=['cool1', 'cool2'], map_extrap=True), promotes_inputs=[('Nmech', 'HP_Nmech')])
        self.add_subsystem('lpt', pyc.Turbine(map_data=pyc.LPTMap, map_extrap=True), promotes_inputs=[('Nmech', 'LP_Nmech')])
        self.add_subsystem('core_nozz', pyc.Nozzle(nozzType='CV', lossCoef='Cv'))
        self.add_subsystem('byp_duct', pyc.Duct())
        self.add_subsystem('byp_nozz', pyc.Nozzle(nozzType='CV', lossCoef='Cv'))
        self.add_subsystem('lp_shaft', pyc.Shaft(num_ports=3), promotes_inputs=[('Nmech', 'LP_Nmech')])
        self.add_subsystem('hp_shaft', pyc.Shaft(num_ports=2), promotes_inputs=[('Nmech', 'HP_Nmech')])
        self.add_subsystem('perf', pyc.Performance(num_nozzles=2, num_burners=1))

        self.connect('inlet.Fl_O:tot:P', 'perf.Pt2'); self.connect('hpc.Fl_O:tot:P', 'perf.Pt3')
        self.connect('burner.Wfuel', 'perf.Wfuel_0'); self.connect('inlet.F_ram', 'perf.ram_drag')
        self.connect('core_nozz.Fg', 'perf.Fg_0'); self.connect('byp_nozz.Fg', 'perf.Fg_1')
        self.connect('fan.trq', 'lp_shaft.trq_0'); self.connect('lpc.trq', 'lp_shaft.trq_1'); self.connect('lpt.trq', 'lp_shaft.trq_2')
        self.connect('hpc.trq', 'hp_shaft.trq_0'); self.connect('hpt.trq', 'hp_shaft.trq_1')
        self.connect('fc.Fl_O:stat:P', 'core_nozz.Ps_exhaust'); self.connect('fc.Fl_O:stat:P', 'byp_nozz.Ps_exhaust')

        bal = self.add_subsystem('balance', om.BalanceComp())
        bal.add_balance('FAR', eq_units='degR', lower=1e-4, val=.017)
        self.connect('balance.FAR', 'burner.Fl_I:FAR'); self.connect('burner.Fl_O:tot:T', 'balance.lhs:FAR')
        bal.add_balance('lpt_PR', val=1.5, lower=1.001, upper=12, eq_units='hp', rhs_val=0.)
        self.connect('balance.lpt_PR', 'lpt.PR'); self.connect('lp_shaft.pwr_net', 'balance.lhs:lpt_PR')
        bal.add_balance('hpt_PR', val=1.5, lower=1.001, upper=8, eq_units='hp', rhs_val=0.)
        self.connect('balance.hpt_PR', 'hpt.PR'); self.connect('hp_shaft.pwr_net', 'balance.lhs:hpt_PR')

        self.pyc_connect_flow('fc.Fl_O', 'inlet.Fl_I'); self.pyc_connect_flow('inlet.Fl_O', 'fan.Fl_I')
        self.pyc_connect_flow('fan.Fl_O', 'splitter.Fl_I'); self.pyc_connect_flow('splitter.Fl_O1', 'duct4.Fl_I')
        self.pyc_connect_flow('duct4.Fl_O', 'lpc.Fl_I'); self.pyc_connect_flow('lpc.Fl_O', 'hpc.Fl_I')
        self.pyc_connect_flow('hpc.Fl_O', 'burner.Fl_I'); self.pyc_connect_flow('burner.Fl_O', 'hpt.Fl_I')
        self.pyc_connect_flow('hpt.Fl_O', 'lpt.Fl_I'); self.pyc_connect_flow('lpt.Fl_O', 'core_nozz.Fl_I')
        self.pyc_connect_flow('splitter.Fl_O2', 'byp_duct.Fl_I'); self.pyc_connect_flow('byp_duct.Fl_O', 'byp_nozz.Fl_I')
        self.pyc_connect_flow('hpc.cool1', 'hpt.cool1', connect_stat=False)
        self.pyc_connect_flow('hpc.cool2', 'hpt.cool2', connect_stat=False)
        solver(self)
        super().setup()


def run_turbofan(case):
    p = om.Problem(); p.model = Turbofan(); p.setup(check=False); p.set_solver_print(level=-1)
    p.set_val('fc.alt', case['alt_m'], units='m'); p.set_val('fc.MN', max(case['mach'], 1e-6)); p.set_val('fc.W', case['W_kgs'], units='kg/s')
    p.set_val('inlet.ram_recovery', case['ram_recovery']); p.set_val('inlet.MN', 0.65)
    p.set_val('fan.PR', case['FPR']); p.set_val('fan.eff', case['eff_fan']); p.set_val('fan.MN', 0.45)
    p.set_val('splitter.BPR', case['BPR']); p.set_val('splitter.MN1', 0.40); p.set_val('splitter.MN2', 0.45)
    p.set_val('duct4.dPqP', 0.0); p.set_val('duct4.MN', 0.40)
    p.set_val('lpc.PR', case['LPCPR']); p.set_val('lpc.eff', case['eff_lpc']); p.set_val('lpc.MN', 0.35)
    p.set_val('hpc.PR', case['HPCPR']); p.set_val('hpc.eff', case['eff_hpc']); p.set_val('hpc.MN', 0.30)
    p.set_val('hpc.cool1:frac_W', case['cool1_fracW']); p.set_val('hpc.cool1:frac_P', 1.0); p.set_val('hpc.cool1:frac_work', 1.0)
    p.set_val('hpc.cool2:frac_W', case['cool2_fracW']); p.set_val('hpc.cool2:frac_P', 1.0); p.set_val('hpc.cool2:frac_work', 1.0)
    p.set_val('burner.dPqP', case['dPqP_b']); p.set_val('burner.MN', 0.15)
    p.set_val('balance.rhs:FAR', case['T4_K'], units='degK')
    p.set_val('hpt.eff', case['eff_hpt']); p.set_val('hpt.MN', 0.30)
    p.set_val('hpt.cool1:frac_P', 1.0); p.set_val('hpt.cool2:frac_P', 0.0)
    p.set_val('lpt.eff', case['eff_lpt']); p.set_val('lpt.MN', 0.35)
    p.set_val('core_nozz.Cv', case['Cv']); p.set_val('byp_duct.dPqP', case['dPqP_byp']); p.set_val('byp_duct.MN', 0.45)
    p.set_val('byp_nozz.Cv', case['Cv'])
    p.set_val('LP_Nmech', 4666.1, units='rpm'); p.set_val('HP_Nmech', 14705.7, units='rpm')
    p.set_val('hp_shaft.HPX', case.get('HPX_W', 0.0), units='W')
    p.run_model()
    check_converged(p)
    out = {'stations': {}}
    for name, st in [('fc.Fl_O', '0'), ('inlet.Fl_O', '2'), ('fan.Fl_O', '21'), ('splitter.Fl_O1', '22'), ('lpc.Fl_O', '25'), ('hpc.Fl_O', '3'),
                     ('burner.Fl_O', '4'), ('hpt.Fl_O', '45'), ('lpt.Fl_O', '5'), ('core_nozz.Fl_O', '9'), ('splitter.Fl_O2', '13'), ('byp_duct.Fl_O', '17'), ('byp_nozz.Fl_O', '19')]:
        out['stations'][st] = station(p, name)
    out['perf'] = {
        'Fn_N': float(p.get_val('perf.Fn', units='N')[0]), 'Fg_N': float(p.get_val('perf.Fg', units='N')[0]),
        'Fg_core_N': float(p.get_val('core_nozz.Fg', units='N')[0]), 'Fg_byp_N': float(p.get_val('byp_nozz.Fg', units='N')[0]),
        'TSFC_kg_per_N_h': float(p.get_val('perf.TSFC', units='lbm/(h*lbf)')[0]) * 0.45359237 / 4.4482216,
        'Wfuel_kgs': float(p.get_val('perf.Wfuel', units='kg/s')[0]), 'FAR': float(p['balance.FAR'][0]),
        'hpt_PR': float(p['balance.hpt_PR'][0]), 'lpt_PR': float(p['balance.lpt_PR'][0]), 'OPR': float(p['perf.OPR'][0]),
        'core_nozz_PR': float(p['core_nozz.PR'][0]), 'byp_nozz_PR': float(p['byp_nozz.PR'][0]),
        'fan_power_W': float(p.get_val('fan.power', units='W')[0]), 'lpc_power_W': float(p.get_val('lpc.power', units='W')[0]),
        'hpc_power_W': float(p.get_val('hpc.power', units='W')[0]),
        'hpt_power_W': float(p.get_val('hpt.power', units='W')[0]), 'lpt_power_W': float(p.get_val('lpt.power', units='W')[0]),
    }
    return out


# ---------------------------------------------------------------- turboprop (free power turbine)
class Turboprop(pyc.Cycle):
    def setup(self):
        self.add_subsystem('fc', pyc.FlightConditions())
        self.add_subsystem('inlet', pyc.Inlet())
        self.add_subsystem('comp', pyc.Compressor(map_data=pyc.AXI5, map_extrap=True), promotes_inputs=[('Nmech', 'HP_Nmech')])
        self.add_subsystem('burner', pyc.Combustor(fuel_type='Jet-A(g)'))
        self.add_subsystem('turb', pyc.Turbine(map_data=pyc.HPT1269, map_extrap=True), promotes_inputs=[('Nmech', 'HP_Nmech')])
        self.add_subsystem('pt', pyc.Turbine(map_data=pyc.LPT2269, map_extrap=True), promotes_inputs=[('Nmech', 'LP_Nmech')])
        self.add_subsystem('nozz', pyc.Nozzle(nozzType='CV', lossCoef='Cv'))
        self.add_subsystem('hp_shaft', pyc.Shaft(num_ports=2), promotes_inputs=[('Nmech', 'HP_Nmech')])
        self.add_subsystem('lp_shaft', pyc.Shaft(num_ports=1), promotes_inputs=[('Nmech', 'LP_Nmech')])
        self.add_subsystem('perf', pyc.Performance(num_nozzles=1, num_burners=1))

        self.connect('inlet.Fl_O:tot:P', 'perf.Pt2'); self.connect('comp.Fl_O:tot:P', 'perf.Pt3')
        self.connect('burner.Wfuel', 'perf.Wfuel_0'); self.connect('inlet.F_ram', 'perf.ram_drag')
        self.connect('nozz.Fg', 'perf.Fg_0'); self.connect('lp_shaft.pwr_in', 'perf.power')
        self.connect('comp.trq', 'hp_shaft.trq_0'); self.connect('turb.trq', 'hp_shaft.trq_1')
        self.connect('pt.trq', 'lp_shaft.trq_0'); self.connect('fc.Fl_O:stat:P', 'nozz.Ps_exhaust')

        bal = self.add_subsystem('balance', om.BalanceComp())
        bal.add_balance('FAR', eq_units='degR', lower=1e-4, val=.017)
        self.connect('balance.FAR', 'burner.Fl_I:FAR'); self.connect('burner.Fl_O:tot:T', 'balance.lhs:FAR')
        bal.add_balance('turb_PR', val=1.5, lower=1.001, upper=8, eq_units='hp', rhs_val=0.)
        self.connect('balance.turb_PR', 'turb.PR'); self.connect('hp_shaft.pwr_net', 'balance.lhs:turb_PR')
        bal.add_balance('pt_PR', val=1.5, lower=1.001, upper=8, eq_units='hp', rhs_val=0.)
        self.connect('balance.pt_PR', 'pt.PR'); self.connect('lp_shaft.pwr_net', 'balance.lhs:pt_PR')

        self.pyc_connect_flow('fc.Fl_O', 'inlet.Fl_I'); self.pyc_connect_flow('inlet.Fl_O', 'comp.Fl_I')
        self.pyc_connect_flow('comp.Fl_O', 'burner.Fl_I'); self.pyc_connect_flow('burner.Fl_O', 'turb.Fl_I')
        self.pyc_connect_flow('turb.Fl_O', 'pt.Fl_I'); self.pyc_connect_flow('pt.Fl_O', 'nozz.Fl_I')
        solver(self)
        super().setup()


def run_turboprop(case):
    p = om.Problem(); p.model = Turboprop(); p.setup(check=False); p.set_solver_print(level=-1)
    p.set_val('fc.alt', case['alt_m'], units='m'); p.set_val('fc.MN', max(case['mach'], 1e-6)); p.set_val('fc.W', case['W_kgs'], units='kg/s')
    p.set_val('inlet.ram_recovery', case['ram_recovery']); p.set_val('inlet.MN', 0.40)
    p.set_val('comp.PR', case['PR']); p.set_val('comp.eff', case['eff_c']); p.set_val('comp.MN', 0.25)
    p.set_val('burner.dPqP', case['dPqP_b']); p.set_val('burner.MN', 0.15)
    p.set_val('balance.rhs:FAR', case['T4_K'], units='degK')
    p.set_val('turb.eff', case['eff_t']); p.set_val('turb.MN', 0.35)
    p.set_val('pt.eff', case['eff_pt']); p.set_val('pt.MN', 0.35)
    p.set_val('nozz.Cv', case['Cv'])
    p.set_val('HP_Nmech', 30000.0, units='rpm'); p.set_val('LP_Nmech', 20000.0, units='rpm')
    p.set_val('lp_shaft.HPX', case['shaft_power_W'], units='W')
    p.set_val('hp_shaft.HPX', case.get('HPX_W', 0.0), units='W')
    p.run_model()
    check_converged(p)
    out = {'stations': {}}
    for name, st in [('fc.Fl_O', '0'), ('inlet.Fl_O', '2'), ('comp.Fl_O', '3'), ('burner.Fl_O', '4'), ('turb.Fl_O', '45'), ('pt.Fl_O', '5'), ('nozz.Fl_O', '9')]:
        out['stations'][st] = station(p, name)
    out['perf'] = {
        'Fn_jet_N': float(p.get_val('perf.Fn', units='N')[0]), 'Fg_N': float(p.get_val('perf.Fg', units='N')[0]),
        'Wfuel_kgs': float(p.get_val('perf.Wfuel', units='kg/s')[0]), 'FAR': float(p['balance.FAR'][0]),
        'turb_PR': float(p['balance.turb_PR'][0]), 'pt_PR': float(p['balance.pt_PR'][0]), 'OPR': float(p['perf.OPR'][0]),
        'shaft_power_W': float(p.get_val('lp_shaft.pwr_in', units='W')[0]), 'pt_power_W': float(p.get_val('pt.power', units='W')[0]),
        'comp_power_W': float(p.get_val('comp.power', units='W')[0]), 'nozz_PR': float(p['nozz.PR'][0]),
    }
    return out


CASES = {
    'turbojet': [
        dict(name='Turbojet sea-level static', alt_m=0.0, mach=0.0, W_kgs=50.0, ram_recovery=0.99, PR=13.5, eff_c=0.86, dPqP_b=0.03, T4_K=1500.0, eff_t=0.90, Cv=0.99),
        dict(name='Turbojet M0.8 / 10 km', alt_m=10000.0, mach=0.8, W_kgs=22.0, ram_recovery=0.98, PR=12.0, eff_c=0.86, dPqP_b=0.03, T4_K=1450.0, eff_t=0.90, Cv=0.99),
        dict(name='Turbojet M2.0 / 15 km', alt_m=15000.0, mach=2.0, W_kgs=30.0, ram_recovery=0.92, PR=8.0, eff_c=0.85, dPqP_b=0.04, T4_K=1600.0, eff_t=0.89, Cv=0.98),
    ],
    'turbofan': [
        dict(name='HBPR turbofan SLS', alt_m=0.0, mach=0.0, W_kgs=400.0, ram_recovery=0.995, FPR=1.6, eff_fan=0.90, BPR=6.0, LPCPR=1.9, eff_lpc=0.89, HPCPR=11.0, eff_hpc=0.87,
             cool1_fracW=0.05, cool2_fracW=0.02, dPqP_b=0.04, T4_K=1650.0, eff_hpt=0.89, eff_lpt=0.91, Cv=0.995, dPqP_byp=0.01),
        dict(name='HBPR turbofan cruise M0.8 / 11 km', alt_m=11000.0, mach=0.8, W_kgs=170.0, ram_recovery=0.995, FPR=1.65, eff_fan=0.91, BPR=8.0, LPCPR=2.0, eff_lpc=0.89, HPCPR=12.0, eff_hpc=0.87,
             cool1_fracW=0.05, cool2_fracW=0.02, dPqP_b=0.04, T4_K=1550.0, eff_hpt=0.89, eff_lpt=0.91, Cv=0.995, dPqP_byp=0.01),
        dict(name='LBPR turbofan M0.9 / 9 km', alt_m=9000.0, mach=0.9, W_kgs=80.0, ram_recovery=0.98, FPR=3.0, eff_fan=0.87, BPR=0.8, LPCPR=1.5, eff_lpc=0.87, HPCPR=6.0, eff_hpc=0.86,
             cool1_fracW=0.04, cool2_fracW=0.02, dPqP_b=0.04, T4_K=1700.0, eff_hpt=0.88, eff_lpt=0.90, Cv=0.99, dPqP_byp=0.015),
    ],
    'turboprop': [
        dict(name='Turboprop SLS', alt_m=0.0, mach=0.0, W_kgs=7.0, ram_recovery=0.99, PR=10.0, eff_c=0.83, dPqP_b=0.04, T4_K=1350.0, eff_t=0.88, eff_pt=0.90, Cv=0.98, shaft_power_W=1.4e6),
        dict(name='Turboprop cruise M0.45 / 7.6 km', alt_m=7600.0, mach=0.45, W_kgs=4.5, ram_recovery=0.99, PR=11.0, eff_c=0.83, dPqP_b=0.04, T4_K=1300.0, eff_t=0.88, eff_pt=0.90, Cv=0.98, shaft_power_W=0.9e6),
    ],
}

if __name__ == '__main__':
    result = {'generator': 'pyCycle %s / OpenMDAO %s, CEA thermo (janaf), fuel Jet-A(g)' % (__import__('pycycle').__version__, __import__('openmdao').__version__), 'cases': []}
    runners = {'turbojet': run_turbojet, 'turbofan': run_turbofan, 'turboprop': run_turboprop}
    for arch, cases in CASES.items():
        for c in cases:
            print('running', c['name'], file=sys.stderr)
            try:
                r = runners[arch](c)
                result['cases'].append({'architecture': arch, 'inputs': c, **r})
            except Exception as e:  # keep going, report failures
                print('FAILED', c['name'], e, file=sys.stderr)
                result['cases'].append({'architecture': arch, 'inputs': c, 'error': str(e)})
    json.dump(result, sys.stdout, indent=1)
