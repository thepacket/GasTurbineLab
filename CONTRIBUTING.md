# Contributing

Start with the [development guide](docs/development.md) and [model scope and validation](docs/validation.md). Keep changes focused and explain the concrete behavior before and after the change. Preserve the existing UI structure unless a requested change requires otherwise.

For a scientific correction, cite a primary source, record units and conventions, and add a regression case that distinguishes the old and corrected behavior. Agreement with a reference calculation is not engine-test validation. Do not tune generic defaults to a named engine without recording the calibration data and limitations.

Use Node 22.12+, `npm ci`, `npm test`, and `npm run build`. Install Chromium with `npx playwright install chromium` and run `npm run test:e2e` for affected browser workflows. Include the tests actually run in a pull request. Regenerate notices with `npm run licenses` after dependency changes.

Original contributions are submitted under the repository's MIT license. Preserve upstream licenses for third-party material and provide exact source URLs/revisions, transformation notes and redistribution terms for new data. Do not submit confidential engine maps, private documents, credentials, virtual environments or generated OpenMDAO reports. Report security issues as described in [SECURITY.md](SECURITY.md).
