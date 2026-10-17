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

If prepublication checks fail, no package is published. If postpublication checks fail, the npm version is already public and immutable, while the GitHub release remains unfinished. Inspect the failed job and its evidence before choosing a rerun:

| Failure | Recovery |
| --- | --- |
| Transient registry/network failure after a successful publish | Rerun failed jobs against the original tag and candidate. The verifier allows bounded propagation retries. |
| Incomplete verification receipts or interrupted draft uploads | Restore the missing verification result and rerun. A draft can resume missing uploads; an already matching package archive is retained. |
| Existing npm version with identical reviewed bytes | The publication step is skipped; fresh registry checks and provenance verification continue. |
| Existing npm version with different bytes, corrupt candidate, wrong source/provenance, or moved tag | Stop and inspect the cause. The gates fail rather than republish, unpublish, move the tag or replace a finalized release. A changed package needs a new version/tag. |

To resume only failed jobs, use GitHub's **Re-run failed jobs** action or:

```sh
gh run rerun RUN_ID --failed --repo Lingikaushikreddy/release-lens
```

GitHub reruns retain the original commit and ref; updating `main` does not change an older run. A source fix belongs in a newly reviewed commit and version/tag. See [GitHub’s rerun behavior](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs).

A full rerun also checks for the existing npm version before publishing. A finalized GitHub release is verified without uploading or editing its files. Draft reruns may refresh verification reports and checksums, but conflicting package/source/web archives fail. Both publication entry points independently reject a dry-run candidate, a non-push event, inconsistent candidate identity, or an archive whose bytes no longer match the reviewed checksum and size.

### Rehearse a failure without publishing

The separate [release-safety.yml](../.github/workflows/release-safety.yml) downloads and pins the already public 0.1.1 archive. Its first attempt flips one bit only in the local expected copy, causing the real anonymous registry verifier to reject the mismatch before installation. Rerunning failed jobs restores the preserved original artifact and runs the full clean-install verifier. It has read-only repository permission, no OIDC publishing permission, and no release-write step.

```sh
gh workflow run release-safety.yml --ref main \
  --field inject_failure=true --repo Lingikaushikreddy/release-lens
gh run list --workflow release-safety.yml --limit 1 \
  --repo Lingikaushikreddy/release-lens
# After the expected first-attempt integrity failure:
gh run rerun RUN_ID --failed --repo Lingikaushikreddy/release-lens
```

Run `pnpm test:release` for isolated candidate, registry, receipt, provenance and draft/final-release failure cases. These tests execute real script entry points with test-only external-boundary adapters; they do not contact npm or mutate GitHub. Optional raw scenario receipts can be saved with `RELEASE_LENS_SAFETY_REPORT=work/release-safety.json pnpm test:release`.

The [October 16, 2026 verification report](../evidence/RELEASE_SAFETY.md) records a successful real full release rerun with npm publication skipped, an actual failed-job recovery, unchanged original release assets, and the separate injected failure suite.

The registry verifies package origin and distribution integrity. Release Lens's report about an analyzed tarball still does not establish that package's compatibility or safety.
