# Release Lens 0.1.2 verification index

This source snapshot prepares 0.1.2: the interactive bright workbench, tarball x-ray preview, and release safety guards. The analysis core, CLI behavior and JSON schema 1 remain unchanged.

## Authoritative publication records

The tag-triggered workflow generates these records only after exact-commit main CI, publication, all six fresh registry cases and signature/provenance checks pass:

- [Automated release report](https://github.com/Lingikaushikreddy/release-lens/releases/download/v0.1.2/RELEASE_REPORT.md)
- [Structured verification](https://github.com/Lingikaushikreddy/release-lens/releases/download/v0.1.2/release-verification.json)
- [Raw receipts and verified attestations](https://github.com/Lingikaushikreddy/release-lens/releases/download/v0.1.2/release-lens-0.1.2-verification.zip)
- [Archive checksums](https://github.com/Lingikaushikreddy/release-lens/releases/download/v0.1.2/SHA256SUMS)

These versioned records establish publication status; this index does not substitute earlier 0.1.1 evidence for a 0.1.2 result. The workflow checks real anonymous npx and a separate clean npm installation on Windows/Linux/macOS with Node 22/24. It compares registry bytes with the exact tested archive, verifies reports and exit behavior, then independently validates signatures and the repository/workflow/tag/source identity.

## UI and safety scope

The x-ray is explicitly a synthetic example preview. Changing its preview selection does not change an existing computed review. Reviewing a selection loads actual bundled .tgz files into the same worker as user-selected archives. The cleanup pair removes 18,874,372 payload bytes and repairs the missing literal bin target. Target checks remain file-existence checks, not compatibility or security claims.

Previous live failure/rerun proof and its injected-test boundaries remain in [RELEASE_SAFETY.md](RELEASE_SAFETY.md). Historical 0.1.0 and 0.1.1 reports/assets remain versioned and unchanged. See the [release runbook](../docs/releasing.md) for gates and recovery.
