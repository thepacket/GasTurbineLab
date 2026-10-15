# Third-party notices

The root [MIT license](LICENSE) applies to original Gas Turbine Lab code and documentation. It does not replace upstream licenses, grant rights in third-party datasets or trademarks, or establish ownership of assets whose origin is unresolved.

## pyCycle thermodynamic coefficients and maps

`src/data/janaf.json` and `src/data/maps.json` contain material from [OpenMDAO/pyCycle](https://github.com/OpenMDAO/pyCycle), distributed under Apache-2.0. Retain [the upstream license notice](licenses/pycycle-LICENSE.txt) and [the complete Apache-2.0 license](licenses/Apache-2.0.txt).

Upstream locations: `pycycle/thermo/cea/thermo_data/janaf.py` and `pycycle/maps/`. Gas Turbine Lab changed the representation to JSON, selected species/map tables, and supplies its own interpolation, scaling and extrapolation code. The JSON files carry their own source, license and modification notices. No claim is made that these generic maps belong to the named catalogue engines.

Upstream licensing was inspected on 2026-10-15 at commit `ee7e16126a7a54b5fe35292c53b7eb4e9572620b`. That is a pinned, numerically verified equivalent source, not a recovered original extraction revision. The inspected repository root includes `LICENSE.txt` and no `NOTICE` file. The source JSON did not record its original extraction commit. `reference/verify-pycycle-data.py` now reproduces the selected tables from this pinned revision and confirms exact structural/numerical agreement for all 11 species and nine maps. `reference/pycycle-data-provenance.json` records individual upstream file hashes.

## Browser dependencies

React, React DOM, Scheduler and Three.js use MIT licenses. Workbox packages use MIT licenses. Their full installed license texts and versions are assembled by `scripts/licenses.mjs` into `public/THIRD_PARTY_NOTICES.txt`, copied into the production build. `public/LICENSE.txt` carries the project's MIT license. Run `npm run licenses` after changing dependencies; the build runs it automatically.

Other npm packages are development/build tooling. They retain their own licenses; the lockfile records the resolved packages and declared license identifiers. In particular, Sharp/libvips has LGPL-bearing platform packages, Lightning CSS uses MPL-2.0, and caniuse-lite uses CC-BY-4.0. This project does not relicense those packages as MIT. The Docker runtime serves compiled static files and does not copy `node_modules` or the Python environment. Redistribution of a development environment or container base image needs the notices applicable to that distribution as well.

## Reference data and catalogue facts

`reference/estimate_references.json` contains selected EASA ICAO emissions-databank values with source URL, edition, workbook hash, sheet, rows and columns. EASA type-certificate and NASA research links are recorded in `docs/validation.md` and the audit scripts. These are not MIT-licensed source publications. EASA’s [copyright notice](https://www.easa.europa.eu/en/copyright-disclaimer), checked 2026-10-15, permits reproduction with source acknowledgement unless otherwise stated. The databank landing page, introduction and workbook were checked for an overriding restriction; none was found. Attribution: European Union Aviation Safety Agency, ICAO Aircraft Engine Emissions Databank, March 2026; manufacturer-submitted values hosted by EASA on behalf of ICAO. EASA disclaims responsibility for the databank contents. These selected factual extracts are retained on that published reproduction basis, not relicensed as MIT. `reference/verify-emissions-reference.py` verifies the workbook hash and extracted cells.

`src/engine/engines.ts` contains nominal engine figures and model assumptions. The historical source description named manufacturer brochures, type-certificate sheets and Jane's without exact citations. `reference/catalogue-provenance.json` now inventories every preset and separates independently corroborated fields from unverified legacy inputs and conflicting/configuration-dependent reference values. This is not a complete source or redistribution audit. Do not infer permission for historical source material from a new corroborating link. Manufacturer and product names remain their respective owners' trademarks; no endorsement is implied.

## Removed material and historical copies

The unused `src/assets/hero.png`, scaffold `src/assets/vite.svg` and generated `pycycle_offdesign*_out/` reports were removed from the current tree during publication preparation. No app feature depends on them. Their earlier Git revisions remain; the image's origin is unresolved and reports embed third-party scripts. Historical copies are not covered by the project's original-work MIT claim. Before publishing existing history, establish their applicable terms or explicitly choose a clean-history publication strategy. No history rewrite has been performed.

See [the public-release audit](docs/public-release.md) for remaining checks. Repository visibility is unchanged.
