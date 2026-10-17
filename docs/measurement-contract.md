# Release Lens 0.1 measurement contract

- Input: one gzip member containing a USTAR/POSIX tar, regular files and directories, with bounded local/global PAX records. Unsupported extensions and entries fail; no successful partial inventory.
- File identity: case-sensitive POSIX path after PAX overrides. Require package/ root, reject absolute paths, backslashes, NUL, traversal components, empty paths, links, special files, duplicate effective normalized paths. One leading ./ and redundant separators may be normalized only after rejecting dangerous components. Inventory paths strip the validated package/ root and are package-relative (package.json, dist/index.js).
- unpackedBytes means sum of regular-file payload bytes. The expanded-input limit counts all decompressed bytes including headers, PAX, padding and end markers. archiveBytes is the actual gzip byte count, independently checked against supplied length. Neither total represents installed footprint.
- Validate tar checksums, sizes and termination and gzip integrity. Reject concatenated members and trailing nonpadding bytes. Limits apply before buffering bodies or metadata; count extension records toward entry count.
- File hashes are incremental SHA-256 over exact payload bytes. Retain inventory metadata and only the bounded manifest body. Manifest must be an object, depth <=64. No Node resolution, dependency resolution, compatibility or security verdict.
- Findings check only literal local relative file targets in main/module/types/bin/exports. Patterns, external or unsupported targets are explicitly unchecked; null export exclusions are not targets. Preserve exact JSON pointers and before/after evidence. Classifications are filename heuristics.
- Reports have schemaVersion 1, deterministic code-unit path and ordinary-key sorting (JSON integer-index keys follow ECMAScript numeric ordering), explicit missing-vs-null manifest values and no timestamps or machine paths. Exact gzip delta remains separate from additive file/category deltas.
- Budgets use nonnegative safe integer bytes, inclusive boundary: growth <= budget passes. All comparisons are before -> after.
- Browser analysis reads File streams in a disposable worker. Cancel terminates work. Errors/replacement clear stale report. All untrusted text is rendered as text. Static assets are self-hosted; analysis needs no network.

Ruling: deliver a local static application and packed CLI release candidate. Public publication and maintainer pilots remain external steps as in the original plan.
