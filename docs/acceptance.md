# Acceptance map

| Claim | Executable evidence |
|---|---|
| Exact regular-file inventory and hashes | tests/archive.test.ts, tests/archive-properties.test.ts; scripts/verify-oracle.py independent CPython read |
| Every delta reconciles | tests/compare.test.ts, generated inventories seed 20261016, independent Python file-by-file check |
| Explicit strict tar/gzip subset | docs/parser-audit.md, tests/archive.test.ts handcrafted headers/PAX/framing/trailers |
| Limits count observed bytes before retention | archive tests declarations, observed count mismatches, expanded tar overhead, physical 20001 records |
| Literal manifest checks preserve evidence | tests/manifest.test.ts: nested conditions, pointers, missing/null, unsupported values and prototype-like keys |
| Deterministic outputs | comparison canonical order tests; repeated CLI output and browser download parity |
| CLI exits/atomic writes/input preservation | tests/cli.test.ts; installed package test scripts/test-pack.mjs |
| Browser worker/cancel/inert text/offline | tests/e2e/review.spec.ts in Chromium, Firefox, WebKit |
| Read-only effects | scripts/verify-effects.mjs instrumented runtime entry points plus parser dependency source audit |
| Release contents work outside repo | scripts/test-pack.mjs clean consumer, bundled examples and notices |
| Supported runtimes/platforms | locally executed Node22/24 on macOS; CI matrix configuration for remaining OSs, separate from run evidence |
| Useful to maintainers | external pilot required; no interview/adoption claims from synthetic tests |

Passing these checks establishes the declared tested contract. It does not certify all malformed-input behavior, package compatibility, malware safety or product demand.
