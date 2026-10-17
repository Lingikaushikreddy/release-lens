# Release Lens browser design

Release Lens is a local package review workbench with an inviting public entry point. “A closer look. A better release.” introduces the job, while “Explore an example” lets a visitor try real analysis before choosing files. In 0.1.2, a static tarball x-ray gives the opening a distinctive, packaging-specific visual for public demos and portrait screenshots. The evidence stays central: exact byte changes, inspected manifest fields, literal target findings, and reproducible JSON.

The palette uses cool canvas `#f5f8fe`, white paper, navy ink `#162b49`, muted text `#5c6d85`, cobalt `#325bfa`, teal `#0c746c`, and growth amber `#9d5310`. Growth and reduction retain explicit signs, so color is never their only meaning. Informative small text meets a 4.5:1 contrast target on its actual background; disabled controls and decorative marks are distinct cases.

Typography uses locally available “Avenir Next”, Avenir, “Segoe UI”, and sans-serif fallbacks. The large, left-aligned opening has a tight display rhythm; review headings and explanations are quieter. System monospace is reserved for archive names, paths, JSON pointers, hashes, and exact measurements. No fonts are fetched.

```text
Release Lens                          How it works / GitHub
A closer look. A better release.      Tarball x-ray
Explore an example                    Added fixtures / Clean preview
Local privacy note                    Illustrated archive layers
                                      Exact change / Bin target
                                      Review this example
┌ Compare your archives ───────────────────────────────┐
│ Before archive      ⇄      After archive     Budget │
│ file / browse              file / browse    Compare │
└ Local processing assurance ─────────────────────────┘
Example invitation, or:
Overview / Categories / Files / Manifest & targets
Review summary: unpacked change / gzip change / budget
Category contributions: select a row to filter files
Files: change filters / search / sort / hash details
Manifest changes                         Target findings
How it works / CLI and license links
```

The memorable element is an exploded tarball stack. Two amber fixture layers sit above cobalt code and manifest layers; the clean preview replaces the fixture layers with dashed teal outlines and a repair mark. These are illustrated contents, explicitly not a scale chart. A small exact readout supplies the measured values separately. The stepped layers echo a package being opened rather than a generic product dashboard. The comparison surface and evidence panels stay quiet around that one visual focus. All archive marks and illustrations are code-native SVG; there are no decorative gradients, stock imagery, repeated statistic-card grids, or animation.

The x-ray is explicitly labeled “Synthetic example.” Its facts come from the bundled fixture construction: `fixtures/training-a.bin` is 10 MiB and `fixtures/training-b.bin` is 8 MiB. The first comparison adds 18,874,372 unpacked bytes and points the bin field to missing `dist/missing.js`; the clean follow-up removes 18,874,372 bytes and repairs the bin field to existing `dist/cli.js`. The small difference from exactly 18 MiB comes from `package.json`. A clear literal target finding does not imply package compatibility, security, or install correctness.

The preview's two pressed-state buttons only change its own illustrated state. They leave selected files, budgets, and computed reports untouched. “Review this example” loads the corresponding actual archive pair and runs the existing worker analysis; it is disabled while analysis is busy. The original “Explore an example,” “Compare example releases,” and result follow-up remain available. There is no fake live-analysis status or preview result substituted into the canonical report.

Interactions operate on real report data:

- Browse or drop local archives. Swapping reverses Before and After and clears stale output. Replacing either input cancels ongoing work and clears the previous report.
- Choose no growth limit, 1 MiB, or 10 MiB, or enter exact bytes. Any budget change invalidates the report and requires a fresh comparison. Equality passes the inclusive limit.
- Run the example with extra fixtures and a missing bin target, then compare its corrected follow-up.
- Select a category to narrow the table; combine it with a path search and All changes, Added, Removed, Modified, or Unchanged. Change counts cover the complete report; category and search further narrow matching rows. Clear the category or reset all file filters when needed.
- Sort by growth, after size, or path. Expand a path for SHA-256 evidence, reveal more matching rows, or download the core’s unchanged canonical JSON. Filtering changes the view, not the report.

Review jump links keep every evidence section available. The summary distinguishes regular-file payload from gzip size and installed footprint. Categories remain explicitly heuristic; target findings state their literal-existence scope.

Native inputs and buttons keep associated labels, visible focus, pressed states, and keyboard operation. Category buttons preserve their action names and describe their visible path counts and byte deltas to screen readers. The skip link is explicitly focusable, progress is announced, cancellation remains visible during analysis, and validation, malformed-input, empty-filter, and worker errors give a next action. Untrusted archive content is rendered as text. Reduced-motion preferences are respected.

At narrow widths the x-ray moves below the headline, the budget controls move below the archives, review measurements stack, and manifest and findings become one column. The two-state preview stays fully operable by keyboard and uses a polite announcement for its updated evidence. The static treatment respects reduced-motion preferences without needing an alternative animation. At 1080-pixel portrait width the headline and x-ray remain side by side above the comparison surface; at 390 pixels they stack. File tables scroll inside their own container. Examples are bundled local archives. Analysis runs in a worker on the device, package scripts never run, and the interface adds no analytics, remote fonts, or background third-party requests. GitHub and npm links navigate only when selected.

Development startup preserves the CSP. A Vite serve-only HTML transform creates a fresh random style nonce for each response and exposes it through Vite's supported `meta[property=csp-nonce]`; the development CSS client places that nonce on its injected style elements. Production keeps the unchanged self-only script/style policy and external stylesheet. No `unsafe-inline` is used. Verify the real development server with `pnpm dev --port 4322 --strictPort` and, in a separate terminal, `node tests/e2e/dev-startup.mjs`. The smoke covers applied styling, actual worker analysis, no CSP violations, and fresh nonces on reload in Chromium, Firefox, and WebKit. Red/green evidence is saved under `evidence/dev-startup-{red,green}.txt`.
