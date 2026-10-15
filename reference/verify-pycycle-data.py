"""Compare shipped numerical tables with pinned pyCycle source; stdlib only.

Usage: python3 reference/verify-pycycle-data.py /path/to/pyCycle
Reads Python literals/arrays through AST, without importing/executing upstream code.
The adjacent provenance manifest pins the upstream files by SHA-256.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPECIES = ['Ar', 'CO2', 'H2O', 'N2', 'O2', 'CO', 'OH', 'NO', 'O', 'H', 'H2']
MAPS = {
    'compressors': {'Fan': 'Fan_map', 'LPC': 'LPC_map', 'HPC': 'HPC_map', 'AXI5': 'axi5', 'NCP01': 'ncp01'},
    'turbines': {'HPT': 'HPT_map', 'LPT': 'LPT_map', 'LPT2269': 'lpt2269', 'HPT1269': 'hpt1269'},
}
FIELDS = {
    'compressors': ['defaults', 'RlineStall', 'alphaMap', 'NcMap', 'RlineMap', 'WcMap', 'PRmap', 'effMap'],
    'turbines': ['defaults', 'alphaMap', 'NpMap', 'PRmap', 'WpMap', 'effMap'],
}


def literal(node, names):
    if isinstance(node, ast.Name):
        return names[node.id]
    if isinstance(node, (ast.List, ast.Tuple)):
        return [literal(x, names) for x in node.elts]
    if isinstance(node, ast.Dict):
        return {literal(k, names): literal(v, names) for k, v in zip(node.keys, node.values)}
    if isinstance(node, ast.Call) and not node.keywords:
        fn = ast.unparse(node.func)
        if fn == 'np.array' and len(node.args) == 1:
            return literal(node.args[0], names)
        if fn == 'OrderedDict' and len(node.args) == 1:
            return dict(literal(node.args[0], names))
    return ast.literal_eval(node)


def extract(source):
    names = {}
    species_path = 'pycycle/thermo/cea/thermo_data/janaf.py'
    for node in ast.parse((source / species_path).read_text()).body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
            names[node.targets[0].id] = literal(node.value, names)
    janaf = {'element_wts': names['element_wts'], 'species': {k: names['products'][k] for k in SPECIES}}
    maps = {}
    for family, entries in MAPS.items():
        maps[family] = {}
        for name, filename in entries.items():
            values = {}
            for node in ast.parse((source / f'pycycle/maps/{filename}.py').read_text()).body:
                if not isinstance(node, ast.Assign):
                    continue
                target = node.targets[0]
                if isinstance(target, ast.Attribute) and target.attr in FIELDS[family]:
                    values[target.attr] = literal(node.value, {})
                elif isinstance(target, ast.Subscript) and isinstance(target.value, ast.Attribute) and target.value.attr == 'defaults':
                    values['defaults'][literal(target.slice, {})] = literal(node.value, {})
            if set(values) != set(FIELDS[family]):
                raise ValueError(f'Missing map fields: {name}')
            maps[family][name] = values
    return {'janaf': janaf, 'maps': maps}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'reference/pycycle-data-provenance.json').read_text())
    for name, expected in manifest['sourceFilesSha256'].items():
        if hashlib.sha256((args.source / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f'Pinned source hash mismatch: {name}')
    for name, extracted in extract(args.source).items():
        shipped = json.loads((ROOT / f'src/data/{name}.json').read_text())
        payload = {k: v for k, v in shipped.items() if k not in ('source', 'license', 'licenseNotice', 'modifications')}
        if payload != extracted:
            raise ValueError(f'{name}: shipped table differs from pinned source')
        print(f'{name}: exact structural and numerical match')
    print(f"Verified {len(SPECIES)} species and 9 maps against {manifest['commit']}")


if __name__ == '__main__':
    main()
