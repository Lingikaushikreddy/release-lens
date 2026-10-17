# Release Lens Implementation Plan

This file contains the Release Lens plan and the shared [GitHub discovery and market research](#github-discovery-and-market-research) for all five projects. Start with the research section for the portfolio decision, then use each project's implementation tasks.

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task by task. The checkboxes below describe future implementation; no product has been built.

**Goal:** Explain exactly what changed between two publishable npm tarballs, including byte growth, added files, and package entry-point metadata, without installing or executing either package.

**Architecture:** A shared TypeScript analysis library streams two local `.tgz` files into bounded inventories and compares their normalized paths. A browser worker powers a static review interface; a small Node CLI produces the identical versioned JSON report. There is no application backend.

**Tech stack:** TypeScript, Node 24 for development, pnpm, Vite, React, Web Workers, `modern-tar`, native gzip streams, Vitest, and Playwright. Pin concrete dependency versions and the package manager on day one.

**Spec:** Embedded below. Research checked **2026-10-16**; working name, repository name, npm name, and domain availability are unverified. Rank **#1** within this portfolio for potential GitHub attention; this is a judgment about usefulness and demonstration, not a forecast.

## Opportunity and evidence

The target user is an npm library maintainer reviewing a release candidate: “Why did this patch add megabytes, and are the files named in `bin` and `exports` actually present?” The result should help them change a release before publishing.

Existing products establish that developers already invest in this workflow:

| Verified alternative | Existing capability | Proposed narrow difference |
| --- | --- | --- |
| [diffoscope](https://diffoscope.org/) | Recursively compares archives and many binary formats; exports HTML/text. Its site lists release 333 on **2026-10-09**. | Start with npm release review: additive size accounting and manifest changes in one short report. Do not attempt comparable format coverage. |
| [Size Limit](https://github.com/ai/size-limit) | CI performance budgets, dependency explanations with `--why`, HTML reports, and build-stat comparisons. | Inspect files actually included in two tarballs, including docs, maps, fixtures, and missing literal targets, without requiring a bundler configuration. |
| [pkg-size](https://github.com/pkg-size/pkg-size) | Publish sizes, installed package sizes including transitive dependencies, grouping, and a PR regression-report Action. | A browser-first before/after artifact review, with path-level additions/removals and metadata beside the size change. Size measurement itself is already solved. |

[publint](https://publint.dev/docs/troubleshooting) documents that package managers can pack different files and lifecycle behavior can complicate inspection. That supports analyzing the exact tarball supplied by a maintainer, but also shows why this project should integrate with package linters instead of replacing them. The distinction from incumbents is a focused interaction and report, not a new analysis technique.

The zero-key demo uses two synthetic release fixtures. Click **Compare example releases** to see an intentionally added 18 MiB fixture directory and a missing `bin` target, then remove the fixture directory in a second example. Aim for first useful result within **30 seconds**, and a first real comparison within **two minutes** once tarballs exist. Those are acceptance targets to measure, not established performance claims.

## Embedded product specification

**MVP:** Two local npm `.tgz` inputs; gzip and uncompressed totals; path and category deltas; search; changed `files`, `exports`, `main`, `module`, `types`, `bin`, `engines`, dependencies, and lifecycle scripts; existence checks for literal local targets; optional byte-growth budget; JSON export; CLI; bundled example.

Every uncompressed file-byte delta must reconcile to the reported total. Display the actual gzip archive delta separately: compression dictionaries mean per-file contributions do not add up to the whole archive's compressed size. Classifications such as “source maps” are filename-based heuristics, visibly labeled. Identical hashes under different paths may be suggested as moves, never silently merged.

**Non-goals:** Installing packages, running scripts, resolving dependencies, measuring complete install footprint, determining malware or compatibility, rebuilding source, registry fetching, checking provenance, source-map parsing, Docker images, Python wheels, accounts, and PR commenting. “Installed-release” means the artifact a consumer receives; it does not mean simulated installation.

**Global constraints:** Read-only input; no archive extraction to disk; no network after static assets load; no remote fonts/analytics; deterministic reports; Node 22/24 CLI checks; current Chromium/Firefox/WebKit browser checks. Limits per input: 25 MiB compressed, 150 MiB expanded, 20,000 entries, and 16 MiB per file. Reject links, device entries, absolute/traversing paths, duplicate normalized paths, malformed tar data, missing `package/package.json`, and invalid manifest JSON. Cancel workers on request. Unsupported input produces no partial success report.

**Review focus:** Tar truncation and misleading entry sizes; PAX path overrides; zero-byte files and directories; conditionally nested exports; untrusted filenames/script text rendered as markup. Each is assigned an acceptance test below.

## Repository and contracts

```text
apps/web/src/{App.tsx,analysis.worker.ts,report.tsx}
packages/core/src/{types.ts,archive.ts,compare.ts,manifest.ts,budget.ts}
packages/cli/src/main.ts
tests/{archive,compare,manifest,budget,cli}.test.ts
tests/e2e/review.spec.ts
fixtures/{before.tgz,after.tgz,clean.tgz,hostile/}
scripts/{make-fixtures.mjs,test-pack.mjs}
.github/workflows/{ci.yml,release.yml}
README.md  SECURITY.md  CONTRIBUTING.md  LICENSE
```

Use these public contracts; keep parser-library details inside `archive.ts`:

```ts
type Entry = { path: string; bytes: number; sha256: string };
type Inventory = { schemaVersion: 1; archiveBytes: number;
  unpackedBytes: number; entries: Entry[]; manifest: Record<string, unknown> };
type Report = { schemaVersion: 1; before: Inventory; after: Inventory;
  fileDeltas: FileDelta[]; manifestChanges: ManifestChange[];
  findings: Finding[]; unpackedDelta: number; archiveDelta: number;
  budget: "unset" | "pass" | "fail" };
```

`FileDelta` contains path, before/after bytes, signed delta, change kind, category, and hashes. `ManifestChange` contains a JSON pointer plus before/after values. `Finding` contains a stable code, severity `info|warning`, and evidence paths. Functions: `readInventory(input: ReadableStream<Uint8Array>, archiveBytes: number, limits: Limits): Promise<Inventory>`; `compare(before: Inventory, after: Inventory): Report`; `checkLiteralTargets(inventory: Inventory): Finding[]`; `applyBudget(report: Report, maxGrowth: number): Report`.

CLI: `releaselens diff before.tgz after.tgz --format json --out report.json --max-unpacked-growth 1048576`. Exit **0** for a completed comparison within budget or without one; **1** for budget failure; **2** for invalid arguments/config/archive; **3** for I/O or unsupported runtime; **130** for cancellation. Warnings do not change exit status. Use stderr for diagnostics and stdout only for selected output. Output schema remains stable throughout `0.1.x`.

## Implementation tasks

Each task follows a red/green/review/commit cycle. Configure `test` as `vitest run`, `test:e2e` as `playwright test`, and `check` as `tsc --noEmit`. Listed commands and results are future acceptance criteria, not work already run.

### Task 1 — Bounded archive inventory

**Files:** `types.ts`, `archive.ts`, `tests/archive.test.ts`, fixture generator, workspace configuration. **Consumes:** local byte streams. **Produces:** `Inventory`, `Limits`, typed `AnalysisError` with `FORMAT|LIMIT|UNSUPPORTED` codes. Use the [modern-tar streaming core](https://github.com/ayuhito/modern-tar), which supports browser streams and PAX, wrapped with independent counters and path checks.

- [ ] Write `rejectsTraversal`, `rejectsDuplicatePaxPath`, `rejectsTruncatedBody`, and `countsEmptyFile`: assert `FORMAT` for the first three and zero bytes for the last. Assert declared oversized entries fail before buffering their bodies.
- [ ] Run `pnpm test tests/archive.test.ts`; confirm failure because inventory parsing is absent.
- [ ] Implement `readInventory`; hash streamed content and retain metadata only, except bounded manifest bytes. Do not import the library's filesystem extractor.
- [ ] Rerun the command; require all tests passing and a 20,001-entry fixture returning `LIMIT`.
- [ ] Review memory/cancellation handling; commit `feat: inventory bounded npm archives`.

### Task 2 — Exact byte delta accounting

**Files:** `compare.ts`, `tests/compare.test.ts`. **Consumes:** two inventories. **Produces:** `Report`, `FileDelta`, `ManifestChange`, and category assignments.

- [ ] Write `accountsForEveryByte`: before total 100, after 145, deltas `+60,-20,+5`; assert sum 45. Test same-size content edits via hashes and deterministic path sorting.
- [ ] Run `pnpm test tests/compare.test.ts`; confirm failure for missing comparison.
- [ ] Implement `compare`; keep archive-byte changes independent and include an explicit `other` category.
- [ ] Rerun; require the example's added fixture directory to explain exactly its uncompressed growth.
- [ ] Review category wording and move suggestions; commit `feat: explain release byte deltas`.

### Task 3 — Manifest evidence and budget

**Files:** `manifest.ts`, `budget.ts`, corresponding tests. **Consumes:** inventories/report. **Produces:** literal-target findings and budget status.

- [ ] Write assertions that `bin.tool="dist/missing.js"` yields `MISSING_LITERAL_TARGET`, wildcard exports yield `UNCHECKED_PATTERN`, nested conditions retain JSON pointers, and growth 101 exceeds budget 100 while 100 passes.
- [ ] Run `pnpm test tests/manifest.test.ts tests/budget.test.ts`; confirm failures.
- [ ] Implement checks only for literal relative file targets; never claim full Node resolution or execute scripts.
- [ ] Rerun; require explicit unchecked findings rather than a false “valid exports” result.
- [ ] Review findings against fixture contents; commit `feat: attach manifest evidence and budgets`.

### Task 4 — Browser review workflow

**Files:** web files, `tests/e2e/review.spec.ts`. **Consumes:** worker messages carrying the same report contract. **Produces:** keyboard-accessible comparison, progress/cancel, search, and JSON download.

- [ ] Write browser tests: example result appears; pressing Cancel terminates work; `<img onerror=...>` filename stays literal; replacing either input clears stale results.
- [ ] Run `pnpm test:e2e`; confirm these tests fail before UI implementation.
- [ ] Build summary → category waterfall → file list → manifest evidence; use text rendering throughout. Add a self-hosted-assets CSP.
- [ ] Rerun in three browser engines; block external requests and require unchanged analysis results.
- [ ] Review empty/error states and focus order; commit `feat: review releases in the browser`.

### Task 5 — CLI and portable output

**Files:** CLI, `tests/cli.test.ts`, `scripts/test-pack.mjs`. **Consumes:** core APIs. **Produces:** installable CLI and reproducible JSON.

- [ ] Write subprocess tests for exits 0/1/2/3 and byte-identical JSON from repeated comparisons; assert output files appear atomically.
- [ ] Run `pnpm test tests/cli.test.ts`; confirm failure before the executable exists.
- [ ] Implement argument handling and temp-file rename; include no registry-client or child-process execution feature.
- [ ] Rerun, build, then run `pnpm test:pack`; install the project's own packed package in a clean temporary consumer and compare shipped examples.
- [ ] Review published file list and stdout/stderr; commit `feat: ship offline release comparison CLI`.

### Task 6 — Release and documented adoption

**Files:** workflows, README, security/contribution guides, license, corpus tests. **Consumes:** completed web/CLI. **Produces:** reviewed `0.1.0` release candidate.

- [ ] Add failing checks for omitted CLI assets, broken README commands, and hostile corpus regressions.
- [ ] Run `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, and `pnpm test:pack`; capture the failing cases.
- [ ] Fix packaging/docs; add CI for Node 22/24 and three desktop operating systems, browser tests on Linux, and bounded randomized archive cases.
- [ ] Require the same commands passing; manually compare a public real release pair and label findings as evidence, not defects without maintainer confirmation.
- [ ] Review dependency licenses, limits, changelog, and tarball contents; commit `release: prepare version 0.1.0`. Tagging/publishing remains a future maintainer action.

## Six-week delivery and operating budget

At **25–35 hours/week**, plan 168 hours plus 12 hours of buffer: week 1 Task 1 and user validation, 24h; week 2 Task 2, 30h; week 3 Task 3, 30h; week 4 Task 4, 28h; week 5 Task 5, 24h; week 6 Task 6, 32h. If time slips, drop move suggestions and category polish before weakening input checks. Desktop packaging, remote APIs, and new ecosystems wait.

Assume static hosting and public CI fit available free allowances: target **$0–15/month**, with a **$25/month hard budget** and optional domain outside it. These are planning allowances, not provider quotes. Cap CI artifact retention at seven days; avoid storing user comparisons. Reserve four maintenance hours/week initially, mainly archive compatibility and browser regressions.

Use MIT licensing, a single accountable maintainer, semantic versioning, a documented JSON compatibility policy, private vulnerability reporting instructions, and a monthly dependency review. Good first contributions: fixture cases, category improvements, and translations; parser changes require hostile-input tests. Do not accept real private packages in public bug reports.

## Distribution, measurement, and stop rules

First 30 days: README opens with the before/after demo, exact limits, a one-command CLI example, and candid comparisons. Publish a short release-debugging walkthrough and submit once to relevant npm/TypeScript communities where project posts are permitted. Ask maintainers already interested in packaging to try their own tarballs; do not file promotional issues. Suggested topics: `npm`, `developer-tools`, `package-analysis`, `local-first`, `typescript`.

By day 90, prioritize repeated maintainer use and a reusable CI recipe; add another archive ecosystem only with concrete repeat requests. Activation means comparing one's own two tarballs and finding or exporting relevant evidence, not clicking the example. Track opt-in pilot interviews or voluntary local counters: completion time, failed-input rate, actionable findings, and return for a second release within 30 days. No uploaded filenames or package contents are needed.

Hypothetical goals: ten real comparisons and three returning maintainers by day 30; fifteen returning maintainers by day 90. A stretch visibility goal is **100 stars by day 90**, explicitly unforecasted and never a feature gate.

Within 48 hours, show five maintainers a static example and ask them to interpret it. Stop or reposition if fewer than three understand the decision it enables. By day 14, require three real artifact pairs and two maintainers who prefer this workflow to their existing size/diff tools. Otherwise contribute useful pieces upstream instead. Major risks are incumbent overlap, misleading compressed attribution, malformed archives, and infrequent release cadence; the narrow contract and early comparison tests directly address those risks.
