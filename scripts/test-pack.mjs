import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const npm = process.platform === 'win32' ? process.execPath : 'npm';
const npmPrefix = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')] : [];
const temporary = await mkdtemp(join(tmpdir(), 'release lens-pack-'));
const evidence = join(root, 'evidence');

function execute(command, args, cwd, expectedStatus = 0, timeout) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, PATH: dirname(process.execPath) + delimiter + (process.env.PATH ?? ''), npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, expectedStatus, `${command} ${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  return result;
}

try {
  execute(process.execPath, [join(root, 'scripts/build-cli.mjs')], root);
  const packed = execute(npm, [...npmPrefix, 'pack', join(root, 'packages/cli'), '--ignore-scripts', '--json', '--pack-destination', temporary], temporary);
  const metadata = JSON.parse(packed.stdout)[0];
  assert.equal(metadata.name, 'releaselens');
  const required = [
    'package.json', 'dist/main.js', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
    'SECURITY.md', 'CONTRIBUTING.md', 'docs/measurement-contract.md',
    'docs/parser-audit.md', 'evidence/RELEASE.md', 'evidence/PUBLIC_RELEASE.md',
    'fixtures/before.tgz', 'fixtures/after.tgz', 'fixtures/clean.tgz',
    'fixtures/hostile/checksum.tgz', 'fixtures/hostile/traversal.tgz',
    'fixtures/hostile/missing-manifest.tgz', 'fixtures/hostile/markup.tgz',
    'fixtures/synthetic-records.json',
  ];
  for (const path of required) assert(metadata.files.some((file) => file.path === path), `Packed artifact omitted ${path}`);
  assert(!metadata.files.some((file) => file.path.startsWith('src/')), 'Source files should not be required at runtime');
  const packedPath = join(temporary, metadata.filename);
  const consumer = join(temporary, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), '{"name":"release-lens-clean-consumer","version":"1.0.0","private":true}\n');
  execute(npm, [...npmPrefix, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', packedPath], consumer);

  const installed = join(consumer, 'node_modules/releaselens');
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.engines.node, '>=22');
  assert.equal(manifest.bin.releaselens, 'dist/main.js');
  assert.equal(manifest.scripts, undefined, 'Shipped package must not need lifecycle scripts');
  assert.equal(manifest.dependencies, undefined, 'CLI bundle must not need external runtime dependencies');
  const binary = join(consumer, 'node_modules/.bin', process.platform === 'win32' ? 'releaselens.cmd' : 'releaselens');
  // The installed entrypoint is invoked directly on Windows because .cmd
  // shims require a shell. Validate that npm generated the shim as well.
  await readFile(binary);
  const cliCommand = process.platform === 'win32' ? process.execPath : binary;
  const cliPrefix = process.platform === 'win32' ? [join(installed, manifest.bin.releaselens)] : [];
  const runCLI = (args, status = 0) => execute(cliCommand, [...cliPrefix, ...args], consumer, status);
  const installedRuntime = execute('node', ['--version'], consumer).stdout.trim();
  assert.equal(installedRuntime, process.version, 'Installed bin must use the runtime under test');
  const help = runCLI(['--help']);
  assert(help.stdout.includes('releaselens diff'));
  assert.equal(help.stderr, '');
  const fixtures = join(installed, 'fixtures');
  const before = join(fixtures, 'before.tgz');
  const after = join(fixtures, 'after.tgz');
  const clean = join(fixtures, 'clean.tgz');
  const originalHash = createHash('sha256').update(await readFile(before)).digest('hex');
  const diffArgs = ['diff', before, after, '--format', 'json'];
  const result = runCLI(diffArgs);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  // Independent literals come from constructed payloads and CPython tarfile
  // records. Never derive these expectations from the analyzer or its output.
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.before.unpackedBytes, 687);
  assert.equal(report.after.unpackedBytes, 18_875_059);
  assert.equal(report.unpackedDelta, 18_874_372);
  assert.equal(report.before.entries.length, 6);
  assert.equal(report.after.entries.length, 8);
  assert.equal(report.budget, 'unset');
  assert.equal(report.before.archiveBytes, (await readFile(before)).length);
  assert.equal(report.after.archiveBytes, (await readFile(after)).length);
  assert.equal(report.fileDeltas.find((file) => file.path === 'fixtures/training-a.bin').delta, 10 * 1024 ** 2);
  assert.equal(report.fileDeltas.find((file) => file.path === 'fixtures/training-b.bin').delta, 8 * 1024 ** 2);
  assert(report.findings.some((finding) => finding.side === 'after' && finding.paths.includes('dist/missing.js')));
  assert.equal(result.stdout, runCLI(diffArgs).stdout);
  assert(result.stdout.endsWith('\n'));
  assert(!result.stdout.includes(consumer));
  assert.equal(JSON.parse(runCLI([...diffArgs, '--max-unpacked-growth', '18874372']).stdout).budget, 'pass');
  assert.equal(JSON.parse(runCLI([...diffArgs, '--max-unpacked-growth', '18874371'], 1).stdout).budget, 'fail');
  const cleanup = JSON.parse(runCLI(['diff', after, clean, '--format', 'json']).stdout);
  assert.equal(cleanup.unpackedDelta, -18_874_372);
  assert(!cleanup.findings.some((finding) => finding.side === 'after' && finding.paths.includes('dist/missing.js')));
  const cleanupText = runCLI(['diff', after, clean]).stdout;
  const fixedWarning = cleanupText.split('\n').filter((line) => line.includes('MISSING_LITERAL_TARGET'));
  assert.equal(fixedWarning.length, 1);
  assert(fixedWarning[0].includes('side="before"'));
  assert(fixedWarning[0].includes('pointer="/bin/demo"'));
  assert(fixedWarning[0].includes('paths=["dist/missing.js"]'));
  if (process.platform !== 'win32') {
    const fifo = join(consumer, 'input-fifo.tgz');
    execute('mkfifo', [fifo], consumer);
    const refused = execute(cliCommand, [...cliPrefix, 'diff', fifo, after], consumer, 3, 1500);
    assert.equal(refused.stdout, '');
    assert(refused.stderr.includes('not a regular file'));
  }
  const output = join(consumer, 'installed-report.json');
  const saved = runCLI([...diffArgs, '--out', output]);
  assert.equal(saved.stdout, '');
  assert.equal(await readFile(output, 'utf8'), result.stdout);
  for (const filename of ['checksum.tgz', 'traversal.tgz', 'missing-manifest.tgz']) {
    const invalid = runCLI(['diff', before, join(fixtures, 'hostile', filename), '--format', 'json'], 2);
    assert.equal(invalid.stdout, '');
    assert(invalid.stderr.startsWith('releaselens:'));
  }
  runCLI(['diff', before, join(fixtures, 'hostile/markup.tgz'), '--format', 'json']);
  assert.equal(createHash('sha256').update(await readFile(before)).digest('hex'), originalHash);
  assert(!(await readdir(consumer)).some((name) => name.endsWith('.tmp')));
  await mkdir(evidence, { recursive: true });
  const receipt = {
    node: process.version,
    installedRuntime,
    platform: process.platform,
    artifact: metadata.filename,
    sha256: createHash('sha256').update(await readFile(packedPath)).digest('hex'),
    installedWithScriptsDisabled: true,
    installedBinaryHelp: true,
    independentUnpackedDelta: 18_874_372,
    budgetBoundaryPassed: true,
    hostileArchivesRejected: 3,
    findingsRetainSideAndPointer: true,
    fifoRejectedPromptly: process.platform === 'win32' ? 'not applicable' : true,
    runtimeDependencies: 0,
    packedFiles: metadata.files.map((file) => file.path),
  };
  if (process.env.RELEASE_LENS_PACK_DESTINATION) {
    await mkdir(dirname(process.env.RELEASE_LENS_PACK_DESTINATION), { recursive: true });
    await copyFile(packedPath, process.env.RELEASE_LENS_PACK_DESTINATION);
  }
  await writeFile(join(evidence, 'pack.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`Packed CLI verified from clean consumer (${process.version}, ${process.platform}): +18,874,372 bytes; inclusive budgets; hostile archives; atomic output.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
