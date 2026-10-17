# Release Lens browser design

Release Lens is a local package review workbench. The reviewer should understand what changed, what to inspect, and how to reproduce the evidence without reading a chart first.

Palette: canvas `#f3f6fa`, paper `#ffffff`, ink `#172b45`, quiet text `#52657b`, review blue `#285cd6`, warning amber `#995615`. Positive growth uses amber and removal uses blue; signs and words always carry the same information.

Type: the user's system sans for interface text, with a system monospace face reserved for package paths, JSON pointers, hashes, and byte counts. Headings are modest and left aligned. A narrow measure keeps explanatory text readable.

Layout:

```text
Release Lens                                  Local analysis
Review what your package ships.
[Before archive] [After archive] [Growth budget / Compare]
Review summary / exact unpacked and gzip changes / JSON export
Heuristic category contributions
Files: search + sort + changed-only / full-width evidence rows
Manifest changes                          Findings with pointers
```

The summary leads with changed files and actionable missing targets. Category bars explicitly represent additive regular-file bytes, while gzip has its own exact measurement. The file list is the central inspection surface, with quiet table rules and generous path space. Inputs stay visible so the reviewer can replace the after package with a clean follow-up.

Review against the brief: avoided a marketing hero and repeated statistic cards. The distinctive treatment is a single before-to-after comparison rail with aligned byte columns and file-level evidence. Shared surfaces use thin slate rules, six-pixel corners, and no decorative gradients or external assets.

Accessibility and states: native file pickers, associated labels, keyboard focus, live progress, a visible cancel action, explicit validation and malformed-input errors, literal untrusted text, responsive stacking, and reduced-motion support. Replacement cancels the worker and clears prior results immediately. Downloads are the core's canonical JSON.

Development startup preserves the CSP. A Vite serve-only HTML transform creates a fresh random style nonce for each response and exposes it through Vite's supported `meta[property=csp-nonce]`; the development CSS client places that nonce on its injected style elements. Production keeps the unchanged self-only script/style policy and external stylesheet. No `unsafe-inline` is used. Verify the real development server with `pnpm dev --port 4322 --strictPort` and, in a separate terminal, `node tests/e2e/dev-startup.mjs`. The smoke covers applied styling, actual worker analysis, no CSP violations, and fresh nonces on reload in Chromium, Firefox, and WebKit. Red/green evidence is saved under `evidence/dev-startup-{red,green}.txt`.
