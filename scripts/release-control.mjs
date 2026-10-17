import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = 'Lingikaushikreddy/release-lens';
const packageName = '@kaushikgojo/release-lens';
const registry = 'https://registry.npmjs.org';
const root = fileURLToPath(new URL('..', import.meta.url));
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const save = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value, null, 2) + '\n'); };
const output = async (key, value) => { if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function validateRelease({ ref, event, rootVersion, packageVersion, repository: actualRepository }) {
  assert.equal(actualRepository, repository, 'Publishing is restricted to the canonical repository');
  assert.match(packageVersion, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u, 'Stable semantic version required');
  assert.equal(rootVersion, packageVersion, 'Root and CLI versions must agree');
  if (event === 'workflow_dispatch') {
    assert.equal(ref, 'refs/heads/main', 'Candidate dry runs are restricted to main');
    return { version: packageVersion, tag: `v${packageVersion}`, dryRun: true };
  }
  assert.equal(event, 'push');
  assert.equal(ref, `refs/tags/v${packageVersion}`, 'Tag must exactly match both package versions');
  return { version: packageVersion, tag: `v${packageVersion}`, dryRun: false };
}

export function validateCiRun(run, jobs, commit) {
  for (const [key, expected] of Object.entries({ event: 'push', head_branch: 'main', head_sha: commit, status: 'completed', conclusion: 'success' })) assert.equal(run[key], expected, `CI ${key}`);
  const expected = ['Independent Python oracle', 'Verify public-site build', 'Deploy public app', 'Package verified release artifacts', ...[22, 24].flatMap(node => [`Browser Node ${node} / Linux`, ...['ubuntu-latest', 'macos-latest', 'windows-latest'].map(os => `CLI Node ${node} / ${os}`)])];
  assert.deepEqual(jobs.map(job => job.name).sort(), expected.sort(), 'The full 12-job main CI matrix is required');
  for (const job of jobs) assert.equal(job.conclusion, 'success', `${job.name} must succeed`);
  return true;
}

export function validateReceipts(receipts, candidate) {
  assert.equal(receipts.length, 6, 'Six registry receipts required');
  const cells = new Set();
  for (const r of receipts) {
    assert.equal(r.package, candidate.package); assert.equal(r.version, candidate.version);
    assert.equal(r.sha256, candidate.sha256); assert.equal(r.expectedArtifactSha256, candidate.sha256);
    assert.equal(r.expectedArtifactMatched, true); assert.equal(r.registry, registry);
    assert.equal(r.node, r.installedRuntime);
    assert.match(r.node, /^v(22|24)\./u); assert(['linux', 'win32', 'darwin'].includes(r.platform));
    assert.equal(r.runner?.os, { linux: 'Linux', win32: 'Windows', darwin: 'macOS' }[r.platform]);
    cells.add(`${r.platform}-${r.node.split('.')[0]}`);
    for (const key of ['freshEmptyWorkingDirectories', 'independentFreshCaches', 'freshPrivateGlobalPrefix', 'anonymousNpmConfiguration', 'installedWithScriptsDisabled']) assert.equal(r[key], true, key);
    assert.equal(r.runtimeDependencies, 0);
    for (const key of ['publicMetadataAndTarballIntegrity', 'publicInstallPackumentsMatchExactVersion', 'reviewedCIArtifactMatchesRegistryBytes', 'npxCacheInstallationMatchesRegistry', 'globalFallbackExcluded', 'lockfileMatchesRegistry', 'npxExecutableInferenceAndHelp', 'installedExecutableHelp', 'npxAndInstalledReportsMatch', 'npxAtomicOutputAndFailurePreservation', 'deterministicJSON', 'findingsRetainSideAndPointer', 'atomicOutputReplaced', 'validationFailurePreservesOutput', 'temporaryFilesCleaned', 'inputsUnchanged']) assert.equal(r.checks[key], true, key);
    for (const [key, expected] of Object.entries({ npxInclusiveBudgetPassExit: 0, npxExceededBudgetExit: 1, npxMalformedArchiveExit: 2, independentGrowthBytes: 18874372, independentCleanupBytes: -18874372, inclusiveBudgetPassExit: 0, exceededBudgetExit: 1, malformedArchiveExit: 2, failedRenameExit: 3 })) assert.equal(r.checks[key], expected, key);
  }
  assert.equal(cells.size, 6, 'All six distinct OS/Node combinations required');
  return true;
}

// npm audit signatures verifies the Sigstore bundle and its package/integrity
// subject first. This gate additionally checks this release's source identity.
export function validateProvenance(audit, candidate) {
  assert.deepEqual(audit.invalid, []); assert.deepEqual(audit.missing, []);
  const verified = audit.verified.filter(item => item.name === candidate.package && item.version === candidate.version);
  assert.equal(verified.length, 1, 'Verified package attestation required');
  const bundles = verified[0].attestationBundles.filter(item => item.predicateType === 'https://slsa.dev/provenance/v1');
  assert.equal(bundles.length, 1, 'One verified SLSA provenance statement required');
  const statement = JSON.parse(Buffer.from(bundles[0].bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
  const definition = statement.predicate.buildDefinition;
  assert.deepEqual(definition.externalParameters.workflow, { ref: `refs/tags/${candidate.tag}`, repository: `https://github.com/${repository}`, path: '.github/workflows/release.yml' });
  assert(definition.resolvedDependencies.some(item => item.digest?.gitCommit === candidate.sourceCommit), 'Attested source commit must match candidate');
  return true;
}

async function api(path) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GH_TOKEN}` }, signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, `GitHub API ${path}: ${response.status}`); return response.json();
}

async function preflight() {
  const cli = await json(join(root, 'packages/cli/package.json'));
  const workspace = await json(join(root, 'package.json'));
  assert.equal(cli.name, packageName);
  const release = validateRelease({ ref: process.env.GITHUB_REF, event: process.env.GITHUB_EVENT_NAME, repository: process.env.GITHUB_REPOSITORY, rootVersion: workspace.version, packageVersion: cli.version });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(commit, process.env.GITHUB_SHA);
  execFileSync('git', ['merge-base', '--is-ancestor', commit, 'origin/main'], { cwd: root });
  const deadline = Date.now() + 20 * 60_000;
  let run;
  while (Date.now() < deadline) {
    const runs = await api(`actions/workflows/ci.yml/runs?head_sha=${commit}&branch=main&event=push&per_page=100`);
    run = runs.workflow_runs.find(item => item.head_sha === commit && item.event === 'push' && item.head_branch === 'main');
    if (run?.status === 'completed') break;
    console.log('Waiting for the exact commit’s main CI run...'); await sleep(15_000);
  }
  assert(run, 'No exact-commit main CI run found');
  const jobs = await api(`actions/runs/${run.id}/jobs?per_page=100`);
  validateCiRun(run, jobs.jobs, commit);
  await save(join(root, 'work/release-gate.json'), { ...release, package: cli.name, sourceCommit: commit, ciRun: run.html_url, ciRunId: run.id });
  for (const [key, value] of Object.entries(release)) await output(key, value);
  console.log(`Release gate passed: ${release.tag}, commit ${commit}, all 12 CI jobs successful; dry run=${release.dryRun}`);
}

async function candidate() {
  const gate = await json(join(root, 'work/release-gate.json'));
  const directory = join(root, 'work/candidate');
  const artifact = `releaselens-${gate.version}.tgz`;
  const bytes = await readFile(join(directory, artifact));
  const receipt = await json(join(root, 'evidence/pack.json'));
  assert.equal(receipt.package, `${gate.package}@${gate.version}`); assert.equal(receipt.sha256, sha256(bytes));
  assert.equal(receipt.installedBinaryHelp, true); assert.equal(receipt.budgetBoundaryPassed, true);
  await save(join(directory, 'release-control.json'), { ...gate, artifact, sha256: sha256(bytes), bytes: bytes.length, workflowRun: `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}` });
}

async function loadCandidate() {
  const c = await json(join(root, 'work/candidate/release-control.json'));
  assert.equal(c.package, packageName); assert.match(c.artifact, /^releaselens-\d+\.\d+\.\d+\.tgz$/u);
  assert.equal(c.sourceCommit, process.env.GITHUB_SHA); assert.equal(`refs/tags/${c.tag}`, process.env.GITHUB_REF);
  const bytes = await readFile(join(root, 'work/candidate', c.artifact));
  assert.equal(sha256(bytes), c.sha256); assert.equal(bytes.length, c.bytes);
  assert.equal(c.dryRun, false);
  return c;
}

async function publication() {
  const c = await loadCandidate();
  const response = await fetch(`${registry}/${encodeURIComponent(c.package)}/${c.version}`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) { await output('exists', false); console.log('Version is available for first publication'); return; }
  assert.equal(response.status, 200, 'Registry preflight must succeed or report an unpublished version');
  const metadata = await response.json(); assert.equal(metadata.name, c.package); assert.equal(metadata.version, c.version);
  const url = new URL(metadata.dist.tarball); assert.equal(url.origin, registry);
  const archive = await fetch(url, { signal: AbortSignal.timeout(60_000) }); assert.equal(archive.status, 200);
  assert.equal(sha256(Buffer.from(await archive.arrayBuffer())), c.sha256, 'Existing version differs: never overwrite or automatically unpublish');
  await output('exists', true); console.log('Existing version has identical bytes; resuming verification without republishing');
}

async function provenance() {
  const c = await loadCandidate();
  const temporary = await mkdtemp(join(await realpath(tmpdir()), 'release-lens-provenance-'));
  try {
    await writeFile(join(temporary, 'package.json'), '{"name":"release-provenance-consumer","version":"1.0.0","private":true}\n');
    for (const file of ['user.npmrc', 'global.npmrc']) await writeFile(join(temporary, file), '');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/iu.test(key) && !['NPM_TOKEN', 'NODE_AUTH_TOKEN'].includes(key)));
    Object.assign(env, { npm_config_registry: registry, npm_config_cache: join(temporary, 'cache'), npm_config_userconfig: join(temporary, 'user.npmrc'), npm_config_globalconfig: join(temporary, 'global.npmrc'), npm_config_prefix: join(temporary, 'prefix') });
    const npm = args => execFileSync('npm', args, { cwd: temporary, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
    npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', `${c.package}@${c.version}`]);
    const audit = JSON.parse(npm(['audit', 'signatures', '--json', '--include-attestations']));
    validateProvenance(audit, c);
    await save(join(root, 'work/candidate/provenance.json'), audit);
    console.log('Registry signatures and Sigstore provenance verified; source, tag and workflow match');
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

async function finalize() {
  const c = await loadCandidate();
  const directory = join(root, 'work/candidate');
  const receipts = await Promise.all((await readdir(join(directory, 'registry'))).filter(name => /^registry-node(22|24)-(ubuntu|windows|macos)-latest\.json$/u.test(name)).map(name => json(join(directory, 'registry', name))));
  validateReceipts(receipts, c); validateProvenance(await json(join(directory, 'provenance.json')), c);
  const remoteCommit = execFileSync('git', ['ls-remote', 'origin', `refs/tags/${c.tag}`, `refs/tags/${c.tag}^{}`], { cwd: root, encoding: 'utf8' }).trim().split('\n').at(-1).split(/\s/u)[0];
  assert.equal(remoteCommit, c.sourceCommit, 'Remote tag moved since the build');
  const report = { ...c, completedAt: new Date().toISOString(), registryVerification: receipts, provenance: 'npm audit signatures --json --include-attestations: verified; exact source/workflow/tag matched' };
  await save(join(directory, 'release-verification.json'), report);
  const table = receipts.sort((a,b) => `${a.platform}${a.node}`.localeCompare(`${b.platform}${b.node}`)).map(r => `| ${r.runner.os} | ${r.node} | ${r.npm} | Passed |`).join('\n');
  const text = `# Release Lens ${c.version}\n\nAutomated npm trusted publication from commit \`${c.sourceCommit}\`.\n\n\`\`\`sh\nnpx --yes ${c.package}@${c.version} diff before.tgz after.tgz --format json\n\`\`\`\n\n[Full 12-job CI](${c.ciRun}) · [Release workflow](${c.workflowRun}) · [Public app](https://lingikaushikreddy.github.io/release-lens/)\n\n| Hosted OS | Node | npm/npx | Fresh registry npx + install |\n| --- | --- | --- | --- |\n${table}\n\nAll six cases matched the tested tarball, used empty caches and anonymous npm configuration, and verified independent byte totals, budgets, exit codes, malformed inputs and atomic output. Registry signatures and Sigstore provenance were independently verified with npm audit signatures; the attestation matches this commit, tag and release.yml workflow.\n\nPackage archive SHA-256: \`${c.sha256}\`. Raw receipts and the verified provenance bundle are attached in the verification archive. [Changelog](https://github.com/${repository}/blob/${c.tag}/CHANGELOG.md).\n`;
  await writeFile(join(directory, 'RELEASE_REPORT.md'), text);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const commands = { preflight, candidate, publication, provenance, finalize };
  assert(Object.hasOwn(commands, process.argv[2]), 'Expected preflight, candidate, publication, provenance or finalize');
  await commands[process.argv[2]]();
}
