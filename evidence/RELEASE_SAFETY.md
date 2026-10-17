# Release failure, rerun and interface verification

Verified October 16, 2026 (PDT). Release Lens 0.1.1 was exercised through the real release workflow without publishing it again. A separate read-only GitHub Actions rehearsal deliberately failed an integrity check, then recovered using **Re-run failed jobs**. The new command-level safety checks and interactive browser interface were also tested locally.

## Existing version: real full-workflow rerun

[Release workflow 38990498134, attempt 2](https://github.com/Lingikaushikreddy/release-lens/actions/runs/38990498134/attempts/2) reran the original `v0.1.1` source commit `43a54b2564634fa51ed9ce5abf3c3ef26619f683`. All nine jobs passed, including the six fresh npx/npm cases across Windows, Linux and macOS on Node 22/24, and the independent signature/provenance gate. It completed at 6:35 p.m. PDT.

The existing-version check found identical npm bytes. **Publish with OIDC and provenance, without an npm token** was skipped. The canonical archive remained 36,801 bytes with SHA-256:

```text
1caf85d79f2c3f6528e5563a962d0fac30686b7ec7ad3001f19283704f63f5e8
```

The before/after GitHub release snapshots preserve the same release ID, body, publication/update times, and all eight asset IDs, names, sizes, digests and creation/update times. Download counters naturally changed. The rerun confirmed the existing finalized release instead of replacing its evidence.

Proof: [workflow jobs and step conclusions](release-safety/full-rerun-attempt2.json), [release before](release-safety/release-before.json), [release after](release-safety/release-after.json), [asserted summary](release-safety/summary.json), [skip/finalization log excerpts](release-safety/full-rerun-excerpts.log), and [six registry receipts](release-safety/registry-attempt2).

## Actual failed-job recovery

[Recovery workflow 38991624156](https://github.com/Lingikaushikreddy/release-lens/actions/runs/38991624156) ran from commit `8d8f542837a8ddd3097dd201aa536f21fcd4ca6a`. This manually dispatched workflow has `contents: read`, no npm environment, no OIDC write permission, and no publication or release-edit step.

| Attempt | Deliberate condition | Observed result |
| --- | --- | --- |
| [1](https://github.com/Lingikaushikreddy/release-lens/actions/runs/38991624156/attempts/1) | One bit flipped only in the local expected archive | The real public-registry verifier exited 1 at the archive-byte equality check, before npm/npx installation. |
| [2](https://github.com/Lingikaushikreddy/release-lens/actions/runs/38991624156/attempts/2) | `gh run rerun --failed`; original reviewed archive restored | The failed verification job passed; the successful archive-preservation job was reused. |

The recovered job downloaded artifact `12085556667` from the first attempt. It then verified the unchanged npm package using fresh anonymous npx and npm installations on Ubuntu 24, Node 24.21.0, npm/npx 11.19.0. Independent growth/cleanup totals, inclusive budgets, expected exits, malformed input handling and atomic output all passed. Recovery completed at 6:38 p.m. PDT.

Proof: [failed attempt](release-safety/recovery-attempt1.json), [integrity failure log](release-safety/recovery-attempt1.log), [successful rerun](release-safety/recovery-attempt2.json), [fresh registry receipt](release-safety/registry-recovery.json).

## Isolated failure injection and fixes

The release/retry suite passed **60/60** on local Node 22.23.3 and 24.22.0. Its 35 new integration tests execute the actual release scripts in disposable checkouts: 40 subprocess scenarios, comprising 33 expected rejection exits and seven successful or resumed exits.

| Guard or recovery path | Result |
| --- | --- |
| Existing identical npm version, including a repeated check | `exists=true`; publication is not authorized. |
| Different published bytes; registry service/archive errors; wrong package or archive origin | Nonzero exit; no first-publication output. |
| Corrupt candidate; wrong package/version/tag/archive/source; dry run or non-push event | Rejected before external access. |
| Missing/duplicate OS/Node receipts; wrong hash, npx budget exit or anonymous configuration | Finalization blocked. |
| Wrong provenance workflow, repository, tag or source commit; moved remote tag | Finalization blocked. |
| Missing sixth receipt subsequently restored | Rerun completes verification. |
| Existing finalized release, including a second rerun | No GitHub create, upload, edit or delete command. |
| Interrupted draft with matching package/source archives | Missing uploads resume; only mutable draft reports/checksums may be refreshed. A conflicting package archive fails. |

Tests first reproduced command-level gaps around direct publisher calls. A shared candidate loader now checks the canonical repository, tag-push event, stable version/tag/archive/source identity, dry-run flag, archive size and checksum before either publishing entry point proceeds. Existing workflow-level permission and event restrictions remain in place.

These tests replace HTTP and git/gh boundaries with controlled test-only adapters; unexpected calls fail. They supply no publishing credentials and make no external network requests. Synthetic provenance exercises source-identity rejection; the live release rerun separately verifies real signatures and attestations. Raw records include source-file hashes: [Node 22](release-safety/local-injected-node22.json), [Node 24](release-safety/local-injected-node24.json).

## Public interface changes and limits

The browser now has a clearer archive workspace, a prominent working example, archive swapping, exact-byte budget presets, clickable category filters, composable change/search filters, sorting controls, section navigation and responsive file evidence. Changing inputs clears stale results. JSON downloads retain the complete canonical report when the visible table is filtered.

Local verification passed **89 core tests** and **33 browser cases** across Chromium, Firefox and WebKit, including archive reversal, budget presets, filter composition, keyboard operation and narrow layouts. These interface changes and the new guard code are subsequent source changes; the original `v0.1.1` tag, npm archive and release assets remain untouched. The subsequent app deployment is gated by the full [Verify Release Lens workflow](https://github.com/Lingikaushikreddy/release-lens/actions/workflows/ci.yml): six OS/Node CLI cases, browser engines, the independent Python oracle, a public-path build and deployment, then verified artifact packaging. Final deployment receipts are distributed separately from this source snapshot.

For repeatable commands and recovery decisions, see the [release runbook](../docs/releasing.md#failure-and-recovery).
