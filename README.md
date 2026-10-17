# Release Lens

Review exactly what changed between two npm tarballs, without installing or running either package.

[Try the public app](https://lingikaushikreddy.github.io/release-lens/) · [npm package](https://www.npmjs.com/package/@kaushikgojo/release-lens) · [GitHub release](https://github.com/Lingikaushikreddy/release-lens/releases/latest) · [0.1.2 release verification](https://github.com/Lingikaushikreddy/release-lens/releases/download/v0.1.2/RELEASE_REPORT.md)

**0.1.2** includes a browser review app and a Node CLI built on the same bounded streaming analysis core. Compare two `.tgz` files, trace payload growth to individual files, inspect manifest changes and missing literal targets, and export a deterministic JSON report.

## See a release review

Open [the public app](https://lingikaushikreddy.github.io/release-lens/) and choose **Explore an example**, or drop your own before and after `.tgz` files into the workbench. The tarball x-ray previews the oversized example and its clean follow-up; **Review this example** analyzes the selected archive pair. The preview is labeled synthetic and stays separate from any report you have already computed. Swap archives to reverse the comparison, and choose a 1 MiB or 10 MiB growth budget with one click.

![Release Lens bright workbench with an interactive archive comparison and example shortcut](https://raw.githubusercontent.com/Lingikaushikreddy/release-lens/main/docs/images/v012-home.jpg)

The synthetic example adds two fixture files totaling **18 MiB**, plus 4 manifest bytes: **+18,874,372 B** of unpacked payload. Its `/bin/demo` changes to `dist/missing.js`, which is absent from the after archive. Select a category to drill into its files, combine change filters with path search, sort by growth or size, and expand a row for exact bytes and SHA-256 evidence. Filters change the view; exported JSON retains the complete report.

![Interactive evidence review showing selected fixture files, change filters, exact byte deltas and SHA-256 hashes](https://raw.githubusercontent.com/Lingikaushikreddy/release-lens/main/docs/images/v012-evidence.jpg)

Choose **Compare clean follow-up** to compare the problematic release with its correction. It removes the fixture files, restores the literal bin target, and reports **−18,874,372 B** with **0 missing local targets in the after archive**. Wildcard targets remain explicitly unchecked.

See the [clean follow-up](docs/images/workbench-clean.jpg), [review overview](docs/images/workbench-review.jpg), and [mobile workbench](docs/images/workbench-mobile.jpg). Screenshots show the production build using bundled synthetic fixtures. Analysis runs in a worker on your device; local tarballs stay in your browser. Package scripts are displayed as inert text and are never run.

## CLI quickstart

Requires Node 22.13+ or Node 24. Run the versioned scoped package directly:

```sh
npx --yes @kaushikgojo/release-lens@0.1.2 diff before.tgz after.tgz --format json
```

For **0.1.2**, the [versioned release report](https://github.com/Lingikaushikreddy/release-lens/releases/download/v0.1.2/RELEASE_REPORT.md) records the six clean npx/npm installation cases, exact archive hash and verified provenance. Download the [raw verification bundle](https://github.com/Lingikaushikreddy/release-lens/releases/download/v0.1.2/release-lens-0.1.2-verification.zip) for individual receipts.

For the earlier **0.1.1**, real registry npx and clean npm installation passed on **Windows, Linux and macOS with Node 22/24**, including a [complete release rerun](https://github.com/Lingikaushikreddy/release-lens/actions/runs/38990498134/attempts/2). That rerun skipped npm publication after matching the existing archive's exact bytes. Historical **0.1.0** installation results remain in [the npm release report](evidence/NPM_RELEASE.md).

Or install this release globally:

```sh
npm install --global @kaushikgojo/release-lens@0.1.2
releaselens diff before.tgz after.tgz --format json
```

Replace `before.tgz` and `after.tgz` with your package artifacts. The npm package is **`@kaushikgojo/release-lens`**; its installed command is **`releaselens`**. The unscoped npm name `releaselens` belongs to a different project. Installing above installs Release Lens itself; analyzed packages are never installed.

To save a report and enforce a 1 MiB unpacked growth budget:

```sh
releaselens diff before.tgz after.tgz --format json \
  --out report.json --max-unpacked-growth 1048576
```

`--out` writes atomically and leaves stdout empty. Without it, stdout contains only the selected report. Diagnostics go to stderr. Exit codes: **0** completed within budget or no budget; **1** budget exceeded; **2** bad arguments or archive; **3** I/O or unsupported runtime; **130** cancellation. Warnings do not change the exit status. `releaselens --help` documents all arguments.

## Reports and verification

Releases are automated through [GitHub Actions](https://github.com/Lingikaushikreddy/release-lens/blob/main/.github/workflows/release.yml): matching version tags require the exact commit's full CI matrix, publish the tested tarball through npm trusted publishing, and run fresh npx/npm installs on Windows, Linux and macOS with Node 22/24. GitHub releases are finalized after all six cases and source-bound provenance verification pass. See [the release runbook](https://github.com/Lingikaushikreddy/release-lens/blob/main/docs/releasing.md) for tags, manual candidate rehearsals and failure recovery.

Failure and rerun paths are exercised too: the full **0.1.1** rerun passed all nine jobs without republishing or changing the eight original release assets. A separate read-only rehearsal deliberately failed the real archive-integrity check, then passed a failed-job rerun using the preserved reviewed artifact. [The safety report](evidence/RELEASE_SAFETY.md) includes raw records and the limits of the injected tests.

| Evidence | What it records |
| --- | --- |
| [0.1.2 automated release report](https://github.com/Lingikaushikreddy/release-lens/releases/download/v0.1.2/RELEASE_REPORT.md) | Exact source/main-CI/release-run links, Windows/Linux/macOS Node 22/24 registry results, archive identity and source-bound provenance. [Raw receipts and attestations](https://github.com/Lingikaushikreddy/release-lens/releases/download/v0.1.2/release-lens-0.1.2-verification.zip). |
| [Release safety report](evidence/RELEASE_SAFETY.md) | Live existing-version skip, expected integrity failure and successful recovery, plus 60 local release checks on each supported Node version. |
| [0.1.1 release rerun, attempt 2](https://github.com/Lingikaushikreddy/release-lens/actions/runs/38990498134/attempts/2) | All nine jobs passed; npm publish skipped; all six fresh Windows/Linux/macOS Node 22/24 registry cases passed again. |
| [Failure and recovery rehearsal](https://github.com/Lingikaushikreddy/release-lens/actions/runs/38991624156) | Attempt 1 rejected a deliberately corrupted local expectation; attempt 2 reused the original artifact and passed real anonymous npx/npm installation. |
| [Cross-platform registry run 38988622040](https://github.com/Lingikaushikreddy/release-lens/actions/runs/38988622040) | Six successful real npx and clean npm installation cases: Node 22/24 on Windows, Linux and macOS, using anonymous registry access and fresh caches. |
| [npm release verification](https://github.com/Lingikaushikreddy/release-lens/blob/main/evidence/NPM_RELEASE.md) | Published artifact identity, the six-case hosted registry matrix, and downloadable verification reports for `@kaushikgojo/release-lens@0.1.0`. |
| [Hosted CI run 38985298412](https://github.com/Lingikaushikreddy/release-lens/actions/runs/38985298412) | Successful verification of the original GitHub release commit `ff246497`: Node 22/24 on Linux, macOS and Windows, browser checks, and deployment checks. |
| [0.1.0 verification bundle](https://github.com/Lingikaushikreddy/release-lens/releases/download/v0.1.0/release-lens-0.1.0-verification.zip) | Downloadable hosted verification evidence for the original GitHub release. [SHA256SUMS](https://github.com/Lingikaushikreddy/release-lens/releases/download/v0.1.0/SHA256SUMS) and [release.json](https://github.com/Lingikaushikreddy/release-lens/releases/download/v0.1.0/release.json) identify release assets. |
| [Independent oracle report](https://github.com/Lingikaushikreddy/release-lens/blob/main/evidence/oracle.json) | Four supported artifact pairs checked with CPython `tarfile` and `hashlib`: synthetic growth, cleanup, inert hostile text, and real `is-number` 6.0.0 → 7.0.0 tarballs. |
| [Public release verification](https://github.com/Lingikaushikreddy/release-lens/blob/main/evidence/PUBLIC_RELEASE.md) | Hosted release process, required checks, evidence boundaries, and outstanding maintainer pilots. |
| [Measurement contract](https://github.com/Lingikaushikreddy/release-lens/blob/main/docs/measurement-contract.md) | Exact report semantics and limits of each measurement and finding. |

The 0.1.0 bundle and its hosted CI run record the original public artifacts. The npm release report records the later scoped npm publication and its distribution checks.

The independent oracle checks paths, payload lengths, hashes, whole archive lengths, deltas, and repeated JSON output without extracting to disk. It checks valid supported inputs; it does not define acceptance policy for malformed archives. Real fixture identities and original registry URLs are in [the corpus records](https://github.com/Lingikaushikreddy/release-lens/blob/main/fixtures/real/records.json). The earlier macOS candidate observations remain in [the historical report](https://github.com/Lingikaushikreddy/release-lens/blob/main/evidence/RELEASE.md).

## What the report means

`unpackedBytes` counts regular-file payloads. Every file delta adds exactly to the reported payload growth. Categories are filename heuristics. `archiveDelta` is the change in whole gzip file bytes; per-file compressed contributions are not additive and are not claimed. Neither measure is the installed footprint.

Manifest comparisons cover `files`, `exports`, `main`, `module`, `types`, `bin`, `engines`, dependencies, and scripts. Target checks establish only that an exact local regular file exists in the tarball. Wildcards and unsupported targets remain explicitly unchecked. This does not establish Node resolution, compatibility, package safety, complete install footprint, or provenance.

The JSON schema is version **1**, stable throughout `0.1.x`; absent and null manifest values are distinguished by existence flags. Deterministic output excludes timestamps and local machine paths. See [the measurement contract](https://github.com/Lingikaushikreddy/release-lens/blob/main/docs/measurement-contract.md).

## Input limits

Per archive: 25 MiB compressed, 150 MiB expanded (including tar overhead), 20,000 tar records including extension records, 16 MiB per file, 1 MiB aggregate PAX metadata, 1 MiB manifest and bounded gzip headers, manifest depth 64. Only the documented gzip/USTAR/PAX subset is accepted. Links, special entries, traversal, absolute paths, duplicate effective paths, malformed/truncated data, absent or invalid `package/package.json`, and unsupported extensions fail without a successful partial report. Nothing is extracted to disk. See [the parser audit](https://github.com/Lingikaushikreddy/release-lens/blob/main/docs/parser-audit.md).

## Develop from source

Development requires Node 22.13+ or Node 24, pnpm 11.25.0, and Python 3 for fixture/oracle checks.

```sh
git clone https://github.com/Lingikaushikreddy/release-lens.git
cd release-lens
pnpm install --frozen-lockfile
pnpm fixtures
pnpm build
pnpm dev
```

Open the printed local URL. To run the CLI directly from the checkout:

```sh
pnpm build:cli
node packages/cli/dist/main.js diff fixtures/before.tgz fixtures/after.tgz \
  --format json --out report.json --max-unpacked-growth 1048576
```

This bundled example deliberately exits **1** because its growth exceeds the budget.

Run the verification suite:

```sh
pnpm check
pnpm test
pnpm test:release
pnpm build
pnpm test:oracle
pnpm test:pack
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
```

Development-only corpus reacquisition uses `python3 scripts/fetch-corpus.py`. Read [CONTRIBUTING.md](https://github.com/Lingikaushikreddy/release-lens/blob/main/CONTRIBUTING.md) for development guidance.

## Alternatives and scope

[diffoscope](https://diffoscope.org/) compares many artifact formats in depth. [Size Limit](https://github.com/ai/size-limit) focuses on build and performance budgets. [pkg-size](https://github.com/pkg-size/pkg-size) measures package/install sizes. Release Lens focuses on reviewing the exact contents and manifest evidence of two supplied npm release artifacts. It has no application backend, accounts, registry fetching, or PR commenting.

MIT licensed. Read [SECURITY.md](https://github.com/Lingikaushikreddy/release-lens/blob/main/SECURITY.md) before reporting private package data.
