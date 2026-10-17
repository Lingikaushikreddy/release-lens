# npm 0.1.0 publication verification

Package: [`@kaushikgojo/release-lens@0.1.0`](https://www.npmjs.com/package/@kaushikgojo/release-lens/v/0.1.0)

Executable: `releaselens`. The unscoped registry package `releaselens` belongs to a different publisher and is not this project.

## Publication gate

The scoped distribution adds npm metadata and the illustrated README to the existing Release Lens 0.1.0 implementation. Publication is gated on the exact source commit passing the complete hosted [CI workflow](https://github.com/Lingikaushikreddy/release-lens/actions/workflows/ci.yml): Node 22/24 on Ubuntu, macOS and Windows; Chromium/Firefox/WebKit checks on Node 22/24; the independent Python oracle; and the deployed project-subpath checks.

Status: preparing the scoped distribution. Registry publication and registry clean-install checks have not yet completed. This report will record the executed results after publication.

## Registry verification procedure

`scripts/test-registry.mjs` obtains the pinned package directly from `https://registry.npmjs.org/`, using new empty consumer directories, independent fresh npm caches and a private empty global prefix for each run. It requires `RELEASE_LENS_REGISTRY_ARTIFACT` and checks the registry tarball integrity against that exact reviewed publication artifact. The npx cache installation and consumer lockfile must identify the same registry tarball and integrity. It also checks the installed package identity and executable, and execution through both npm installation and npx.

The behavior checks use independently constructed fixture expectations: +18,874,372 B for the synthetic growth pair, −18,874,372 B for the clean follow-up, an inclusive budget boundary, budget failure exit 1, malformed archive exit 2, deterministic JSON and atomic report output. These verify distribution and documented behavior; they do not establish malware safety or complete Node resolution semantics.

The original [GitHub 0.1.0 bundle](https://github.com/Lingikaushikreddy/release-lens/releases/tag/v0.1.0) and its checksums remain historical evidence for commit `ff246497ad8b765bb1956dbebcf0de352bc2f560`. The scoped npm artifact is a separate distribution and will have its own source commit and integrity record. A local npm publication does not provide a hosted provenance attestation.
