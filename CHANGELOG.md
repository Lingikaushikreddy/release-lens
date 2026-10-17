# Changelog

## Unreleased

- Refreshed browser workbench with a prominent example, archive swapping, exact-byte budget presets, category/change/search filters, section navigation and responsive evidence tables.
- Clear stale reviews when archives or budgets change; keep JSON downloads complete when table filters are active.
- Shared release-candidate identity, event, dry-run and archive-integrity guards at both publishing entry points.
- Isolated failure/rerun integration tests and a read-only GitHub Actions recovery rehearsal; verified existing 0.1.1 is skipped rather than republished and its eight release assets remain unchanged.
- Release safety report with actual full-workflow rerun, deliberate integrity failure, recovered clean install and raw records. Existing CLI analysis behavior and schema version 1 remain unchanged.

## 0.1.1 — 2026-10-16

- Tag-triggered GitHub Actions releases with npm trusted publishing and provenance.
- Fresh anonymous npx and npm installs on Windows, Linux and macOS with Node 22 and 24 after every automated publish.
- Exact tested-tarball preservation, bounded registry propagation checks and downloadable release evidence.
- CLI analysis behavior and schema version 1 are unchanged.

## 0.1.0 — 2026-10-16

- Local browser and CLI comparison of bounded npm gzip/USTAR/PAX artifacts.
- Exact regular-file byte accounting, SHA-256 content changes, manifest evidence and inclusive growth budgets.
- Canonical version-1 JSON output and atomic CLI file output.
- Bundled growth/cleanup examples, hostile fixtures, real public artifact pair and independent Python oracle.
- Read-only offline analysis with explicit unsupported-input handling.

Public GitHub release and GitHub Pages deployment are gated on the full hosted verification matrix. Download the CLI tarball from GitHub Releases; npm registry publication is not part of this release. Real maintainer pilots remain outstanding.
