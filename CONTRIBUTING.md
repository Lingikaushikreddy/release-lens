# Contributing

Use Node 22/24 and pnpm 11.25.0. Install with `pnpm install --frozen-lockfile`; run the commands in README Verification before submitting a change. Python 3 is required for fixtures and the independent oracle. Browser engines install via Playwright.

Core lives in packages/core; apps/web delegates to a disposable worker; packages/cli bundles the same core. Keep parser details isolated and the version-1 JSON stable throughout 0.1.x. Add regression fixtures for parser changes, preserve deterministic output, and never weaken input checks for convenience. Good first contributions include public fixtures, classification corrections and accessibility improvements.

No package contents or identifying private filenames belong in public reports. Use synthetic fixtures. Explain behavior and test evidence in a contribution. Publication/tagging and dependency updates remain maintainer actions.
