# Release Lens

Review exactly what changed between two npm tarballs, without installing or running either package.

[Try the public app](https://lingikaushikreddy.github.io/release-lens/) · [GitHub releases and CLI downloads](https://github.com/Lingikaushikreddy/release-lens/releases) · [Hosted verification](https://github.com/Lingikaushikreddy/release-lens/actions/workflows/ci.yml)

**0.1.0** includes a local browser review app and a Node CLI built on the same bounded streaming analysis core. Drop in two `.tgz` files, explain payload growth by path and filename category, inspect manifest changes and missing literal targets, and export a deterministic JSON report.

## Try it

Requirements: current Node 22 (22.13+) or Node 24, pnpm 11.25.0, Python 3 for fixture/oracle checks.

```sh
pnpm install --frozen-lockfile
pnpm fixtures
pnpm build
pnpm dev
```

Open the printed local URL. Choose **Compare example releases**: an accidental fixture directory adds 18 MiB, and `/bin/demo` points at a missing file. Review the cleanup example to see that directory removed. Examples are synthetic, clearly labeled, and bundled locally. All analysis runs in a worker on your device. Local tarballs never leave the app.

## CLI

From the source checkout:

```sh
pnpm build:cli
node packages/cli/dist/main.js diff fixtures/before.tgz fixtures/after.tgz --format json --out report.json --max-unpacked-growth 1048576
```

That command deliberately exits **1** because the example exceeds the budget. Use your own artifact paths for a real review. To test the distributed candidate, install the provided `releaselens-0.1.0.tgz` in a temporary project with `npm install --ignore-scripts /absolute/path/releaselens-0.1.0.tgz`, then run:

```sh
npx --no-install releaselens diff before.tgz after.tgz --format json
```

Installation above installs Release Lens itself; analyzed packages are never installed. `--out` writes atomically and leaves stdout empty. Without it, stdout contains only the chosen report. Diagnostics go to stderr.

Exit codes: **0** completed within budget or no budget; **1** budget exceeded; **2** bad arguments or archive; **3** I/O or unsupported runtime; **130** cancellation. Warnings do not change the exit status. `--help` documents arguments.

## What the report means

`unpackedBytes` counts regular-file payloads. Every file delta adds exactly to the reported payload growth. Categories are filename heuristics. `archiveDelta` is the change in whole gzip file bytes; per-file compressed contributions are not additive and are not claimed.

Manifest comparisons cover `files`, `exports`, `main`, `module`, `types`, `bin`, `engines`, dependencies, and scripts. Target checks establish only that an exact local regular file exists in the tarball. Wildcards and unsupported targets remain explicitly unchecked. This does not establish Node resolution, compatibility, package safety, complete install footprint, or provenance. Scripts are displayed as inert text.

The JSON schema is version **1**, stable throughout `0.1.x`; absent and null manifest values are distinguished by existence flags. Deterministic output excludes timestamps and local machine paths. Full semantics are in [the measurement contract](docs/measurement-contract.md).

## Input limits

Per archive: 25 MiB compressed, 150 MiB expanded (including tar overhead), 20,000 tar records including extension records, 16 MiB per file, 1 MiB aggregate PAX metadata, 1 MiB manifest and bounded gzip headers, manifest depth 64. Only the documented gzip/USTAR/PAX subset is accepted. Links, special entries, traversal, absolute paths, duplicate effective paths, malformed/truncated data, absent or invalid `package/package.json`, and unsupported extensions fail without a successful partial report. Nothing is extracted to disk. See [parser audit](docs/parser-audit.md).

## Verification

```sh
pnpm check
pnpm test
pnpm build
pnpm test:oracle
pnpm test:pack
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
```

The independent oracle reads the same artifacts using CPython `tarfile` and `hashlib` without disk extraction. It checks paths, payload lengths, hashes, archive lengths, deltas, and repeated JSON output. It does not define the acceptance policy for malformed archives. Real fixture identities and original registry URLs are in `fixtures/real/records.json`; development-only reacquisition uses `python3 scripts/fetch-corpus.py`.

See [hosted release verification](evidence/PUBLIC_RELEASE.md) and the [CI runs](https://github.com/Lingikaushikreddy/release-lens/actions/workflows/ci.yml). CI covers Node 22/24 across Linux, macOS, and Windows and all three browser engines on Linux. Public deployment and release assets depend on those checks. The original local candidate observations remain in [the historical report](evidence/RELEASE.md).

## Alternatives and scope

[diffoscope](https://diffoscope.org/) compares many artifact formats in depth. [Size Limit](https://github.com/ai/size-limit) focuses on build and performance budgets. [pkg-size](https://github.com/pkg-size/pkg-size) measures package/install sizes. Release Lens focuses on reviewing the exact contents and manifest evidence of two supplied npm release artifacts. It has no application backend, accounts, registry fetching, or PR commenting.

MIT licensed. Read [SECURITY.md](SECURITY.md) before reporting private package data and [CONTRIBUTING.md](CONTRIBUTING.md) for development guidance.
