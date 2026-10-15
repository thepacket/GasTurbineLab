# Third-party notices

The root [MIT license](LICENSE) applies to original Gas Turbine Lab code and documentation. It does not replace upstream licenses, grant rights in third-party datasets or trademarks, or establish ownership of assets whose origin is unresolved.

## pyCycle thermodynamic coefficients and maps

`src/data/janaf.json` and `src/data/maps.json` contain material from [OpenMDAO/pyCycle](https://github.com/OpenMDAO/pyCycle), distributed under Apache-2.0. Retain [the upstream license notice](licenses/pycycle-LICENSE.txt) and [the complete Apache-2.0 license](licenses/Apache-2.0.txt).

Upstream locations: `pycycle/thermo/cea/thermo_data/janaf.py` and `pycycle/maps/`. Gas Turbine Lab changed the representation to JSON, selected species/map tables, and supplies its own interpolation, scaling and extrapolation code. The JSON files carry their own source, license and modification notices. No claim is made that these generic maps belong to the named catalogue engines.

Upstream licensing was inspected on 2026-10-15 at commit `ee7e16126a7a54b5fe35292c53b7eb4e9572620b`. That is an inspection reference, not a recovered original extraction revision. The inspected repository root includes `LICENSE.txt` and no `NOTICE` file. The source JSON did not record its original extraction commit; pinning and reproducing that extraction remains a publication checklist item.

## Browser dependencies

React, React DOM, Scheduler and Three.js use MIT licenses. Workbox packages use MIT licenses. Their full installed license texts and versions are assembled by `scripts/licenses.mjs` into `public/THIRD_PARTY_NOTICES.txt`, copied into the production build. `public/LICENSE.txt` carries the project's MIT license. Run `npm run licenses` after changing dependencies; the build runs it automatically.

Other npm packages are development/build tooling. They retain their own licenses; the lockfile records the resolved packages and declared license identifiers. In particular, Sharp/libvips has LGPL-bearing platform packages, Lightning CSS uses MPL-2.0, and caniuse-lite uses CC-BY-4.0. This project does not relicense those packages as MIT. The Docker runtime serves compiled static files and does not copy `node_modules` or the Python environment. Redistribution of a development environment or container base image needs the notices applicable to that distribution as well.

## Reference data and catalogue facts

`reference/estimate_references.json` contains selected EASA ICAO emissions-databank values with source URL, edition, workbook hash, sheet, rows and columns. EASA type-certificate and NASA research links are recorded in `docs/validation.md` and the audit scripts. Those references are attribution, not a claim that all source publications are MIT licensed. Confirm the source terms applicable to these extracts before public redistribution.

`src/engine/engines.ts` contains nominal engine figures and model assumptions. Its existing broad source description includes manufacturer brochures, type-certificate sheets and Jane's, but it lacks per-entry citations. Do not describe the catalogue as fully source-audited until a primary-source ledger is completed. Manufacturer and product names remain their respective owners' trademarks; no endorsement is implied.

## Items requiring provenance review before publication

- `src/assets/hero.png` is unused by the app and has no recorded origin/license. It is excluded from the project's MIT claim pending confirmation or removal.
- `src/assets/vite.svg` is an unused scaffold asset. Confirm its upstream terms or remove it before publication; this project makes no ownership claim over it.
- The tracked `pycycle_offdesign*_out/` reports contain generated OpenMDAO HTML and embedded third-party scripts. They are not original MIT-licensed app source. Remove them from the release tree or retain the applicable upstream notices. Historical copies remain in Git unless history is deliberately changed.

See [the public-release audit](docs/public-release.md) for the unresolved items and checks performed. No repository visibility change is made by these files.
