import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateRelease, validateReceipts, validateCiRun, validateProvenance } from './release-control.mjs';

const input = { ref: 'refs/tags/v0.1.1', event: 'push', rootVersion: '0.1.1', packageVersion: '0.1.1', repository: 'Lingikaushikreddy/release-lens' };
test('only an exact stable version tag can authorize publishing', () => {
  assert.deepEqual(validateRelease(input), { version: '0.1.1', tag: 'v0.1.1', dryRun: false });
  for (const ref of ['refs/heads/main', 'refs/tags/v0.1.0', 'refs/tags/v01.1.1', 'refs/tags/v0.1.1-beta.1', 'refs/tags/v0.1.1;echo']) {
    assert.throws(() => validateRelease({ ...input, ref }));
  }
  assert.throws(() => validateRelease({ ...input, rootVersion: '0.1.0' }));
  assert.throws(() => validateRelease({ ...input, repository: 'someone/release-lens' }));
});
test('manual runs build candidates on main without publishing', () => {
  assert.equal(validateRelease({ ...input, ref: 'refs/heads/main', event: 'workflow_dispatch' }).dryRun, true);
  assert.throws(() => validateRelease({ ...input, ref: 'refs/heads/feature', event: 'workflow_dispatch' }));
});

const historical = JSON.parse(await readFile(new URL('../evidence/npm/cross-platform/registry-node22-windows-latest.json', import.meta.url), 'utf8'));
const candidate = { package: historical.package, version: '0.1.1', sha256: historical.sha256 };
const receipts = ['linux', 'win32', 'darwin'].flatMap(platform => [22, 24].map(node => ({ ...structuredClone(historical), checks: { ...historical.checks, publicInstallPackumentsMatchExactVersion: true }, runner: { os: { linux: 'Linux', win32: 'Windows', darwin: 'macOS' }[platform] }, version: candidate.version, platform, node: `v${node}.0.0`, installedRuntime: `v${node}.0.0` })));
test('completion requires all six independent registry cases for the same bytes', () => {
  assert.equal(validateReceipts(receipts, candidate), true);
  assert.throws(() => validateReceipts(receipts.slice(1), candidate));
  assert.throws(() => validateReceipts([...receipts.slice(1), receipts[1]], candidate));
  for (const change of [{ sha256: '0'.repeat(64) }, { version: '0.1.0' }, { anonymousNpmConfiguration: false }, { checks: { ...historical.checks, npxExceededBudgetExit: 0 } }]) {
    assert.throws(() => validateReceipts([{ ...receipts[0], ...change }, ...receipts.slice(1)], candidate));
  }
});

test('release gate requires all expected jobs from an exact main push', () => {
  const sha = 'a'.repeat(40);
  const run = { event: 'push', head_branch: 'main', head_sha: sha, status: 'completed', conclusion: 'success' };
  const names = ['Independent Python oracle', 'Verify public-site build', 'Deploy public app', 'Package verified release artifacts', ...[22, 24].flatMap(node => [`Browser Node ${node} / Linux`, ...['ubuntu-latest', 'macos-latest', 'windows-latest'].map(os => `CLI Node ${node} / ${os}`)])];
  const jobs = names.map(name => ({ name, conclusion: 'success' }));
  assert.equal(validateCiRun(run, jobs, sha), true);
  assert.throws(() => validateCiRun({ ...run, event: 'pull_request' }, jobs, sha));
  assert.throws(() => validateCiRun({ ...run, head_sha: 'b'.repeat(40) }, jobs, sha));
  assert.throws(() => validateCiRun(run, jobs.slice(1), sha));
  assert.throws(() => validateCiRun(run, [{ ...jobs[0], conclusion: 'skipped' }, ...jobs.slice(1)], sha));
});

test('verified provenance must bind the package to this tag, workflow and commit', () => {
  const c = { ...candidate, tag: 'v0.1.1', sourceCommit: 'a'.repeat(40) };
  const statement = { predicate: { buildDefinition: { externalParameters: { workflow: { repository: 'https://github.com/Lingikaushikreddy/release-lens', path: '.github/workflows/release.yml', ref: 'refs/tags/v0.1.1' } }, resolvedDependencies: [{ digest: { gitCommit: c.sourceCommit } }] } } };
  const audit = { invalid: [], missing: [], verified: [{ name: c.package, version: c.version, attestationBundles: [{ predicateType: 'https://slsa.dev/provenance/v1', bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString('base64') } } }] }] };
  assert.equal(validateProvenance(audit, c), true);
  assert.throws(() => validateProvenance({ ...audit, missing: [{}] }, c));
  assert.throws(() => validateProvenance({ ...audit, verified: [] }, c));
  assert.throws(() => validateProvenance(audit, { ...c, sourceCommit: 'b'.repeat(40) }));
});
