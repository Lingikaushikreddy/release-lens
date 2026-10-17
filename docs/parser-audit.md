# Archive parser audit (release candidate 0.1)

This audit describes the pinned installed code and the independent checks around it. It is a bounded-input implementation review and test record, not a security certification or a proof that arbitrary npm packages are compatible.

## Installed implementation inspected

`modern-tar` is pinned to **0.8.6**. The application imports its web `createTarDecoder({ strict: true })` API, drains each entry body, and incrementally hashes file chunks with **@noble/hashes 2.4.0** `sha256.create()`. Neither buffered `unpackTar` nor the filesystem/extraction entry point is used.

The actual installed distribution was inspected, including these SHA-256 fingerprints:

| Installed source | SHA-256 |
| --- | --- |
| `modern-tar/dist/web/index.js` | `4054ff4ecddcb9a05517d043b06ad4392ada36b4dbf27f038aa47ce58eb831e4` |
| `modern-tar/dist/packer-By1HVV7Z.js` | `01af5ee8a87063607bef16ffdae392e43a0049f8e3fe733ccfb5fd15c834d97e` |

The web decoder exposes entry body streams and applies backpressure once its internal queued bytes reach 1 MiB. Strict mode checks header checksums, detects incomplete payloads/padding, and checks nonzero data after recognized tar termination. The independent wrapper must strengthen the following observed behaviors:

- `parseUstarHeader` does not require the documented USTAR magic/version, maps unknown typeflags to `file`, and accepts non-POSIX base-256 numeric fields.
- The unpacker hides PAX/GNU extension records from entry consumers and buffers a complete metadata record before parsing it, with its own 8 MiB ceiling.
- `parsePax` breaks on malformed framing, uses permissive `parseInt`, permits repeated keys, and ignores malformed size overrides. Local metadata behavior can discard prior overrides when metadata records are interleaved.
- The unpacker coerces directory and link sizes and treats a file name ending in `/` as a directory.
- The streaming decoder can finish after a complete entry at physical EOF without calling the core `finish()` check that requires two zero termination blocks.

## Independent framing and policy

`packages/core/src/archive.ts` places an independent tar validator before the pinned decoder. It uses one 512-byte header buffer and a single PAX body bounded **before allocation**. It validates checksums, POSIX magic/version, allowed typeflags, numeric fields, complete declared bodies, zero record padding, two zero end blocks, and all subsequent zero padding. Every physical header counts toward `maxEntries`, including local/global metadata and directories. A declared payload plus its padding is checked against the expanded byte ceiling before its body is buffered or consumed by the decoder. All decompressed bytes—including headers, PAX, body padding, and termination—count toward the observed expanded limit.

The supported subset is deliberately strict:

- POSIX `ustar\0` magic and `00` version, octal fields, regular files (`0` or NUL), directories (`5`), local PAX (`x`), and global PAX (`g`). GNU long-name/long-link/sparse and other extensions, hardlinks, symlinks, devices, FIFO, contiguous files, and unknown types fail.
- PAX allows `path`, `size`, `uid`, `gid`, `uname`, `gname`, `mtime`, `atime`, `ctime`, `comment`, and `charset=UTF-8`. Other attributes fail as unsupported. Each record needs an exact decimal byte length and newline, valid UTF-8, one `=`, and a unique key. Empty path/size and invalid/unsafe sizes fail. Multiple local PAX records for one following member and dangling local metadata fail. Parser/framer disagreement fails closed; no inventory is returned.
- The **aggregate sum of all PAX body declarations** is bounded by `maxMetadataBytes`, preventing global state or many metadata records from accumulating unbounded strings. Each individual PAX body and the manifest independently have the same ceiling. Gzip optional-header bytes are also bounded. These independent ceilings do not imply one shared allocation budget across every stream/runtime buffer.
- Identity is checked after PAX overrides. Reject absolute paths, backslashes, embedded NUL, every `..` component, and `.` components beyond one optional leading `./`. Redundant separators are collapsed after these checks. Every identity must be `package` (directory only) or beneath `package/`; normalized identities are unique across both files and directories. Regular files ending in `/` and directories declaring a nonzero size fail. Output file paths strip the validated `package/` prefix.
- Only regular-file metadata and hashes enter the inventory. Only the manifest payload is retained. The manifest must be valid UTF-8 JSON with an object root, finite numbers, and depth no greater than the configured bound or 64. Entries and ordinary object keys are canonicalized using code-unit ordering; JSON integer-index keys serialize in ECMAScript numeric order; payload hashes cover exact bytes, including zero-byte files.

The independent framer queues expected effective path/type/size metadata; each streamed library entry must agree. This preserves the library as the body-streaming parser without trusting its broader acceptance policy.

## Gzip integrity and single-member boundary

Native `DecompressionStream('gzip')` alone cannot enforce the single-member contract. A direct Node **24.5.0** characterization accepted two concatenated gzip members, while rejecting corrupted CRC, corrupted ISIZE, nonzero trailing garbage, and zero padding.

A bounded RFC 1951 boundary scanner therefore runs **before** native decompression. It reads fixed, dynamic, and stored block framing; retains only the bit reservoir and bounded Huffman alphabets; validates symbols, repeat ranges, backward distances, stored block lengths, reserved values, gzip flags/header checksum, and trailer size. It does not reconstruct or retain file data. It counts deflate-produced bytes before native inflation and enforces the expanded ceiling. Once the first trailer ends, only zero padding may follow; that padding counts toward observed compressed bytes but is excluded from native decompression for consistent acceptance. A second member or any other nonzero trailing data fails.

Native gzip then performs actual decompression and integrity checking. The tar wrapper independently counts **actual decompressed bytes** and computes CRC-32 over them, comparing these observations with the scanner's total, trailer ISIZE, and trailer CRC. Supplied `archiveBytes` must equal independently observed input bytes. Compressed source chunks are fed onward in at most 64 KiB segments; no full archive buffer is created by this implementation. An upstream stream can itself provide a larger existing chunk, which the wrapper references and slices rather than duplicating in full.

## Errors and cancellation

| Code | Conditions |
| --- | --- |
| `FORMAT` | Invalid gzip/tar/PAX/manifest framing, unsafe or duplicate identity, integrity/size mismatch, truncation, missing manifest, and parser/policy disagreement |
| `LIMIT` | Invalid limit configuration, supplied/observed compressed ceiling, expanded ceiling, physical-record count, file declaration/payload, metadata declaration/aggregate, or manifest depth |
| `UNSUPPORTED` | Non-USTAR format, unsupported gzip compression method, forbidden tar type/extension/link target, unknown PAX attribute, or unsupported charset |
| `CANCELLED` | Already aborted signal or abort during analysis; abort errors take precedence over parser/native errors |

Underlying input stream read errors retain their original identity so the CLI can distinguish filesystem I/O errors from archive refusals. Parser/native/UTF-8 failures otherwise map to `FORMAT`. Failure cancels readers and returns no successful partial inventory. Abort cancels a pending source read; the browser additionally terminates its disposable worker. Input limits are snapshotted for each invocation.

## Verification record

Tests were written against an initial throwing API scaffold; the first observed RED run had **25 failures**. After implementation and corrected independently hand-counted fixture byte literals, all tests passed. A separate source-I/O identity regression was observed RED and then GREEN.

- `pnpm exec vitest run tests/archive.test.ts tests/archive-properties.test.ts`: **38 tests passed**, including 37 direct cases and the 60-run generated payload/chunk/order/compression property (seed `20261016`). Covers empty bodies, chunk sizes down to one byte, stored/fixed/dynamic deflate, local/global PAX, traversal and duplicate PAX identities, directory duplicates, unsupported types, declarations before absent bodies, full expanded overhead, 20,001 physical records, cancellation during a pending read, missing/invalid/deep manifests, CRC/ISIZE corruption, truncation, concatenation, and trailing data.
- `pnpm check`: passed.
- `pnpm test`: **74 tests across 5 files passed** at this audit point, including CLI report/budget/exit/output behavior.
- `pnpm build:cli && pnpm test:oracle`: passed all four independent CPython `tarfile`/`hashlib` comparisons: synthetic growth, cleanup, inert hostile text, and genuine registry tarballs `is-number` 6.0.0 → 7.0.0. Repeated CLI output was identical. See `evidence/oracle.json` and `fixtures/real/records.json` for provenance/hashes.

No archive input is extracted, imported, executed, resolved through Node, or allowed to initiate network activity. Hashes and literal file-existence observations are measurements, not malware, package compatibility, installability, or dependency-resolution verdicts. The finite tests and valid-input oracle do not prove correctness for all malformed compressed inputs; maintaining the small framing scanner and rerunning adversarial/generated tests are ongoing responsibilities when changing the parser or runtime.
