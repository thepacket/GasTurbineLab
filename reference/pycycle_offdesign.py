"""
pyCycle off-design and mixed-flow reference cases for GasTurbineLab.
Run (Python 3.11, numpy<2):  venv311/bin/python reference/pycycle_offdesign.py > src/data/pycycle_offdesign.json
Design points use the same component maps the app ships (pyCycle's generic NPSS-style maps),
so the off-design points test the whole fixed-geometry solver: map scaling, continuity, shaft balances.
"""
import json, sys
import numpy as np
import openmdao.api as om
import pycycle.api as pyc

sys.path.insert(0, 'reference')
from pycycle_reference import solver, station, check_converged  # noqa


class Turbojet(pyc.Cycle):
    def setup(self):
        design = self.options['design']
        self.add_subsystem('fc', pyc.FlightConditions())
        self.add_subsystem('inlet', pyc.Inlet())
        self.add_subsystem('comp', pyc.Compressor(map_data=pyc.HPCMap, map_extrap=True), promotes_inputs=['Nmech'])
        self.add_subsystem('burner', pyc.Combustor(fuel_type='Jet-A(g)'))
        self.add_subsystem('turb', pyc.Turbine(map_data=pyc.HPTMap, map_extrap=True), promotes_inputs=['Nmech'])
        self.add_subsystem('nozz', pyc.Nozzle(nozzType='CD', lossCoef='Cv'))
        self.add_subsystem('shaft', pyc.Shaft(num_ports=2), promotes_inputs=['Nmech'])
        self.add_subsystem('perf', pyc.Performance(num_nozzles=1, num_burners=1))
        self.connect('inlet.Fl_O:tot:P', 'perf.Pt2'); self.connect('comp.Fl_O:tot:P', 'perf.Pt3')
        self.connect('burner.Wfuel', 'perf.Wfuel_0'); self.connect('inlet.F_ram', 'perf.ram_drag')
        self.connect('nozz.Fg', 'perf.Fg_0'); self.connect('comp.trq', 'shaft.trq_0'); self.connect('turb.trq', 'shaft.trq_1')
        self.connect('fc.Fl_O:stat:P', 'nozz.Ps_exhaust')
        bal = self.add_subsystem('balance', om.BalanceComp())
        bal.add_balance('FAR', eq_units='degR', lower=1e-4, val=.017)
        self.connect('balance.FAR', 'burner.Fl_I:FAR'); self.connect('burner.Fl_O:tot:T', 'balance.lhs:FAR')
        if design:
            bal.add_balance('turb_PR', val=1.5, lower=1.001, upper=8, eq_units='hp', rhs_val=0.)
            self.connect('balance.turb_PR', 'turb.PR'); self.connect('shaft.pwr_net', 'balance.lhs:turb_PR')
        else:
            bal.add_balance('Nmech', val=8000., units='rpm', lower=500., eq_units='hp', rhs_val=0.)
            self.connect('balance.Nmech', 'Nmech'); self.connect('shaft.pwr_net', 'balance.lhs:Nmech')
            bal.add_balance('W', val=50., units='lbm/s', lower=1., eq_units='inch**2')
            self.connect('balance.W', 'fc.W'); self.connect('nozz.Throat:stat:area', 'balance.lhs:W')
        self.pyc_connect_flow('fc.Fl_O', 'inlet.Fl_I'); self.pyc_connect_flow('inlet.Fl_O', 'comp.Fl_I')
        self.pyc_connect_flow('comp.Fl_O', 'burner.Fl_I'); self.pyc_connect_flow('burner.Fl_O', 'turb.Fl_I')
        self.pyc_connect_flow('turb.Fl_O', 'nozz.Fl_I')
        solver(self)
        super().setup()


class MPTurbojet(pyc.MPCycle):
    def setup(self):
        self.pyc_add_pnt('DESIGN', Turbojet())
        self.set_input_defaults('DESIGN.Nmech', 8070.0, units='rpm')
        self.set_input_defaults('DESIGN.inlet.MN', 0.60); self.set_input_defaults('DESIGN.comp.MN', 0.20)
        self.set_input_defaults('DESIGN.burner.MN', 0.20); self.set_input_defaults('DESIGN.turb.MN', 0.4)
        self.pyc_add_cycle_param('burner.dPqP', 0.03); self.pyc_add_cycle_param('nozz.Cv', 0.99); self.pyc_add_cycle_param('inlet.ram_recovery', 0.99)
        self.od_pts = ['OD1', 'OD2', 'OD3']
        for p in self.od_pts:
            self.pyc_add_pnt(p, Turbojet(design=False))
        self.pyc_use_default_des_od_conns()
        self.pyc_connect_des_od('nozz.Throat:stat:area', 'balance.rhs:W')
        super().setup()


def run_turbojet_mp(case):
    p = om.Problem(); p.model = MPTurbojet(); p.setup(check=False); p.set_solver_print(level=-1)
    p.set_val('DESIGN.fc.alt', case['alt_m'], units='m'); p.set_val('DESIGN.fc.MN', max(case['mach'], 1e-6)); p.set_val('DESIGN.fc.W', case['W_kgs'], units='kg/s')
    p.set_val('DESIGN.comp.PR', case['PR']); p.set_val('DESIGN.comp.eff', case['eff_c']); p.set_val('DESIGN.turb.eff', case['eff_t'])
    p.set_val('DESIGN.balance.rhs:FAR', case['T4_K'], units='degK')
    for name, od in zip(['OD1', 'OD2', 'OD3'], case['od']):
        p.set_val(name + '.fc.alt', od['alt_m'], units='m'); p.set_val(name + '.fc.MN', max(od['mach'], 1e-6))
        p.set_val(name + '.balance.rhs:FAR', od['T4_K'], units='degK')
        p[name + '.balance.W'] = case['W_kgs'] * 2.2 * wguess(od, case); p[name + '.balance.Nmech'] = 8070.0 * 0.97
    p.run_model()
    out = {'design': pack(p, 'DESIGN', ['inlet.Fl_O', 'comp.Fl_O', 'burner.Fl_O', 'turb.Fl_O', 'nozz.Fl_O'], ['2', '3', '4', '5', '9'])}
    out['design']['Nmech'] = 8070.0
    out['od'] = []
    for name, od in zip(['OD1', 'OD2', 'OD3'], case['od']):
        d = pack(p, name, ['inlet.Fl_O', 'comp.Fl_O', 'burner.Fl_O', 'turb.Fl_O', 'nozz.Fl_O'], ['2', '3', '4', '5', '9'])
        d['inputs'] = od; d['Nmech'] = float(p.get_val(name + '.balance.Nmech', units='rpm')[0]); d['W_kgs'] = float(p.get_val(name + '.balance.W', units='kg/s')[0])
        d['converged'], d['residuals'] = od_converged(p, name, ['shaft'], [('nozz.Throat:stat:area', 'nozz.Throat:stat:area')])
        d['comp'] = {'PR': float(p[name + '.comp.PR'][0]), 'eff': float(p[name + '.comp.eff'][0]), 'Rline': float(p[name + '.comp.map.RlineMap'][0]), 'NcMap': float(p[name + '.comp.map.NcMap'][0])}
        d['turb'] = {'PR': float(p[name + '.turb.PR'][0]), 'eff': float(p[name + '.turb.eff'][0])}
        out['od'].append(d)
    return out


def wguess(od, case):
    from pycycle.elements.US1976 import USatm1976Comp  # noqa
    import math
    def pamb(alt_m):
        h = alt_m / 1000.0
        return math.exp(-h / 7.2)
    r = pamb(od['alt_m']) / pamb(case['alt_m']) * (1 + 0.2 * od['mach'] ** 2) ** 3.5 / (1 + 0.2 * case['mach'] ** 2) ** 3.5
    return r * (0.85 + 0.15 * od['T4_K'] / case['T4_K'])


def od_converged(p, pnt, shafts, areas):
    import numpy as np
    res = []
    for sh in shafts:
        res.append(abs(float(p[pnt + '.' + sh + '.pwr_net'][0])) / max(abs(float(p[pnt + '.' + sh + '.pwr_in'][0])), 1.0))
    for a, des in areas:
        res.append(abs(float(p[pnt + '.' + a][0]) / float(p['DESIGN.' + des][0]) - 1.0))
    res.append(abs(float(p[pnt + '.balance.lhs:FAR'][0]) / float(p[pnt + '.balance.rhs:FAR'][0]) - 1.0))
    return bool(np.all(np.isfinite(res)) and max(res) < 1e-4), [float(x) for x in res]


def pack(p, pnt, names, ids):
    o = {'stations': {}}
    for n, i in zip(names, ids):
        o['stations'][i] = station(p, pnt + '.' + n)
    o['stations']['0'] = station(p, pnt + '.fc.Fl_O')
    o['perf'] = {'Fn_N': float(p.get_val(pnt + '.perf.Fn', units='N')[0]), 'Wfuel_kgs': float(p.get_val(pnt + '.perf.Wfuel', units='kg/s')[0]), 'FAR': float(p[pnt + '.balance.FAR'][0]), 'OPR': float(p[pnt + '.perf.OPR'][0])}
    return o


# ---------------------------------------------------------------- HBTF with off-design
class HBTF(pyc.Cycle):
    def setup(self):
        design = self.options['design']
        self.add_subsystem('fc', pyc.FlightConditions()); self.add_subsystem('inlet', pyc.Inlet())
        self.add_subsystem('fan', pyc.Compressor(map_data=pyc.FanMap, bleed_names=[], map_extrap=True), promotes_inputs=[('Nmech', 'LP_Nmech')])
        self.add_subsystem('splitter', pyc.Splitter()); self.add_subsystem('duct4', pyc.Duct())
        self.add_subsystem('lpc', pyc.Compressor(map_data=pyc.LPCMap, map_extrap=True), promotes_inputs=[('Nmech', 'LP_Nmech')])
        self.add_subsystem('hpc', pyc.Compressor(map_data=pyc.HPCMap, bleed_names=['cool1', 'cool2'], map_extrap=True), promotes_inputs=[('Nmech', 'HP_Nmech')])
        self.add_subsystem('burner', pyc.Combustor(fuel_type='Jet-A(g)'))
        self.add_subsystem('hpt', pyc.Turbine(map_data=pyc.HPTMap, bleed_names=['cool1', 'cool2'], map_extrap=True), promotes_inputs=[('Nmech', 'HP_Nmech')])
        self.add_subsystem('lpt', pyc.Turbine(map_data=pyc.LPTMap, map_extrap=True), promotes_inputs=[('Nmech', 'LP_Nmech')])
        self.add_subsystem('core_nozz', pyc.Nozzle(nozzType='CV', lossCoef='Cv'))
        self.add_subsystem('byp_duct', pyc.Duct()); self.add_subsystem('byp_nozz', pyc.Nozzle(nozzType='CV', lossCoef='Cv'))
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
        if design:
            bal.add_balance('lpt_PR', val=1.5, lower=1.001, upper=12, eq_units='hp', rhs_val=0.)
            self.connect('balance.lpt_PR', 'lpt.PR'); self.connect('lp_shaft.pwr_net', 'balance.lhs:lpt_PR')
            bal.add_balance('hpt_PR', val=1.5, lower=1.001, upper=8, eq_units='hp', rhs_val=0.)
            self.connect('balance.hpt_PR', 'hpt.PR'); self.connect('hp_shaft.pwr_net', 'balance.lhs:hpt_PR')
        else:
            bal.add_balance('W', units='lbm/s', lower=10., upper=3000., eq_units='inch**2')
            self.connect('balance.W', 'fc.W'); self.connect('core_nozz.Throat:stat:area', 'balance.lhs:W')
            bal.add_balance('BPR', lower=0.5, upper=20., eq_units='inch**2')
            self.connect('balance.BPR', 'splitter.BPR'); self.connect('byp_nozz.Throat:stat:area', 'balance.lhs:BPR')
            bal.add_balance('lp_Nmech', val=4666., units='rpm', lower=500., eq_units='hp', rhs_val=0.)
            self.connect('balance.lp_Nmech', 'LP_Nmech'); self.connect('lp_shaft.pwr_net', 'balance.lhs:lp_Nmech')
            bal.add_balance('hp_Nmech', val=14705., units='rpm', lower=500., eq_units='hp', rhs_val=0.)
            self.connect('balance.hp_Nmech', 'HP_Nmech'); self.connect('hp_shaft.pwr_net', 'balance.lhs:hp_Nmech')
        self.pyc_connect_flow('fc.Fl_O', 'inlet.Fl_I'); self.pyc_connect_flow('inlet.Fl_O', 'fan.Fl_I')
        self.pyc_connect_flow('fan.Fl_O', 'splitter.Fl_I'); self.pyc_connect_flow('splitter.Fl_O1', 'duct4.Fl_I')
        self.pyc_connect_flow('duct4.Fl_O', 'lpc.Fl_I'); self.pyc_connect_flow('lpc.Fl_O', 'hpc.Fl_I')
        self.pyc_connect_flow('hpc.Fl_O', 'burner.Fl_I'); self.pyc_connect_flow('burner.Fl_O', 'hpt.Fl_I')
        self.pyc_connect_flow('hpt.Fl_O', 'lpt.Fl_I'); self.pyc_connect_flow('lpt.Fl_O', 'core_nozz.Fl_I')
        self.pyc_connect_flow('splitter.Fl_O2', 'byp_duct.Fl_I'); self.pyc_connect_flow('byp_duct.Fl_O', 'byp_nozz.Fl_I')
        self.pyc_connect_flow('hpc.cool1', 'hpt.cool1', connect_stat=False); self.pyc_connect_flow('hpc.cool2', 'hpt.cool2', connect_stat=False)
        solver(self)
        super().setup()


class MPHBTF(pyc.MPCycle):
    def setup(self):
        self.pyc_add_pnt('DESIGN', HBTF())
        self.set_input_defaults('DESIGN.LP_Nmech', 4666.1, units='rpm'); self.set_input_defaults('DESIGN.HP_Nmech', 14705.7, units='rpm')
        for k, v in [('inlet.MN', 0.65), ('fan.MN', 0.45), ('splitter.MN1', 0.40), ('splitter.MN2', 0.45), ('duct4.MN', 0.40), ('lpc.MN', 0.35), ('hpc.MN', 0.30), ('burner.MN', 0.15), ('hpt.MN', 0.30), ('lpt.MN', 0.35), ('byp_duct.MN', 0.45)]:
            self.set_input_defaults('DESIGN.' + k, v)
        self.pyc_add_cycle_param('burner.dPqP', 0.04); self.pyc_add_cycle_param('core_nozz.Cv', 0.995); self.pyc_add_cycle_param('byp_nozz.Cv', 0.995)
        self.pyc_add_cycle_param('inlet.ram_recovery', 0.995); self.pyc_add_cycle_param('duct4.dPqP', 0.0); self.pyc_add_cycle_param('byp_duct.dPqP', 0.01)
        self.pyc_add_cycle_param('hpc.cool1:frac_W', 0.05); self.pyc_add_cycle_param('hpc.cool1:frac_P', 1.0); self.pyc_add_cycle_param('hpc.cool1:frac_work', 1.0)
        self.pyc_add_cycle_param('hpc.cool2:frac_W', 0.02); self.pyc_add_cycle_param('hpc.cool2:frac_P', 1.0); self.pyc_add_cycle_param('hpc.cool2:frac_work', 1.0)
        self.pyc_add_cycle_param('hpt.cool1:frac_P', 1.0); self.pyc_add_cycle_param('hpt.cool2:frac_P', 0.0)
        self.od_pts = ['OD1', 'OD2', 'OD3']
        for p in self.od_pts:
            self.pyc_add_pnt(p, HBTF(design=False))
        self.pyc_use_default_des_od_conns()
        self.pyc_connect_des_od('core_nozz.Throat:stat:area', 'balance.rhs:W')
        self.pyc_connect_des_od('byp_nozz.Throat:stat:area', 'balance.rhs:BPR')
        super().setup()


def run_hbtf_mp(case):
    p = om.Problem(); p.model = MPHBTF(); p.setup(check=False); p.set_solver_print(level=-1)
    p.set_val('DESIGN.fc.alt', case['alt_m'], units='m'); p.set_val('DESIGN.fc.MN', max(case['mach'], 1e-6)); p.set_val('DESIGN.fc.W', case['W_kgs'], units='kg/s')
    p.set_val('DESIGN.fan.PR', case['FPR']); p.set_val('DESIGN.fan.eff', case['eff_fan']); p.set_val('DESIGN.splitter.BPR', case['BPR'])
    p.set_val('DESIGN.lpc.PR', case['LPCPR']); p.set_val('DESIGN.lpc.eff', case['eff_lpc']); p.set_val('DESIGN.hpc.PR', case['HPCPR']); p.set_val('DESIGN.hpc.eff', case['eff_hpc'])
    p.set_val('DESIGN.hpt.eff', case['eff_hpt']); p.set_val('DESIGN.lpt.eff', case['eff_lpt']); p.set_val('DESIGN.balance.rhs:FAR', case['T4_K'], units='degK')
    for name, od in zip(['OD1', 'OD2', 'OD3'], case['od']):
        p.set_val(name + '.fc.alt', od['alt_m'], units='m'); p.set_val(name + '.fc.MN', max(od['mach'], 1e-6)); p.set_val(name + '.balance.rhs:FAR', od['T4_K'], units='degK')
        p[name + '.balance.W'] = case['W_kgs'] * 2.2 * wguess(od, case); p[name + '.balance.BPR'] = case['BPR'] * 1.05; p[name + '.balance.lp_Nmech'] = 4666.1 * 0.97; p[name + '.balance.hp_Nmech'] = 14705.7 * 0.97
    p.run_model()
    names = ['inlet.Fl_O', 'fan.Fl_O', 'splitter.Fl_O1', 'lpc.Fl_O', 'hpc.Fl_O', 'burner.Fl_O', 'hpt.Fl_O', 'lpt.Fl_O', 'core_nozz.Fl_O', 'splitter.Fl_O2', 'byp_duct.Fl_O', 'byp_nozz.Fl_O']
    ids = ['2', '21', '22', '25', '3', '4', '45', '5', '9', '13', '17', '19']
    out = {'design': pack(p, 'DESIGN', names, ids), 'od': []}
    out['design']['LP_Nmech'] = 4666.1; out['design']['HP_Nmech'] = 14705.7
    for name, od in zip(['OD1', 'OD2', 'OD3'], case['od']):
        d = pack(p, name, names, ids)
        d['inputs'] = od; d['LP_Nmech'] = float(p.get_val(name + '.balance.lp_Nmech', units='rpm')[0]); d['HP_Nmech'] = float(p.get_val(name + '.balance.hp_Nmech', units='rpm')[0])
        d['W_kgs'] = float(p.get_val(name + '.balance.W', units='kg/s')[0]); d['BPR'] = float(p[name + '.balance.BPR'][0])
        d['converged'], d['residuals'] = od_converged(p, name, ['lp_shaft', 'hp_shaft'], [('core_nozz.Throat:stat:area', 'core_nozz.Throat:stat:area'), ('byp_nozz.Throat:stat:area', 'byp_nozz.Throat:stat:area')])
        for c in ['fan', 'lpc', 'hpc']:
            d[c] = {'PR': float(p[name + '.' + c + '.PR'][0]), 'eff': float(p[name + '.' + c + '.eff'][0]), 'Rline': float(p[name + '.' + c + '.map.RlineMap'][0]), 'NcMap': float(p[name + '.' + c + '.map.NcMap'][0])}
        for t in ['hpt', 'lpt']:
            d[t] = {'PR': float(p[name + '.' + t + '.PR'][0]), 'eff': float(p[name + '.' + t + '.eff'][0])}
        out['od'].append(d)
    return out


# ---------------------------------------------------------------- mixed-flow turbofan design point
class MixedTF(pyc.Cycle):
    def setup(self):
        self.add_subsystem('fc', pyc.FlightConditions()); self.add_subsystem('inlet', pyc.Inlet())
        self.add_subsystem('fan', pyc.Compressor(map_data=pyc.FanMap, bleed_names=[], map_extrap=True), promotes_inputs=[('Nmech', 'LP_Nmech')])
        self.add_subsystem('splitter', pyc.Splitter()); self.add_subsystem('duct4', pyc.Duct())
        self.add_subsystem('lpc', pyc.Compressor(map_data=pyc.LPCMap, map_extrap=True), promotes_inputs=[('Nmech', 'LP_Nmech')])
        self.add_subsystem('hpc', pyc.Compressor(map_data=pyc.HPCMap, bleed_names=['cool1', 'cool2'], map_extrap=True), promotes_inputs=[('Nmech', 'HP_Nmech')])
        self.add_subsystem('burner', pyc.Combustor(fuel_type='Jet-A(g)'))
        self.add_subsystem('hpt', pyc.Turbine(map_data=pyc.HPTMap, bleed_names=['cool1', 'cool2'], map_extrap=True), promotes_inputs=[('Nmech', 'HP_Nmech')])
        self.add_subsystem('lpt', pyc.Turbine(map_data=pyc.LPTMap, map_extrap=True), promotes_inputs=[('Nmech', 'LP_Nmech')])
        self.add_subsystem('byp_duct', pyc.Duct())
        self.add_subsystem('mixer', pyc.Mixer(design=True, designed_stream=1))
        self.add_subsystem('nozz', pyc.Nozzle(nozzType='CV', lossCoef='Cv'))
        self.add_subsystem('lp_shaft', pyc.Shaft(num_ports=3), promotes_inputs=[('Nmech', 'LP_Nmech')])
        self.add_subsystem('hp_shaft', pyc.Shaft(num_ports=2), promotes_inputs=[('Nmech', 'HP_Nmech')])
        self.add_subsystem('perf', pyc.Performance(num_nozzles=1, num_burners=1))
        self.connect('inlet.Fl_O:tot:P', 'perf.Pt2'); self.connect('hpc.Fl_O:tot:P', 'perf.Pt3')
        self.connect('burner.Wfuel', 'perf.Wfuel_0'); self.connect('inlet.F_ram', 'perf.ram_drag'); self.connect('nozz.Fg', 'perf.Fg_0')
        self.connect('fan.trq', 'lp_shaft.trq_0'); self.connect('lpc.trq', 'lp_shaft.trq_1'); self.connect('lpt.trq', 'lp_shaft.trq_2')
        self.connect('hpc.trq', 'hp_shaft.trq_0'); self.connect('hpt.trq', 'hp_shaft.trq_1'); self.connect('fc.Fl_O:stat:P', 'nozz.Ps_exhaust')
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
        self.pyc_connect_flow('hpt.Fl_O', 'lpt.Fl_I'); self.pyc_connect_flow('lpt.Fl_O', 'mixer.Fl_I1')
        self.pyc_connect_flow('splitter.Fl_O2', 'byp_duct.Fl_I'); self.pyc_connect_flow('byp_duct.Fl_O', 'mixer.Fl_I2')
        self.pyc_connect_flow('mixer.Fl_O', 'nozz.Fl_I')
        self.pyc_connect_flow('hpc.cool1', 'hpt.cool1', connect_stat=False); self.pyc_connect_flow('hpc.cool2', 'hpt.cool2', connect_stat=False)
        solver(self)
        super().setup()


def run_mixed(case):
    p = om.Problem(); p.model = MixedTF(); p.setup(check=False); p.set_solver_print(level=-1)
    p.set_val('fc.alt', case['alt_m'], units='m'); p.set_val('fc.MN', max(case['mach'], 1e-6)); p.set_val('fc.W', case['W_kgs'], units='kg/s')
    p.set_val('inlet.ram_recovery', 0.98); p.set_val('inlet.MN', 0.6)
    p.set_val('fan.PR', case['FPR']); p.set_val('fan.eff', case['eff_fan']); p.set_val('fan.MN', 0.45)
    p.set_val('splitter.BPR', case['BPR']); p.set_val('splitter.MN1', 0.4); p.set_val('splitter.MN2', 0.45); p.set_val('duct4.dPqP', 0.0); p.set_val('duct4.MN', 0.4)
    p.set_val('lpc.PR', case['LPCPR']); p.set_val('lpc.eff', case['eff_lpc']); p.set_val('lpc.MN', 0.35)
    p.set_val('hpc.PR', case['HPCPR']); p.set_val('hpc.eff', case['eff_hpc']); p.set_val('hpc.MN', 0.3)
    p.set_val('hpc.cool1:frac_W', 0.04); p.set_val('hpc.cool1:frac_P', 1.0); p.set_val('hpc.cool1:frac_work', 1.0)
    p.set_val('hpc.cool2:frac_W', 0.02); p.set_val('hpc.cool2:frac_P', 1.0); p.set_val('hpc.cool2:frac_work', 1.0)
    p.set_val('burner.dPqP', 0.04); p.set_val('burner.MN', 0.15); p.set_val('balance.rhs:FAR', case['T4_K'], units='degK')
    p.set_val('hpt.eff', case['eff_hpt']); p.set_val('hpt.MN', 0.3); p.set_val('hpt.cool1:frac_P', 1.0); p.set_val('hpt.cool2:frac_P', 0.0)
    p.set_val('lpt.eff', case['eff_lpt']); p.set_val('lpt.MN', 0.35)
    p.set_val('byp_duct.dPqP', 0.015); p.set_val('byp_duct.MN', 0.45)
    p.set_val('nozz.Cv', 0.99)  # mixer core Mach follows lpt.MN (designed_stream=1)
    p.set_val('LP_Nmech', 4666.1, units='rpm'); p.set_val('HP_Nmech', 14705.7, units='rpm')
    p.run_model(); check_converged(p)
    names = ['inlet.Fl_O', 'fan.Fl_O', 'splitter.Fl_O1', 'lpc.Fl_O', 'hpc.Fl_O', 'burner.Fl_O', 'hpt.Fl_O', 'lpt.Fl_O', 'splitter.Fl_O2', 'byp_duct.Fl_O', 'mixer.Fl_O', 'nozz.Fl_O']
    ids = ['2', '21', '22', '25', '3', '4', '45', '5', '13', '17', '6', '9']
    out = {'stations': {}}
    for n, i in zip(names, ids):
        out['stations'][i] = station(p, n)
    out['stations']['0'] = station(p, 'fc.Fl_O')
    out['perf'] = {'Fn_N': float(p.get_val('perf.Fn', units='N')[0]), 'Wfuel_kgs': float(p.get_val('perf.Wfuel', units='kg/s')[0]), 'FAR': float(p['balance.FAR'][0]), 'hpt_PR': float(p['balance.hpt_PR'][0]), 'lpt_PR': float(p['balance.lpt_PR'][0]),
                   'mixer_Acore_m2': float(p.get_val('mixer.Fl_I1_calc:stat:area', units='m**2')[0]) if 'mixer.Fl_I1_calc:stat:area' in p.model._var_allprocs_abs2meta['output'] else None}
    return out


CASES = {
    'turbojet': dict(name='Turbojet SLS design, off-design throttle and altitude', alt_m=0.0, mach=0.0, W_kgs=50.0, PR=13.5, eff_c=0.86, T4_K=1500.0, eff_t=0.90,
                     od=[dict(alt_m=0.0, mach=0.0, T4_K=1350.0), dict(alt_m=6000.0, mach=0.6, T4_K=1450.0), dict(alt_m=10000.0, mach=0.8, T4_K=1300.0)]),
    'hbtf': dict(name='HBPR turbofan SLS design, off-design throttle, climb and cruise', alt_m=0.0, mach=0.0, W_kgs=400.0, FPR=1.6, eff_fan=0.90, BPR=6.0, LPCPR=1.9, eff_lpc=0.89, HPCPR=11.0, eff_hpc=0.87, T4_K=1650.0, eff_hpt=0.89, eff_lpt=0.91,
                 od=[dict(alt_m=0.0, mach=0.0, T4_K=1450.0), dict(alt_m=5000.0, mach=0.6, T4_K=1550.0), dict(alt_m=11000.0, mach=0.8, T4_K=1450.0)]),
    'mixed': dict(name='Mixed-flow low-bypass turbofan M0.8 / 9 km', alt_m=9000.0, mach=0.8, W_kgs=80.0, FPR=2.8, eff_fan=0.87, BPR=0.8, LPCPR=1.5, eff_lpc=0.87, HPCPR=6.5, eff_hpc=0.86, T4_K=1650.0, eff_hpt=0.88, eff_lpt=0.90, mixMN=0.4),
}

if __name__ == '__main__':
    res = {'generator': 'pyCycle %s / OpenMDAO %s, CEA janaf, Jet-A(g); maps: HPCMap/HPTMap (turbojet), FanMap/LPCMap/HPCMap/HPTMap/LPTMap (turbofan)' % (__import__('pycycle').__version__, __import__('openmdao').__version__)}
    for key, fn in [('turbojet', run_turbojet_mp), ('hbtf', run_hbtf_mp), ('mixed', run_mixed)]:
        print('running', key, file=sys.stderr)
        try:
            res[key] = {'inputs': CASES[key], **fn(CASES[key])}
        except Exception as e:
            import traceback; traceback.print_exc()
            res[key] = {'inputs': CASES[key], 'error': str(e)}
    json.dump(res, sys.stdout, indent=1)
