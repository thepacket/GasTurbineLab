"""Verify the attributed EASA extracts against the exact downloaded XLSX (stdlib only).

Usage: python3 reference/verify-emissions-reference.py /path/to/workbook.xlsx
Download URL, edition and checksum are recorded in estimate_references.json.
This reads workbook values, never formulas or macros as executable code.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workbook', type=Path)
    args = parser.parse_args()
    ref = json.loads(Path(__file__).with_name('estimate_references.json').read_text())
    if hashlib.sha256(args.workbook.read_bytes()).hexdigest() != ref['sha256']:
        raise ValueError('Workbook checksum differs from the recorded reference edition')
    ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(args.workbook) as archive:
        strings = [''.join(x.itertext()) for x in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        sheets = ET.fromstring(archive.read('xl/workbook.xml')).findall('m:sheets/m:sheet', ns)
        sheet = next(s for s in sheets if s.attrib['name'] == ref['sheet'])
        rid = sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
        relation = next(r for r in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels')) if r.attrib['Id'] == rid)
        target = relation.attrib['Target']
        path = target.lstrip('/') if target.startswith('/') else 'xl/' + target
        cells = {}
        for cell in ET.fromstring(archive.read(path)).findall('.//m:sheetData/m:row/m:c', ns):
            val = cell.find('m:v', ns)
            if val is not None:
                cells[cell.attrib['r']] = strings[int(val.text)] if cell.get('t') == 's' else val.text
    checked = 0
    for engine in ref['engines']:
        row = engine['row']
        expected = {'A': engine['uid'], 'J': engine['dataStatus'], 'H': engine['OPR'], 'I': engine['ratedThrust_kN']}
        for field, columns in [('fuelFlow_kgs', ['BZ', 'CA', 'CB', 'CC']), ('EI_HC_g_kg', ['Q', 'R', 'S', 'T']), ('EI_CO_g_kg', ['AD', 'AE', 'AF', 'AG']), ('EI_NOx_g_kg', ['AQ', 'AR', 'AS', 'AT'])]:
            expected.update(zip(columns, engine[field]))
        for field, col in [('HC', 'W'), ('CO', 'AJ'), ('NOx', 'AW')]:
            expected[col] = engine['DpFooAvg_g_kN'][field]
        if cells.get(f'K{row}') not in (None, '', engine['superseded']):
            raise ValueError(f'Unexpected superseded flag for row {row}')
        for col, value in expected.items():
            raw = cells[f'{col}{row}']
            match = raw == value if isinstance(value, str) else math.isclose(float(raw), value, rel_tol=1e-12, abs_tol=1e-12)
            if not match:
                raise ValueError(f'Reference mismatch at {col}{row}')
            checked += 1
    print(f'Workbook hash and {checked} attributed cell values verified for {len(ref["engines"])} engines.')


if __name__ == '__main__':
    main()
