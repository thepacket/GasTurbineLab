# Security

The deployed app serves static files; calculations, custom maps and saved designs run in the browser. Shared-link fragments can contain the complete design and custom maps: anyone receiving the link can read that data. Exports and browser storage should be treated accordingly.

Do not post credentials, confidential maps or exploit details in public issues. If GitHub private vulnerability reporting is available on this repository, use **Security → Report a vulnerability**. Otherwise contact the maintainer through their [GitHub profile](https://github.com/thepacket) to arrange a private channel before sharing sensitive details. No monitored security email or response-time commitment is declared here.

The latest `main` is the maintenance target; there is no long-term-support release policy yet. The publication checklist includes enabling and verifying a private reporting channel and appropriate repository protections. Dependency vulnerability alerts are enabled. A checksum-pinned Gitleaks scan runs in CI. GitHub branch protection, hosted secret scanning and private reporting are currently unavailable for this private repository/account; they are not claimed as active protections. See [publication readiness](docs/public-release.md).
