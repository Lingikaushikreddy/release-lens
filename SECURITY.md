# Security policy

Release Lens treats archive bytes, filenames, package manifests and script text as untrusted data. It never extracts analyzed archives, installs analyzed packages, executes their code, or sends their contents to a server. It is not a malware scanner or compatibility verifier.

Report suspected vulnerabilities privately to the repository maintainer using [GitHub private vulnerability reporting](https://github.com/Lingikaushikreddy/release-lens/security/advisories/new). If that channel is unavailable, request a private contact without including exploit/private package data publicly. Do not treat a public issue as a private channel.

Share synthetic or public reproductions only. Parser changes need hostile byte fixtures. Maintain dependency review monthly and investigate supported-browser/native decompression changes. Input limits reduce resource exposure but do not certify parser security. The accepted subset and remaining limitations are in docs/measurement-contract.md and evidence/RELEASE.md.
