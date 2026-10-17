import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { after, test } from 'node:test';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Real release entry points run in a separate, disposable checkout. Only the
// external HTTP and git/gh boundaries are replaced; an unexpected call fails.
// Nothing here changes production endpoints or supplies publishing credentials.
const records = [];
const sourceFiles = Object.fromEntries(await Promise.all(['release-control.mjs', 'publish-github-release.mjs', 'release-safety.test.mjs'].map(async name => [name, createHash('sha256').update(await readFile(new URL(name, import.meta.url))).digest('hex')])));
const commit = 'a'.repeat(40);
const repository = 'Lingikaushikreddy/release-lens';
const packageName = '@kaushikgojo/release-lens';
const registry = 'https://registry.npmjs.org';
const metadataUrl = `${registry}/${encodeURIComponent(packageName)}/0.1.1`;
const archiveUrl = `${registry}/@kaushikgojo/release-lens/-/release-lens-0.1.1.tgz`;
const githubUrl = `https://api.github.com/repos/${repository}/releases/tags/v0.1.1`;
const reportUrl = `https://github.com/${repository}/releases/download/v0.1.1/release-verification.json`;
const bytes = Buffer.from('controlled package archive bytes\n');
const hash = createHash('sha256').update(bytes).digest('hex');
const candidate = { package: packageName, version: '0.1.1', tag: 'v0.1.1', sourceCommit: commit, artifact: 'releaselens-0.1.1.tgz', sha256: hash, bytes: bytes.length, dryRun: false, ciRun: 'https://github.com/example/ci', workflowRun: 'https://github.com/example/release' };
const allAssets = ['releaselens-0.1.1.tgz', 'release-lens-0.1.1-source.tar.gz', 'release-lens-0.1.1-web.zip', 'release-lens-0.1.1-verification.zip', 'release.json', 'release-verification.json', 'RELEASE_REPORT.md', 'SHA256SUMS'];
const historical = JSON.parse(await readFile(new URL('../evidence/npm/cross-platform/registry-node22-windows-latest.json', import.meta.url), 'utf8'));
const receipts = ['linux', 'win32', 'darwin'].flatMap(platform => [22, 24].map(node => ({ ...structuredClone(historical), package: packageName, version: '0.1.1', sha256: hash, expectedArtifactSha256: hash, checks: { ...historical.checks, publicInstallPackumentsMatchExactVersion: true }, runner: { os: { linux: 'Linux', win32: 'Windows', darwin: 'macOS' }[platform] }, platform, node: `v${node}.0.0`, installedRuntime: `v${node}.0.0` })));
const statement = { predicate: { buildDefinition: { externalParameters: { workflow: { repository: `https://github.com/${repository}`, path: '.github/workflows/release.yml', ref: 'refs/tags/v0.1.1' } }, resolvedDependencies: [{ digest: { gitCommit: commit } }] } } };
const auditFor = value => ({ invalid: [], missing: [], verified: [{ name: packageName, version: '0.1.1', attestationBundles: [{ predicateType: 'https://slsa.dev/provenance/v1', bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(value)).toString('base64') } } }] }] });

async function sandbox({ candidateChange = {}, responses = {}, remoteCommit = commit, registryReceipts = receipts, audit = auditFor(statement), githubRelease, previousReport = candidate, workflowEvent = 'push' } = {}) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'release-lens-safety-'));
  const directory = join(root, 'work/candidate');
  await mkdir(join(root, 'scripts'), { recursive: true });
  await mkdir(join(directory, 'registry'), { recursive: true });
  await mkdir(join(directory, 'evidence'), { recursive: true });
  for (const script of ['release-control.mjs', 'publish-github-release.mjs']) await copyFile(new URL(script, import.meta.url), join(root, 'scripts', script));
  const c = { ...candidate, ...candidateChange };
  for (const name of ['release-control.json', 'release-verification.json', 'release.json']) await writeFile(join(directory, name), JSON.stringify(c));
  for (const name of [candidate.artifact, 'release-lens-0.1.1-source.tar.gz', 'release-lens-0.1.1-web.zip']) await writeFile(join(directory, name), bytes);
  await writeFile(join(directory, 'RELEASE_REPORT.md'), 'Controlled release report\n');
  await writeFile(join(directory, 'evidence/pack.json'), JSON.stringify({ simulated: true }));
  await writeFile(join(directory, 'provenance.json'), JSON.stringify(audit));
  for (let i = 0; i < registryReceipts.length; i++) {
    const r = registryReceipts[i];
    const names = ['registry-node22-ubuntu-latest.json', 'registry-node24-ubuntu-latest.json', 'registry-node22-windows-latest.json', 'registry-node24-windows-latest.json', 'registry-node22-macos-latest.json', 'registry-node24-macos-latest.json'];
    await writeFile(join(directory, 'registry', names[i]), JSON.stringify(r));
  }
  const routeMap = {
    [metadataUrl]: { status: 200, json: { name: packageName, version: '0.1.1', dist: { tarball: archiveUrl } } },
    [archiveUrl]: { status: 200, base64: bytes.toString('base64') },
    [githubUrl]: { status: 404, json: { message: 'Not Found' } },
    [reportUrl]: { status: 200, json: previousReport },
    ...responses,
  };
  if (githubRelease) routeMap[githubUrl] = { status: 200, json: githubRelease };
  await writeFile(join(root, 'boundaries.json'), JSON.stringify({ routes: routeMap, remoteCommit, tag: candidate.tag }));
  await writeFile(join(root, 'hook.mjs'), `
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
const config = JSON.parse(readFileSync(new URL('./boundaries.json', import.meta.url), 'utf8'));
const log = value => appendFileSync(new URL('./calls.jsonl', import.meta.url), JSON.stringify(value) + '\\n');
globalThis.fetch = async input => {
  const url = String(input); log({ kind: 'http', url });
  assert(Object.hasOwn(config.routes, url), 'Unlisted HTTP request is prohibited: ' + url);
  const response = config.routes[url];
  return new Response(response.base64 ? Buffer.from(response.base64, 'base64') : JSON.stringify(response.json), { status: response.status, headers: { 'Content-Type': response.base64 ? 'application/octet-stream' : 'application/json' } });
};
const original = cp.execFileSync;
cp.execFileSync = (file, args, options) => {
  if (file === 'git') {
    log({ kind: 'git', args });
    assert.deepEqual(args, ['ls-remote', 'origin', 'refs/tags/' + config.tag, 'refs/tags/' + config.tag + '^{}']);
    return config.remoteCommit + '\\trefs/tags/' + config.tag + '\\n';
  }
  if (file === 'gh') { log({ kind: 'gh', args }); return ''; }
  assert.equal(file, 'python3', 'Only the real archive builder may run');
  return original(file, args, options);
};
syncBuiltinESMExports();
`);
  const run = async (script, command, title) => {
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(join(root, 'hook.mjs')).href, join(root, 'scripts', script), ...(command ? [command] : [])], { cwd: root, env: { PATH: process.env.PATH, GITHUB_SHA: commit, GITHUB_REF: 'refs/tags/v0.1.1', GITHUB_REPOSITORY: repository, GITHUB_EVENT_NAME: workflowEvent, GITHUB_OUTPUT: join(root, 'github-output') }, encoding: 'utf8', timeout: 20_000 });
    assert.equal(result.error, undefined);
    const calls = await readFile(join(root, 'calls.jsonl'), 'utf8').catch(() => '');
    const parsed = calls.trim() ? calls.trim().split('\n').map(line => JSON.parse(line)) : [];
    const output = await readFile(join(root, 'github-output'), 'utf8').catch(() => '');
    const generated = await readFile(join(directory, 'release-verification.json'), 'utf8');
    records.push({ scenario: title, simulatedExternalBoundaries: true, exitCode: result.status, githubOutput: output.trim(), requests: parsed.filter(v => v.kind === 'http').map(v => v.url), mutationCommands: parsed.filter(v => v.kind === 'gh').map(v => v.args), stderr: result.stderr.slice(0, 1500), stdout: result.stdout.trim() });
    return { ...result, calls: parsed, output, generated: JSON.parse(generated) };
  };
  return { directory, run, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function withSandbox(options, task) {
  const box = await sandbox(options);
  try { await task(box); } finally { await box.cleanup(); }
}

after(async () => {
  if (process.env.RELEASE_LENS_SAFETY_REPORT) {
    await mkdir(dirname(process.env.RELEASE_LENS_SAFETY_REPORT), { recursive: true });
    await writeFile(process.env.RELEASE_LENS_SAFETY_REPORT, JSON.stringify({ kind: 'isolated-release-entry-point-fault-injection', createdAt: new Date().toISOString(), node: process.version, platform: process.platform, noPublishingCredentials: true, noExternalNetwork: true, sourceFiles, scenarios: records }, null, 2) + '\n');
  }
});

test('GitHub publishing entry point rejects a manual dry-run candidate before any external mutation', async () => {
  await withSandbox({ candidateChange: { dryRun: true } }, async box => {
    const result = await box.run('publish-github-release.mjs', undefined, 'GitHub publisher rejects dry-run candidate');
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /dry run|dryRun/u);
    assert.deepEqual(result.calls.filter(v => v.kind === 'gh'), []);
  });
});

test('publication rejects an internally inconsistent candidate identity before registry access', async () => {
  await withSandbox({ candidateChange: { version: '0.1.2' } }, async box => {
    const result = await box.run('release-control.mjs', 'publication', 'Publication rejects version/tag mismatch');
    assert.equal(result.status, 1);
    assert.deepEqual(result.calls, []);
  });
});

test('GitHub publishing entry point rejects corrupt candidate bytes before external access', async () => {
  await withSandbox({}, async box => {
    await writeFile(join(box.directory, candidate.artifact), 'corrupt archive');
    const result = await box.run('publish-github-release.mjs', undefined, 'GitHub publisher rejects corrupt candidate');
    assert.equal(result.status, 1);
    assert.deepEqual(result.calls, []);
  });
});

test('existing identical npm version resumes verification without authorizing publication, including reruns', async () => {
  await withSandbox({}, async box => {
    for (const attempt of [1, 2]) {
      const result = await box.run('release-control.mjs', 'publication', `Identical npm version / attempt ${attempt}`);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.output.trim().split('\n'), Array(attempt).fill('exists=true'));
      assert.match(result.stdout, /without republishing/u);
      assert.equal(result.calls.filter(v => v.kind === 'gh').length, 0);
    }
  });
});

test('unpublished npm version is the only registry state authorizing first publication', async () => {
  await withSandbox({ responses: { [metadataUrl]: { status: 404, json: { error: 'Not Found' } } } }, async box => {
    const result = await box.run('release-control.mjs', 'publication', 'Unpublished npm version returns first-publication flag');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, 'exists=false\n');
    assert.deepEqual(result.calls.map(v => v.url), [metadataUrl]);
  });
});

for (const [title, responses, diagnostic] of [
  ['Different published archive fails closed', { [archiveUrl]: { status: 200, base64: Buffer.from('different published bytes').toString('base64') } }, /Existing version differs/u],
  ['Registry metadata failure does not authorize publishing', { [metadataUrl]: { status: 503, json: { error: 'Service Unavailable' } } }, /Registry preflight/u],
  ['Registry archive failure does not authorize publishing', { [archiveUrl]: { status: 500, json: { error: 'Internal Server Error' } } }, /500/u],
  ['Wrong registry package identity fails closed', { [metadataUrl]: { status: 200, json: { name: '@someone/else', version: '0.1.1', dist: { tarball: archiveUrl } } } }, /someone\/else/u],
  ['External archive origin fails before download', { [metadataUrl]: { status: 200, json: { name: packageName, version: '0.1.1', dist: { tarball: 'https://attacker.example/archive.tgz' } } } }, /attacker.example/u],
]) {
  test(title, async () => {
    await withSandbox({ responses }, async box => {
      const result = await box.run('release-control.mjs', 'publication', title);
      assert.equal(result.status, 1);
      assert.match(result.stderr, diagnostic);
      assert.equal(result.output, '');
      assert.equal(result.calls.filter(v => v.kind === 'gh').length, 0);
      assert.equal(result.calls.some(v => v.url?.includes('attacker.example')), false);
    });
  });
}

for (const [title, candidateChange] of [
  ['Dry-run candidate never reaches npm registry', { dryRun: true }],
  ['Wrong candidate source never reaches npm registry', { sourceCommit: 'b'.repeat(40) }],
  ['Wrong candidate archive identity never reaches npm registry', { artifact: 'releaselens-0.1.2.tgz' }],
  ['Wrong candidate tag never reaches npm registry', { tag: 'v0.1.2' }],
  ['Wrong candidate package never reaches npm registry', { package: '@someone/else' }],
]) {
  test(title, async () => {
    await withSandbox({ candidateChange }, async box => {
      const result = await box.run('release-control.mjs', 'publication', title);
      assert.equal(result.status, 1);
      assert.equal(result.output, '');
      assert.deepEqual(result.calls, []);
    });
  });
}

test('corrupt local candidate fails before npm lookup', async () => {
  await withSandbox({}, async box => {
    await writeFile(join(box.directory, candidate.artifact), 'corrupt archive');
    const result = await box.run('release-control.mjs', 'publication', 'Corrupt local candidate fails before npm lookup');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /checksum/u);
    assert.equal(result.output, '');
    assert.deepEqual(result.calls, []);
  });
});

for (const [title, registryReceipts, diagnostic] of [
  ['Missing registry case blocks finalization', receipts.slice(1), /Six registry receipts/u],
  ['Duplicate OS/Node case blocks finalization', [receipts[0], receipts[0], ...receipts.slice(2)], /six distinct/u],
  ['Wrong registry bytes block finalization', [{ ...receipts[0], sha256: '0'.repeat(64) }, ...receipts.slice(1)], /0{64}/u],
  ['Failed npx budget behavior blocks finalization', [{ ...receipts[0], checks: { ...receipts[0].checks, npxExceededBudgetExit: 0 } }, ...receipts.slice(1)], /npxExceededBudgetExit/u],
  ['Authenticated registry configuration blocks finalization', [{ ...receipts[0], anonymousNpmConfiguration: false }, ...receipts.slice(1)], /anonymousNpmConfiguration/u],
]) {
  test(title, async () => {
    await withSandbox({ registryReceipts }, async box => {
      const result = await box.run('release-control.mjs', 'finalize', title);
      assert.equal(result.status, 1);
      assert.match(result.stderr, diagnostic);
      assert.equal(result.generated.completedAt, undefined);
      assert.deepEqual(result.calls, []);
    });
  });
}

for (const [title, mutate] of [
  ['Wrong provenance workflow blocks finalization', s => { s.predicate.buildDefinition.externalParameters.workflow.path = '.github/workflows/other.yml'; }],
  ['Wrong provenance tag blocks finalization', s => { s.predicate.buildDefinition.externalParameters.workflow.ref = 'refs/tags/v0.1.0'; }],
  ['Wrong provenance repository blocks finalization', s => { s.predicate.buildDefinition.externalParameters.workflow.repository = 'https://github.com/someone/else'; }],
  ['Wrong provenance commit blocks finalization', s => { s.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = 'b'.repeat(40); }],
]) {
  test(title, async () => {
    const changed = structuredClone(statement); mutate(changed);
    await withSandbox({ audit: auditFor(changed) }, async box => {
      const result = await box.run('release-control.mjs', 'finalize', title);
      assert.equal(result.status, 1);
      assert.match(result.stderr, title.includes('commit') ? /Attested source commit/u : /workflow|ref|repository|other.yml/u);
      assert.equal(result.generated.completedAt, undefined);
      assert.deepEqual(result.calls, []);
    });
  });
}

test('moving the remote tag after build blocks finalization', async () => {
  await withSandbox({ remoteCommit: 'b'.repeat(40) }, async box => {
    const result = await box.run('release-control.mjs', 'finalize', 'Moved remote tag blocks finalization');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Remote tag moved/u);
    assert.equal(result.generated.completedAt, undefined);
    assert.equal(result.calls.filter(v => v.kind === 'gh').length, 0);
  });
});

test('an interrupted verification can resume after the missing independent receipt arrives', async () => {
  await withSandbox({ registryReceipts: receipts.slice(0, 5) }, async box => {
    const failed = await box.run('release-control.mjs', 'finalize', 'Interrupted verification / missing sixth receipt');
    assert.equal(failed.status, 1);
    assert.equal(failed.generated.completedAt, undefined);
    await writeFile(join(box.directory, 'registry/registry-node24-macos-latest.json'), JSON.stringify(receipts[5]));
    const resumed = await box.run('release-control.mjs', 'finalize', 'Interrupted verification / receipt repaired rerun');
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(resumed.generated.registryVerification.length, 6);
    assert.match(resumed.generated.completedAt, /^\d{4}-/u);
    assert.equal(resumed.generated.sha256, hash);
    assert.equal(resumed.calls.filter(v => v.kind === 'gh').length, 0);
  });
});

const finalized = { tag_name: 'v0.1.1', draft: false, assets: allAssets.map(name => ({ name, digest: `sha256:${hash}`, browser_download_url: reportUrl })) };
test('a finalized GitHub release is verified on rerun without uploads, edits, or deletes', async () => {
  await withSandbox({ githubRelease: finalized }, async box => {
    for (const attempt of [1, 2]) {
      const result = await box.run('publish-github-release.mjs', undefined, `Finalized GitHub release / attempt ${attempt}`);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Already finalized and verified/u);
      assert.deepEqual(result.calls.filter(v => v.kind === 'gh'), []);
    }
  });
});

for (const [title, githubRelease, previousReport, diagnostic] of [
  ['Finalized release with wrong package digest cannot be changed', { ...finalized, assets: finalized.assets.map(a => a.name === candidate.artifact ? { ...a, digest: `sha256:${'0'.repeat(64)}` } : a) }, candidate, /Finalized release archive/u],
  ['Finalized release missing evidence cannot be changed', { ...finalized, assets: finalized.assets.filter(a => a.name !== 'RELEASE_REPORT.md') }, candidate, /missing RELEASE_REPORT/u],
  ['Finalized release from another source cannot be changed', finalized, { ...candidate, sourceCommit: 'b'.repeat(40) }, /sourceCommit/u],
]) {
  test(title, async () => {
    await withSandbox({ githubRelease, previousReport }, async box => {
      const result = await box.run('publish-github-release.mjs', undefined, title);
      assert.equal(result.status, 1);
      assert.match(result.stderr, diagnostic);
      assert.deepEqual(result.calls.filter(v => v.kind === 'gh'), []);
    });
  });
}

test('interrupted draft uploads resume without replacing already matching package archives', async () => {
  const draft = { tag_name: 'v0.1.1', draft: true, assets: [
    { name: candidate.artifact, digest: `sha256:${hash}` },
    { name: 'release-lens-0.1.1-source.tar.gz', digest: `sha256:${hash}` },
    { name: 'RELEASE_REPORT.md', digest: `sha256:${'0'.repeat(64)}` },
  ] };
  await withSandbox({ githubRelease: draft }, async box => {
    const result = await box.run('publish-github-release.mjs', undefined, 'Interrupted draft resumes missing uploads and refreshes report');
    assert.equal(result.status, 0, result.stderr);
    const mutations = result.calls.filter(v => v.kind === 'gh').map(v => v.args);
    const uploads = mutations.filter(args => args[1] === 'upload');
    assert.equal(uploads.length, 6);
    assert.equal(uploads.some(args => args[3].endsWith(candidate.artifact)), false);
    assert.equal(uploads.some(args => args[3].endsWith('source.tar.gz')), false);
    assert.deepEqual(uploads.filter(args => args.includes('--clobber')).map(args => args[3]), [join('work/candidate', 'RELEASE_REPORT.md')]);
    assert.deepEqual(mutations.at(-1), ['release', 'edit', 'v0.1.1', '--repo', repository, '--draft=false', '--latest']);
    assert.equal(mutations.some(args => args[1] === 'create' || args[1] === 'delete'), false);
  });
});

test('a conflicting package archive on an interrupted draft blocks all uploads and finalization', async () => {
  await withSandbox({ githubRelease: { tag_name: 'v0.1.1', draft: true, assets: [{ name: candidate.artifact, digest: `sha256:${'0'.repeat(64)}` }] } }, async box => {
    const result = await box.run('publish-github-release.mjs', undefined, 'Conflicting draft package fails without mutation');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Existing draft archive differs/u);
    assert.deepEqual(result.calls.filter(v => v.kind === 'gh'), []);
  });
});

for (const event of ['workflow_dispatch', 'pull_request']) {
  test(`the ${event} event cannot authorize either publication entry point`, async () => {
    await withSandbox({ workflowEvent: event }, async box => {
      for (const [script, command] of [['release-control.mjs', 'publication'], ['publish-github-release.mjs', undefined]]) {
        const result = await box.run(script, command, `${event} rejected by ${script}`);
        assert.equal(result.status, 1);
        assert.equal(result.output, '');
        assert.deepEqual(result.calls, []);
      }
    });
  });
}
