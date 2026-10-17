# Public release verification

Repository: https://github.com/Lingikaushikreddy/release-lens

App: https://lingikaushikreddy.github.io/release-lens/

Release: https://github.com/Lingikaushikreddy/release-lens/releases/tag/v0.1.0

The release is created only after the exact source commit passes the hosted workflow at https://github.com/Lingikaushikreddy/release-lens/actions/workflows/ci.yml. The GitHub run/check records are the authoritative executed results; a configured matrix is not itself a passing run.

Required verification: Node22/24 on Ubuntu, macOS and Windows (six unit/typecheck/installed-package jobs); Node22/24 Linux browser jobs across Chromium/Firefox/WebKit; independent Python inventory/effect checks; the deployed project-subpath build tested again in all three engines. Public deployment depends on these jobs. Release archives are assembled afterward, preserving the exact CLI archive that passed clean-consumer tests. SHA256SUMS and release.json identify downloadable assets and source commit.

The browser distribution ships LICENSE and THIRD_PARTY_NOTICES.md. Source evidence has local machine paths replaced by <workspace>; no credentials or private package data are included.

The earlier macOS-only candidate report in RELEASE.md is historical. It does not replace hosted results. Maintainer usability/return-rate pilots remain unperformed; npm registry publication and a custom domain are outside this GitHub release.
