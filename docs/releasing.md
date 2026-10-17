# Releasing Release Lens

Releases run through [release.yml](../.github/workflows/release.yml). Push a stable version tag after its exact commit passes the complete main CI run. GitHub publishes the tested CLI tarball to npm using OIDC, verifies anonymous registry installs, then creates the public GitHub release with reports and checksums.

## Cut a release

1. Update `version` in both `package.json` and `packages/cli/package.json`, add the changelog entry, and commit the reviewed changes to `main`. Keep both versions identical. Only stable `vMAJOR.MINOR.PATCH` tags are accepted.
2. Wait for all 12 jobs in **Verify Release Lens** to pass for that exact commit, including the deployed app. A failed or skipped job blocks publication.
3. Push the matching tag from that commit, for example `git tag v0.1.2` followed by `git push origin v0.1.2`. The tag must point to a commit reachable from `main`.
4. Watch **Publish and verify Release Lens**. Publication is automatic; no npm token or routine browser sign-in is needed.

Running the workflow manually on `main` builds and uploads a candidate. Manual runs categorically skip npm publishing and release creation. This provides a rehearsal without allocating a version on npm.

## Trust and permissions

The npm package is `@kaushikgojo/release-lens`. Its GitHub trusted publisher binds exactly:

| Claim | Value |
| --- | --- |
| Repository | `Lingikaushikreddy/release-lens` |
| Workflow filename | `release.yml` |
| Environment | `npm` |
| Allowed action | Direct `npm publish` |

The `npm` GitHub environment accepts `v*` tags only. The workflow additionally validates the full stable version and manifest agreement. Only the publish job receives `id-token: write`; only the final GitHub release job receives `contents: write`. Candidate and verification jobs receive read access. Checkout credentials are not persisted. Release builds do not restore dependency caches. Actions and the publishing npm CLI are pinned.

For a new or replacement trust configuration, an npm maintainer must authenticate with 2FA. The equivalent npm 12 command is:

```sh
npm trust github @kaushikgojo/release-lens \
  --repo Lingikaushikreddy/release-lens \
  --file release.yml --env npm --allow-publish --yes
```

npm requires the first successful publish within two days of creating the trust configuration. Subsequent publishes use the established repository identity. Never put an npm publish token in GitHub secrets for this workflow. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [npm trust](https://docs.npmjs.com/cli/v12/commands/npm-trust/).

## What the release proves

The candidate job independently rebuilds, tests, checks the Python oracle and observable effects, and installs the packed CLI in a fresh consumer. It retains that exact tarball and its SHA-256. The publishing job downloads that artifact and publishes it without repacking or lifecycle scripts.

After publication, six GitHub-hosted jobs test Node 22 and 24 on Windows, Linux and macOS. Each starts with empty consumer directories, separate empty npx/npm caches, a private global prefix, empty npm configuration and public registry access. They resolve the exact version from npm, compare its bytes with the tested tarball, run both npx and the installed executable, and verify independent byte totals, inclusive budgets, exit codes, malformed inputs, deterministic output and atomic writes. Windows exercises npm's generated command shim.

Metadata and tarball propagation may take time. Verification retries transient network failures and HTTP 404/429/5xx within one ten-minute deadline. Invalid metadata, authorization failures and artifact mismatches fail immediately. The final job separately runs `npm audit signatures --json --include-attestations` from another fresh consumer and checks the verified provenance against the repository, workflow, tag and source commit.

The GitHub release is finalized only after all six cases and provenance pass. It contains CLI, source and web archives, `SHA256SUMS`, `RELEASE_REPORT.md`, `release-verification.json`, and a verification zip with the six raw receipts and verified attestations. Actions artifacts are also retained for 90 days. Historical 0.1.0 reports remain unchanged.

## Failure and recovery

If prepublication checks fail, no package is published. If postpublication checks fail, the npm version is already public and immutable, while the GitHub release remains unfinished. Fix the cause and rerun the failed workflow jobs. An identical existing npm tarball is accepted for verification; different bytes fail. No step automatically unpublishes a package, overwrites a finalized release, or moves an existing tag. A new package change needs a new version and tag.

The registry verifies package origin and distribution integrity. Release Lens's report about an analyzed tarball still does not establish that package's compatibility or safety.
