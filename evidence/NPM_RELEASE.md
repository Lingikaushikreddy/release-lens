# npm 0.1.0 publication verification

[`@kaushikgojo/release-lens@0.1.0`](https://www.npmjs.com/package/@kaushikgojo/release-lens/v/0.1.0) was published publicly by **kaushikgojo** at **2026-10-17 00:34:24 UTC**. The recorded `latest` tag is `0.1.0`; the executable is `releaselens`. The unscoped npm package `releaselens` belongs to another project. See [registry metadata](https://github.com/Lingikaushikreddy/release-lens/blob/main/evidence/npm/registry-manifest.json).

```sh
npx --yes @kaushikgojo/release-lens@0.1.0 diff before.tgz after.tgz --format json
```

## Source and artifact identity

[CI run 38986361404](https://github.com/Lingikaushikreddy/release-lens/actions/runs/38986361404) completed **all 12 jobs successfully** for source commit `d6afbbe5c33f2341cc5cf898e63b74b9757c9423`: Node 22/24 installed-tarball checks on Linux, macOS and Windows; Chromium/Firefox/WebKit checks; independent Python oracle; site verification/deployment; and release packaging. [Executed CI receipt](https://github.com/Lingikaushikreddy/release-lens/blob/main/evidence/npm/ci-run.json).

The npm tarball is **36,395 bytes**, byte-identical to the tested CI artifact and the anonymous registry download:

```text
SHA-256 f4cf049a1b4a7255a56e762d5775cd57776b52ed1b3c6813e1a7f5b19d6bddd2
SHA-512 integrity sha512-TRN7N5Qty46V4BLQw/HGLOGZq2Oz4HvrK4pvkibZq9hdr0e+n6QWJIxe4q1vGuovT3eT7CByKCDTjwytQUnCKw==
```

Registry `gitHead` is `ca901bff19edcd0aceb60e49324121ae44d1085e`, which differs from the CI source commit. The source connection above is established through exact CI artifact bytes and the registry download, rather than that metadata field. No hosted npm provenance attestation is claimed.

## Registry and deployed-app checks

Fresh registry runs passed on **macOS**, using **Node 22.23.3 and 24.22.0**, each with **npm/npx 11.5.1**. Receipts: [Node 22](https://github.com/Lingikaushikreddy/release-lens/blob/main/evidence/npm/registry-node22.json), [Node 24](https://github.com/Lingikaushikreddy/release-lens/blob/main/evidence/npm/registry-node24.json). Each run used empty consumer directories, separate cold caches, and an empty private global prefix. Anonymous HTTP metadata/tarball checks verified identity and integrity; npx's cache installation and the installed consumer lockfile matched the registry tarball. Global fallback was excluded, lifecycle scripts were disabled, and runtime dependency count was zero.

Both distribution paths produced identical deterministic JSON. Checks passed for independently expected **+18,874,372 B** growth and **−18,874,372 B** cleanup, finding side/pointer evidence, inclusive budgets, exit codes 1/2/3, atomic output replacement, preservation on validation failure, temporary-file cleanup, and unchanged inputs. These registry checks cover macOS; the hosted three-OS checks installed the CI tarball.

[Public deployment verification](https://github.com/Lingikaushikreddy/release-lens/blob/main/evidence/npm/public-deployment.json) matched all **10 regular files** in the CI Pages artifact plus the root index alias: **11 HTTP 200 response bodies**, byte-for-byte. This checks listed payloads at the recorded time, not additional server paths, transport bytes, or browser behavior.

## Reproduce and download

Run the verifier with an explicit Node 22.23.3 binary; repeat with Node 24.22.0. It requires npm/npx 11.5.1 on PATH and uses only Node built-ins, so no dependency install or build is needed. The verifier places the selected Node binary’s directory first on its subprocess PATH. Supply the exact CI tarball identified above:

```sh
RELEASE_LENS_REGISTRY_ARTIFACT=/absolute/path/to/releaselens-0.1.0.tgz \
  /absolute/path/to/node-v22.23.3/bin/node scripts/test-registry.mjs
```

Download the [npm verification bundle](https://github.com/Lingikaushikreddy/release-lens/releases/download/v0.1.0/release-lens-0.1.0-npm-verification.zip) and [NPM_SHA256SUMS](https://github.com/Lingikaushikreddy/release-lens/releases/download/v0.1.0/NPM_SHA256SUMS). The original GitHub 0.1.0 bundle/checksums for `ff246497ad8b765bb1956dbebcf0de352bc2f560` remain distinct historical evidence. These checks do not establish malware safety or package compatibility.
