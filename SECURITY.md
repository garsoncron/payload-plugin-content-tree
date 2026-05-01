# Security policy

## Supported versions

While the plugin is in `0.x` (pre-1.0), only the latest published version receives security fixes. From `1.0.0` onward, the latest 1.x line is supported per [`PRD.md`](./PRD.md) §9.

| Version       | Supported    |
| ------------- | ------------ |
| `0.x` (alpha) | Latest only  |
| `1.x`         | Latest minor |
| `< 1.0`       | No           |

## Reporting a vulnerability

**Do not file a public GitHub issue for security vulnerabilities.**

Email the maintainer directly: **carson@getfishtank.ca**.

Include:

- A description of the vulnerability
- Steps to reproduce (or a proof-of-concept)
- The version affected
- Any disclosure timeline you'd like

### What to expect

- **Acknowledgement:** within 48 hours.
- **Initial assessment:** within 5 business days.
- **Fix or mitigation:** target 14 days for high-severity issues, longer for low-severity.
- **Disclosure:** coordinated. Once a fix ships, the report is credited (if you'd like) in the changelog and a GitHub Security Advisory is published.

### Scope

In scope:

- The published `@fishtank/payload-plugin-content-tree` package
- The example sandboxes in this repo (`examples/*`) where they expose the plugin

Out of scope:

- Vulnerabilities in upstream dependencies (report those upstream — `payload`, `react-arborist`, etc.)
- Vulnerabilities in consumer code that misuses the plugin
- Social engineering, physical attacks, or denial-of-service against GitHub/npm infrastructure

Thank you for helping keep this plugin and its consumers safe.
