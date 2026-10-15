# Public-release readiness

Audit date: 2026-10-15. Reviewed baseline: `9fefb61`. The GitHub repository `thepacket/GasTurbineLab` was confirmed **PRIVATE** using the API. No visibility change, publication, history rewrite, push or deployment is part of this documentation update.

## Prepared locally

- MIT license for original code/documentation, attributed to Andre Paquette; npm license metadata agrees. `private: true` remains to prevent accidental npm publication.
- pyCycle attribution, Apache-2.0 text, transformation notices in both derived JSON files, and build-generated project/dependency notices accessible as static files.
- Updated README, development guide, methods, user guide, contribution and security guidance. Claims distinguish reference-case agreement from uncalibrated models and empirical estimates.
- Ignore rules now cover dotenv files, private-key file extensions, virtual environments and generated OpenMDAO reports. Ignore rules do not remove files already tracked or erase history.

## Resolve before publishing

| Item | Evidence | Required action |
| --- | --- | --- |
| Catalogue source ledger | 59 entries; broad source description includes brochures, type-certificate data and Jane's; no per-entry source field | Record primary-source URL/document/page and distinguish published values from assumptions. Replace or omit any material whose reuse cannot be established. Do not claim all figures came directly from manufacturers. |
| Reference-data redistribution terms | EASA extracted values have edition/hash/row attribution, but the applicable reuse terms have not been established in this audit; the legal-notice fetch was rate-limited | Verify terms for the extracts and retain required attribution/conditions, or remove the extracts from the public distribution. A source link alone is not permission. |
| pyCycle extraction reproducibility | JSON source metadata identifies pyCycle, but lacks the original extraction revision/script; Apache licensing and upstream license inventory were checked | Pin a source version and reproduce the JSON extraction, or document a numerical comparison to that pinned source. The upstream commit in the notices is an inspection reference only. |
| Unused asset provenance | `src/assets/hero.png` and `src/assets/vite.svg` are unused, with no project provenance ledger | Remove them from the public tree or establish their origin and applicable terms. They are not covered by the original-work MIT claim. |
| Generated reports | Nine tracked files under `pycycle_offdesign_out/`, `pycycle_offdesign2_out/`, `pycycle_offdesign3_out/`; about 9.93 MB, including embedded third-party scripts | Prefer removing these regenerable artifacts from the public tip. Decide whether historical copies may remain; review their notices before exposing existing history. No history rewrite has been performed. |
| Final staged release | Changes here are local | Review, commit, run CI, and deploy the notices/documentation before an explicitly authorized visibility change. |

## Checks performed

- This documentation/licensing update: 185 unit tests passed; production build and `git diff --check` passed. Parsed thermodynamic/map content is identical to the baseline after excluding the three new license metadata fields. Distribution license copies, offline precache entries and local Markdown link targets were verified. Browser tests were not rerun for this update; the browser results below refer to the preceding release.

- Git history scan: 40 commits, 396 blobs, 14,092,965 bytes across all locally available refs (including remote-tracking and local tool refs). No matches for private-key headers, GitHub/Slack/Fly token patterns, AWS access IDs or credential-bearing HTTP URLs. No Unix home-directory path matches. This is a targeted pattern scan, not a guarantee that no secrets exist; it does not cover unknown remote refs, GitHub attachments, Actions secrets/artifacts or hosting-provider logs. Gitleaks was not installed. Run a dedicated secret scanner and inspect its redacted findings before publication; never paste candidate secrets into issues.
- `npm audit --json`: zero known vulnerabilities at audit time for the resolved dependency tree. This is time-sensitive and is not a license/completeness audit. Repeat it before release.
- Dependency licenses include MIT/Apache/BSD/ISC and build-tool licenses such as LGPL, MPL and CC-BY. Do not claim all dependencies are MIT. Browser dependency notices are generated from installed package license texts; Python environments and npm build tooling are not copied into the deployed nginx image.
- Latest GitHub CI for `9fefb61` succeeded. The preceding `aaf7bac` run also succeeded; older historical failures do not certify or invalidate the current tree. The release audit recorded 185 unit and 86 browser passes (four intentional duplicate lifecycle skips).
- GitHub reports one remote branch, `main`, with `protected: false`. A stale local remote-tracking Dependabot ref exists; it is not evidence of a current GitHub branch.
- Ruleset inspection returned HTTP 403 because the private repository/account plan does not support it. The security-analysis field was unavailable (`null`), so secret scanning and push protection were **not confirmed**, rather than assumed disabled.

## Repository setup to decide/verify

Before accepting outside changes, configure protection/rulesets for `main` with required CI and review as appropriate; the API indicated plan limitations while private. Enable/verify private vulnerability reporting, secret scanning and push protection when available. Keep Actions token permissions minimal and never expose deployment credentials to untrusted pull requests. Do not change visibility just to unlock settings during preparation.

Issues are enabled; wiki and discussions are disabled. Contribution and security files are supplied locally. Issue/PR templates, a code of conduct, release tags, screenshots, description/topics and a support policy are optional community preparation, not requirements for MIT licensing. `0.0.0` is still an application package version; choose a public release version/tag when ready rather than implying one has already shipped.

## Scope after release

The app is suitable for its documented modeling workflows, not certification or safety-critical engine control. Generic maps, transient/controller/thermal defaults and several correlations lack engine-test calibration. Aircraft feasibility is a sampled model check, not operational approval. Scientific limitations remain in [validation.md](validation.md); publication does not strengthen the evidence.
