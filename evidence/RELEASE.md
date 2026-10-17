# Release Lens 0.1.0 release candidate

Candidate prepared locally on 2026-10-16. It contains the static browser application, self-contained CLI, source, frozen fixtures and verification records. No npm publication or public GitHub release is claimed.

## Executed evidence

The final implementation passed the following checks. Per-runtime logs and JSON receipts accompany this summary in the source/evidence bundle:

| Check | Observed result |
|---|---|
| Node 22.23.3 / macOS arm64 | 77 tests passed; installed CLI (runtime matched parent), four Python oracle pairs and effect guard passed |
| Node 24.22.0 / macOS arm64 | 77 tests passed; installed CLI (runtime matched parent), four Python oracle pairs and effect guard passed |
| Chromium, Firefox, WebKit | 24 production browser cases passed including offline analysis, cancellation, stale clearing, literal hostile text, mobile layout and JSON identical to CLI |
| Independent CPython oracle | Paths, byte counts, SHA-256 values and deltas match for four artifact pairs; repeated outputs identical |
| Near-limit resource observation | 149 MiB payload (each file <=16 MiB), Node 24.22.0: 2.3208 seconds; peak RSS 102,736 KiB on macOS arm64; finite observation, not a general memory promise |
| Development startup | Real worker analysis, applied styles, zero CSP violations, and fresh per-response nonce verified in Chromium, Firefox and WebKit; production CSP unchanged |
| TypeScript and production build | Both passed on the final implementation |
| Fresh code review | Two P2 findings and installed-doc gap fixed; scoped independent re-review found no introduced serious issue |
| UI visual review | Desktop 1440px and mobile 390px screenshots inspected |

## Review findings

A fresh reviewer reproduced two issues: FIFO input could block before the regular-file check, and CLI text findings omitted side/pointer evidence. Both were reproduced with failing regression tests and fixed. POSIX input open is nonblocking followed by a regular-file check; the reviewer independently measured FIFO refusal at 34 ms. CLI text now preserves safely quoted archive side, manifest pointer and evidence paths. The referenced installed-package documents now ship and are required by the packed-consumer test. Independent re-review confirmed these fixes.

## Interpretation and limits

The synthetic growth pair adds 18,874,368 fixture bytes plus four manifest bytes: total **18,874,372 payload bytes**. Actual gzip growth is **18,502 bytes**. The cleanup pair removes the same payload growth. The real `is-number` 6.0.0 -> 7.0.0 pair has **655 additional payload bytes** and **256 additional archive bytes**. These are measurements, not claims that the real changes are defects.

Input hashes and registry URLs are recorded in fixtures/real/records.json and the independent oracle receipts. The valid-input Python oracle does not define malformed-input acceptance. Refusal behavior is tested against the written strict archive policy and crafted bytes. Effect guards check observable JS I/O/network/process entry points plus source inspection; they are not an OS sandbox or exhaustive security proof.

The custom bounded deflate boundary scanner is the main maintenance risk. Keep its stored/fixed/dynamic, corruption, chunking and generated-input regressions when changing native runtimes or parser versions. JSON schemaVersion remains 1 throughout 0.1.x; absent and null values retain separate existence flags.

## Outstanding external validation

- The Linux/macOS/Windows Node22/24 and Linux browser CI workflows are configured. Only macOS arm64 runs were executed in this environment; no remote CI results are claimed.
- Maintainer interviews, real-user completion/return rates, and the original 30-second/2-minute interaction targets require actual participant sessions. Automated example completion establishes functioning behavior and machine timing only.
- Public hosting, npm name/domain availability, npm publication, GitHub repository/issue channels, public tagging and pilots remain maintainer launch steps. This deliverable is the requested local release candidate.
