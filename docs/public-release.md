# Public-release readiness

Audit date: 2026-10-15. Initial engineering baseline: `9fefb61`; documentation/MIT preparation pushed as `148d965`. The follow-up described here is included in this revision. The GitHub repository `thepacket/GasTurbineLab` remains **PRIVATE**. No visibility change, deployment or history rewrite was performed.

## Completed

- MIT licensing for original code/documentation, attributed to Andre Paquette; npm metadata agrees. `private: true` prevents accidental npm publication and does not control GitHub visibility.
- pyCycle Apache-2.0 attribution/text and modification notices; project and browser-dependency license texts included in static builds and the offline precache.
- All 11 species and nine map tables compared with pinned pyCycle commit `ee7e16126a7a54b5fe35292c53b7eb4e9572620b`: exact structural/numerical match. [File hashes](../reference/pycycle-data-provenance.json) and [a repeatable verifier](../reference/verify-pycycle-data.py) establish an equivalent source without claiming the original extraction revision was recovered.
- EASA reproduction basis checked at the [actual copyright page](https://www.easa.europa.eu/en/copyright-disclaimer): reproduction with attribution is allowed unless otherwise stated. No overriding restriction was found in the databank landing page, introduction or workbook. The [notices](../THIRD_PARTY_NOTICES.md) acknowledge EASA, ICAO, manufacturer-supplied data and the exact edition. A [verifier](../reference/verify-emissions-reference.py) confirms the recorded workbook hash and all 69 extracted cell values.
- Unused `src/assets/hero.png` and `src/assets/vite.svg` removed from the current tree. Nine generated OpenMDAO files (about 9.93 MB) removed from `pycycle_offdesign_out/`, `pycycle_offdesign2_out/`, and `pycycle_offdesign3_out/`. No app feature or numerical model changed.
- [Catalogue provenance ledger](../reference/catalogue-provenance.json) inventories all 59 presets and every numeric input. Independent primary-source evidence is recorded for 30 entries; evidence may be a family-level comparison or a conflicting certification value, not verification of the whole preset. Unsupported fields remain explicitly unverified. CI checks that the ledger does not drift from the source.
- Gitleaks 8.30.1 installed temporarily from official release archives with pinned SHA-256 checksums. Its history scan found no leaks in the 41 available commits. The reusable [scan command](../scripts/scan-secrets.sh) also checks non-ignored working files and is included in CI, with fully redacted findings.
- GitHub dependency vulnerability alerts enabled and verified by HTTP 204. CI token permissions explicitly limited to `contents: read`; checkout credentials are not persisted. Existing repository default workflow permissions are read-only and Actions cannot approve pull requests.
- Contribution/security guidance and model/setup/deployment documentation updated. Ignore rules cover local credentials, environments and generated reports.

## Still required before publication

| Item | Remaining work |
| --- | --- |
| Catalogue evidence and original provenance | Resolve the ledger's unverified fields and configuration-dependent discrepancies. Do not substitute a family brochure or emissions variant for an exact rating basis. The original broad reference to Jane's did not record what was copied; new corroboration cannot retroactively establish original redistribution rights. Preserve the UI and model behavior until changes have their own scientific evidence and regression checks. |
| Historical assets/reports | Removed files remain in earlier commits. Establish the unused image's origin and applicable embedded-script notices before exposing existing history, or explicitly choose a clean-history publication strategy. This preparation did not rewrite history, force-push or discard recoverable work. |
| GitHub features unavailable while private | Branch-protection inspection returned HTTP 403 with an account-plan limitation. Private vulnerability-reporting read/enable requests returned 404; secret-scanning enablement returned 422 (“not available for this repository”). These are provider capability limits, not configured protections. Enable/verify them when the account supports them or as part of a separately authorized publication. Do not change visibility just to unlock them now. |
| Release verification | Let CI validate the follow-up commit, deploy the license notices when requested, and repeat dependency/secret checks immediately before any explicitly authorized publication. |

A complete source ledger means coverage, not proof: the current ledger is deliberately incomplete in verification. The remaining items above are not being represented as finished.

## Audit scope and limits

The initial targeted Git scan examined 40 commits, 396 blobs and 14,092,965 bytes across locally available refs, including local tool refs. It found no private-key/token/credential-URL patterns or Unix home-directory paths. The subsequent dedicated Gitleaks scan covered 41 commits including `148d965`, with no findings. Neither scan proves absence of secrets, and neither covers unavailable remote refs, GitHub attachments, Actions secrets/artifacts or hosting-provider logs. Inspect any future findings privately and rotate confirmed credentials.

`npm audit --json` reported zero known vulnerabilities for the resolved dependency tree at the initial audit. This is time-sensitive and is not a license audit. Dependencies include MIT/Apache/BSD/ISC and build-tool licenses such as LGPL, MPL and CC-BY. Do not claim all dependencies are MIT. Browser notices are assembled from installed license texts; the deployed nginx image does not contain the Python environment or `node_modules`.

The local follow-up also passed 185 unit tests, the production build, both data-source verifiers, catalogue-provenance consistency, local Markdown link checks and `git diff --check`. Gitleaks found no secrets in the non-ignored working-file snapshot. No browser tests were rerun because no app behavior/UI changed.

The initial documentation/licensing update passed 185 unit tests, the production build and `git diff --check`. Numerical JSON content was unchanged apart from license metadata. Distribution license copies, offline precache entries and local Markdown links were checked. The preceding engineering release passed 86 browser tests with four intentional duplicate lifecycle skips; browser tests are not a substitute for source/license review.

GitHub reports one remote branch, `main`, with `protected: false`; a stale local Dependabot remote-tracking ref is not a current GitHub branch. Issues are enabled, wiki/discussions disabled. Optional community preparation includes issue/PR templates, a code of conduct, screenshots, topics and a release tag. Application package version `0.0.0` has not been promoted to a public release.

## Scientific scope

Reference-case agreement does not certify the full operating envelope or named engines. Generic maps, transients/controllers/thermal defaults and several correlations lack engine-test calibration. Aircraft feasibility is a sampled model check, not operational approval. Publication does not strengthen the evidence recorded in [validation.md](validation.md).
