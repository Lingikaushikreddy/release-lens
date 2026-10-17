# npm 0.1.0 publication and cross-platform verification

[`@kaushikgojo/release-lens@0.1.0`](https://www.npmjs.com/package/@kaushikgojo/release-lens/v/0.1.0) was published publicly by **kaushikgojo** on **October 16, 2026 at 5:34:24 PM PDT**; recorded `latest` is `0.1.0`. [Registry metadata](https://github.com/Lingikaushikreddy/release-lens/blob/main/evidence/npm/registry-manifest.json). Its command is `releaselens`; the unscoped npm name belongs to another project.

```sh
npx --yes @kaushikgojo/release-lens@0.1.0 diff before.tgz after.tgz --format json
```

## Published artifact

The **36,395-byte** registry tarball matches the reviewed CI artifact exactly:

```text
SHA-256 f4cf049a1b4a7255a56e762d5775cd57776b52ed1b3c6813e1a7f5b19d6bddd2
SHA-512 integrity sha512-TRN7N5Qty46V4BLQw/HGLOGZq2Oz4HvrK4pvkibZq9hdr0e+n6QWJIxe4q1vGuovT3eT7CByKCDTjwytQUnCKw==
```

Published source `d6afbbe5c33f2341cc5cf898e63b74b9757c9423` passed [all 12 original CI jobs](https://github.com/Lingikaushikreddy/release-lens/actions/runs/38986361404), including installed-tarball checks across three OSes, browsers, oracle and deployment. Registry `gitHead` is the different `ca901bff19edcd0aceb60e49324121ae44d1085e`. Source linkage rests on exact CI-artifact/registry-download bytes. No hosted npm provenance attestation is claimed.

## Real registry verification

[Run 38988622040](https://github.com/Lingikaushikreddy/release-lens/actions/runs/38988622040) passed **all six jobs** on **October 16, 2026 at 5:56 PM PDT**, using verifier commit `c893f1609bd44c6e341181c3c0eb278f61b8146e`. [Run receipt](https://github.com/Lingikaushikreddy/release-lens/blob/main/evidence/npm/cross-platform/run.json) · [Matrix summary](https://github.com/Lingikaushikreddy/release-lens/blob/main/evidence/npm/cross-platform/summary.json).

| Runner | Platform / arch | Node | npm / npx | Image | Receipt |
| --- | --- | --- | --- | --- | --- |
| Ubuntu | linux / x64 | 22.23.3 | 10.9.9 | ubuntu24 | [PASS](https://github.com/Lingikaushikreddy/release-lens/blob/main/evidence/npm/cross-platform/registry-node22-ubuntu-latest.json) |
| Ubuntu | linux / x64 | 24.21.0 | 11.19.0 | ubuntu24 | [PASS](https://github.com/Lingikaushikreddy/release-lens/blob/main/evidence/npm/cross-platform/registry-node24-ubuntu-latest.json) |
| Windows | win32 / x64 | 22.23.3 | 10.9.9 | win25-vs2026 | [PASS](https://github.com/Lingikaushikreddy/release-lens/blob/main/evidence/npm/cross-platform/registry-node22-windows-latest.json) |
| Windows | win32 / x64 | 24.21.0 | 11.19.0 | win25-vs2026 | [PASS](https://github.com/Lingikaushikreddy/release-lens/blob/main/evidence/npm/cross-platform/registry-node24-windows-latest.json) |
| macOS | darwin / arm64 | 22.23.3 | 10.9.9 | macos26 | [PASS](https://github.com/Lingikaushikreddy/release-lens/blob/main/evidence/npm/cross-platform/registry-node22-macos-latest.json) |
| macOS | darwin / arm64 | 24.21.0 | 11.19.0 | macos26 | [PASS](https://github.com/Lingikaushikreddy/release-lens/blob/main/evidence/npm/cross-platform/registry-node24-macos-latest.json) |

Every case used anonymous npm configuration, empty consumers, independent cold caches and a fresh private global prefix. Metadata, registry download, npx cache installation and consumer lockfile matched the pinned artifact. Scripts were disabled; runtime dependencies were zero. Windows installed execution used offline local `npm exec` through the installed `.cmd` shim; Unix used the installed bin directly.

Real npx and installed execution matched deterministic JSON: **+18,874,372 B** growth and **−18,874,372 B** cleanup. Inclusive budgets, exits 1/2/3, malformed archives, atomic output, failure preservation, temporary-file cleanup and unchanged inputs passed.

[Initial run 38988391987](https://github.com/Lingikaushikreddy/release-lens/actions/runs/38988391987) failed Node 22 verifier checks because npm 10 omitted private `_npx` metadata. The corrected verifier checks durable dependency declarations and exact lockfile identity. The published CLI was unchanged.

[Earlier deployment verification](https://github.com/Lingikaushikreddy/release-lens/blob/main/evidence/npm/public-deployment.json) matched 10 CI-artifact files plus the root alias: 11 HTTP 200 response bodies. It does not enumerate additional server paths. These checks establish neither malware safety nor package compatibility.

## Reproduce and download

Dispatch the hosted matrix:

```sh
gh workflow run verify-npm-0.1.0.yml --ref main
```

Or select an explicit Node binary and npm/npx versions from the table. The verifier needs no dependency installation/build; it prepends the selected Node directory to subprocess PATH:

```sh
RELEASE_LENS_REGISTRY_ARTIFACT=/absolute/path/to/releaselens-0.1.0.tgz \
  /absolute/path/to/node-v22.23.3/bin/node scripts/test-registry.mjs
```

Download [cross-platform verification](https://github.com/Lingikaushikreddy/release-lens/releases/download/v0.1.0/release-lens-0.1.0-cross-platform-verification.zip) and [CROSS_PLATFORM_SHA256SUMS](https://github.com/Lingikaushikreddy/release-lens/releases/download/v0.1.0/CROSS_PLATFORM_SHA256SUMS). This supersedes the historical macOS-only [npm verification bundle](https://github.com/Lingikaushikreddy/release-lens/releases/download/v0.1.0/release-lens-0.1.0-npm-verification.zip)/[NPM_SHA256SUMS](https://github.com/Lingikaushikreddy/release-lens/releases/download/v0.1.0/NPM_SHA256SUMS). Original GitHub assets/checksums for `ff246497ad8b765bb1956dbebcf0de352bc2f560` remain distinct historical evidence.
