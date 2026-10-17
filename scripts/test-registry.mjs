import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistryFetcher } from './registry-fetch.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageName = process.env.RELEASE_LENS_REGISTRY_PACKAGE ?? '@kaushikgojo/release-lens';
const version = process.env.RELEASE_LENS_REGISTRY_VERSION ?? JSON.parse(await readFile(join(root, 'packages/cli/package.json'), 'utf8')).version;
const specification = `${packageName}@${version}`;
const registry = 'https://registry.npmjs.org';
assert(process.env.RELEASE_LENS_REGISTRY_ARTIFACT, 'RELEASE_LENS_REGISTRY_ARTIFACT must identify the exact reviewed CI artifact');
// Resolve the release proof before any registry request or subprocess runs.
const expectedArtifactSha256 = hash(await readFile(process.env.RELEASE_LENS_REGISTRY_ARTIFACT));
// Use the canonical macOS /private/var path so npm 11.5.1 writes ordinary
// node_modules lock keys rather than paths relative to the /var alias.
const temporary = await mkdtemp(join(await realpath(tmpdir()), 'release-lens-registry-'));
const privatePrefix = join(temporary, 'npm-prefix');
const userConfig = join(temporary, 'user.npmrc');
const globalConfig = join(temporary, 'global.npmrc');
const npmDirectory = join(dirname(process.execPath), 'node_modules/npm/bin');
const command = (name) => process.platform === 'win32' ? process.execPath : name;
const commandPrefix = (name) => process.platform === 'win32' ? [join(npmDirectory, `${name}-cli.js`)] : [];
// Never let a workspace-provided bin satisfy an npm, npx, or node invocation.
const inheritedPath = (process.env.PATH ?? '').split(delimiter).filter((entry) => {
  const path = resolve(entry || '.');
  return path !== resolve(root) && !path.startsWith(resolve(root) + (process.platform === 'win32' ? '\\' : '/'));
});
const environment = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/iu.test(key) && !/^(npm_token|node_auth_token)$/iu.test(key))),
  PATH: [dirname(process.execPath), ...inheritedPath].join(delimiter),
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  npm_config_update_notifier: 'false',
  npm_config_registry: registry,
  npm_config_prefix: privatePrefix,
  NPM_CONFIG_PREFIX: privatePrefix,
  npm_config_global: 'false',
  NPM_CONFIG_GLOBAL: 'false',
  npm_config_userconfig: userConfig,
  NPM_CONFIG_USERCONFIG: userConfig,
  npm_config_globalconfig: globalConfig,
  NPM_CONFIG_GLOBALCONFIG: globalConfig,
};

function execute(binary, args, cwd, status = 0) {
  const result = spawnSync(binary, args, { cwd, env: environment, encoding: 'utf8', timeout: 180_000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, status, `${binary} exited ${result.status}, expected ${status}\n${result.stderr}\n${result.stdout}`);
  return result;
}

function hash(bytes, algorithm = 'sha256', encoding = 'hex') {
  return createHash(algorithm).update(bytes).digest(encoding);
}

try {
  const npxConsumer = join(temporary, 'npx-consumer');
  const installConsumer = join(temporary, 'install-consumer');
  const npxCache = join(temporary, 'npx-cache');
  const installCache = join(temporary, 'install-cache');
  for (const directory of [npxConsumer, installConsumer, npxCache, installCache, privatePrefix]) await mkdir(directory);
  await writeFile(userConfig, '');
  await writeFile(globalConfig, '');
  assert.deepEqual(await readdir(npxConsumer), []);
  assert.deepEqual(await readdir(npxCache), []);
  assert.deepEqual(await readdir(installCache), []);
  assert.deepEqual(await readdir(privatePrefix), []);

  const registryFetcher = createRegistryFetcher({
    timeoutMs: Number(process.env.RELEASE_LENS_REGISTRY_TIMEOUT_MS ?? 600_000),
    onRetry: ({ attempt, delayMs, reason }) => console.error(`Waiting for public npm propagation after attempt ${attempt}: ${reason}; retry in ${delayMs}ms.`),
  });
  const metadata = await registryFetcher.json(`${registry}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`);
  assert.equal(metadata.name, packageName);
  assert.equal(metadata.version, version);
  assert.deepEqual(metadata.bin, { releaselens: 'dist/main.js' });
  assert.equal(metadata.scripts, undefined, 'Published package must have no lifecycle scripts');
  assert.equal(metadata.dependencies, undefined, 'Published CLI must need no external runtime dependencies');
  assert.equal(metadata.engines.node, '>=22');
  const tarballURL = new URL(metadata.dist.tarball);
  assert.equal(tarballURL.origin, registry, 'Only fetch the public npm registry tarball');
  const tarball = await registryFetcher.bytes(tarballURL);
  const integrity = `sha512-${hash(tarball, 'sha512', 'base64')}`;
  assert(metadata.dist.integrity.split(/\s+/u).includes(integrity), 'Downloaded tarball must match npm SHA-512 integrity');
  if (metadata.dist.shasum) assert.equal(hash(tarball, 'sha1'), metadata.dist.shasum);
  const sha256 = hash(tarball);
  assert.equal(sha256, expectedArtifactSha256, 'Registry bytes must match the exact reviewed publish artifact');
  // npm/npx resolve an exact version from the installation packument, whose
  // cache may lag behind both the exact-version URL and available tarball.
  const packumentURL = `${registry}/${encodeURIComponent(packageName)}`;
  await registryFetcher.packument(packumentURL, metadata);
  await registryFetcher.packument(packumentURL, metadata, { accept: 'application/json' });
  const registryPropagation = registryFetcher.receipt();

  const npmVersion = execute(command('npm'), [...commandPrefix('npm'), '--version'], npxConsumer).stdout.trim();
  const npxVersion = execute(command('npx'), [...commandPrefix('npx'), '--version'], npxConsumer).stdout.trim();
  const configuredPrefix = execute(command('npm'), [...commandPrefix('npm'), 'prefix', '--global'], npxConsumer).stdout.trim();
  assert.equal(resolve(configuredPrefix), resolve(privatePrefix), 'Global fallback must be isolated to the new empty prefix');
  for (const [setting, expected] of [['userconfig', userConfig], ['globalconfig', globalConfig]]) {
    const configured = execute(command('npm'), [...commandPrefix('npm'), 'config', 'get', setting], npxConsumer).stdout.trim();
    assert.equal(resolve(configured), resolve(expected), `${setting} must use the isolated empty file`);
    assert.equal(await readFile(expected, 'utf8'), '');
  }
  const installedRuntime = execute('node', ['--version'], npxConsumer).stdout.trim();
  assert.equal(installedRuntime, process.version, 'npx and installed bins must use the runtime under test');
  const npxOptions = [...commandPrefix('npx'), '--yes', '--ignore-scripts', '--cache', npxCache, '--registry', registry, specification];
  const runNpx = (args, status = 0) => execute(command('npx'), [...npxOptions, ...args], npxConsumer, status);
  const npxHelp = runNpx(['--help']);
  assert(npxHelp.stdout.includes('releaselens diff'));
  assert.deepEqual(await readdir(npxConsumer), [], 'npx should run without creating a local installation');
  // libnpmexec can otherwise use an already-installed global package. Prove
  // this invocation populated its own new cache with the registry identity.
  const npxDirectories = (await readdir(join(npxCache, '_npx'), { withFileTypes: true })).filter((entry) => entry.isDirectory());
  assert.equal(npxDirectories.length, 1, 'npx must create exactly one isolated cache installation');
  const npxInstall = join(npxCache, '_npx', npxDirectories[0].name);
  const npxManifest = JSON.parse(await readFile(join(npxInstall, 'node_modules', ...packageName.split('/'), 'package.json'), 'utf8'));
  assert.equal(npxManifest.name, packageName);
  assert.equal(npxManifest.version, version);
  assert.deepEqual(npxManifest.bin, metadata.bin);
  const npxPackage = JSON.parse(await readFile(join(npxInstall, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(npxPackage.dependencies ?? {}), [packageName]);
  assert([version, `^${version}`].includes(npxPackage.dependencies[packageName]));
  // npm 10 saves the dependency without npm 11's private _npx metadata.
  // The installed manifest and lock below still prove exact registry identity.
  if (npxPackage._npx !== undefined) assert.deepEqual(npxPackage._npx.packages, [specification]);
  const npxLock = JSON.parse(await readFile(join(npxInstall, 'package-lock.json'), 'utf8'));
  const npxLocked = npxLock.packages[`node_modules/${packageName}`];
  assert.equal(npxLocked.version, version);
  assert.equal(npxLocked.resolved, tarballURL.href);
  assert.equal(npxLocked.integrity, metadata.dist.integrity);
  await readFile(join(npxInstall, 'node_modules/.bin', process.platform === 'win32' ? 'releaselens.cmd' : 'releaselens'));

  await writeFile(join(installConsumer, 'package.json'), '{"name":"release-lens-registry-consumer","version":"1.0.0","private":true}\n');
  execute(command('npm'), [...commandPrefix('npm'), 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', installCache, '--registry', registry, '--save-exact', specification], installConsumer);
  const installed = join(installConsumer, 'node_modules', ...packageName.split('/'));
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.name, packageName);
  assert.equal(manifest.version, version);
  assert.deepEqual(manifest.bin, metadata.bin);
  assert.equal(manifest.scripts, undefined);
  assert.equal(manifest.dependencies, undefined);
  const lock = JSON.parse(await readFile(join(installConsumer, 'package-lock.json'), 'utf8'));
  const locked = lock.packages[`node_modules/${packageName}`];
  assert.equal(locked.version, version);
  assert.equal(locked.resolved, tarballURL.href);
  assert.equal(locked.integrity, metadata.dist.integrity);
  const installedBinary = join(installConsumer, 'node_modules/.bin', process.platform === 'win32' ? 'releaselens.cmd' : 'releaselens');
  await readFile(installedBinary);
  // npm exec invokes the installed Windows .cmd shim without hand-written
  // shell quoting. Offline/no prevent any registry or installation fallback.
  const cliCommand = process.platform === 'win32' ? command('npm') : installedBinary;
  const cliPrefix = process.platform === 'win32' ? [...commandPrefix('npm'), 'exec', '--offline', '--no', '--ignore-scripts', '--cache', installCache, '--registry', registry, '--', 'releaselens'] : [];
  const runInstalled = (args, status = 0) => execute(cliCommand, [...cliPrefix, ...args], installConsumer, status);
  assert(runInstalled(['--help']).stdout.includes('releaselens diff'));

  // These inputs come from the registry installation, never the checkout.
  const inputs = join(npxConsumer, 'inputs');
  await mkdir(inputs);
  for (const filename of ['before.tgz', 'after.tgz', 'clean.tgz']) await copyFile(join(installed, 'fixtures', filename), join(inputs, filename));
  await copyFile(join(installed, 'fixtures/hostile/checksum.tgz'), join(inputs, 'invalid.tgz'));
  const before = join(inputs, 'before.tgz');
  const after = join(inputs, 'after.tgz');
  const clean = join(inputs, 'clean.tgz');
  const invalid = join(inputs, 'invalid.tgz');
  const inputHashes = await Promise.all([before, after, clean].map(async (path) => hash(await readFile(path))));
  const growthArgs = ['diff', before, after, '--format', 'json'];
  const installedResult = runInstalled(growthArgs);
  assert.equal(installedResult.stderr, '');
  const report = JSON.parse(installedResult.stdout);
  // Expectations come from the independently constructed payload sizes and
  // CPython tarfile oracle, not from analyzer-generated totals.
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.before.unpackedBytes, 687);
  assert.equal(report.after.unpackedBytes, 18_875_059);
  assert.equal(report.unpackedDelta, 18_874_372);
  assert.equal(report.fileDeltas.find((file) => file.path === 'fixtures/training-a.bin').delta, 10 * 1024 ** 2);
  assert.equal(report.fileDeltas.find((file) => file.path === 'fixtures/training-b.bin').delta, 8 * 1024 ** 2);
  assert(report.findings.some((finding) => finding.side === 'after' && finding.pointer === '/bin/demo' && finding.paths.includes('dist/missing.js')));
  assert.equal(runNpx(growthArgs).stdout, installedResult.stdout, 'Real npx and installed binary must produce identical reports');
  assert.equal(runInstalled(growthArgs).stdout, installedResult.stdout, 'Reports must be deterministic');
  assert.equal(JSON.parse(runInstalled([...growthArgs, '--max-unpacked-growth', '18874372']).stdout).budget, 'pass');
  assert.equal(JSON.parse(runInstalled([...growthArgs, '--max-unpacked-growth', '18874371'], 1).stdout).budget, 'fail');
  assert.equal(JSON.parse(runNpx([...growthArgs, '--max-unpacked-growth', '18874372']).stdout).budget, 'pass');
  assert.equal(JSON.parse(runNpx([...growthArgs, '--max-unpacked-growth', '18874371'], 1).stdout).budget, 'fail');
  const cleanupArgs = ['diff', after, clean, '--format', 'json'];
  const cleanupResult = runInstalled(cleanupArgs);
  assert.equal(JSON.parse(cleanupResult.stdout).unpackedDelta, -18_874_372);
  assert.equal(runNpx(cleanupArgs).stdout, cleanupResult.stdout);
  const rejected = runInstalled(['diff', before, invalid, '--format', 'json'], 2);
  assert.equal(rejected.stdout, '');
  assert(rejected.stderr.startsWith('releaselens:'));
  const npxRejected = runNpx(['diff', before, invalid, '--format', 'json'], 2);
  assert.equal(npxRejected.stdout, '');
  assert(npxRejected.stderr.startsWith('releaselens:'));

  const output = join(installConsumer, 'report.json');
  await writeFile(output, 'previous report\n');
  const saved = runInstalled([...growthArgs, '--out', output]);
  assert.equal(saved.stdout, '');
  assert.equal(saved.stderr, '');
  assert.equal(await readFile(output, 'utf8'), installedResult.stdout);
  const failedOutput = runInstalled(['diff', before, invalid, '--format', 'json', '--out', output], 2);
  assert.equal(failedOutput.stdout, '');
  assert.equal(await readFile(output, 'utf8'), installedResult.stdout, 'Invalid input must preserve the existing report');
  const directoryTarget = join(installConsumer, 'directory-target');
  await mkdir(directoryTarget);
  assert.equal(runInstalled([...growthArgs, '--out', directoryTarget], 3).stdout, '');
  assert(!(await readdir(installConsumer)).some((name) => name.endsWith('.tmp')), 'Atomic output must leave no temporary files');
  const npxOutput = join(npxConsumer, 'report.json');
  const npxSaved = runNpx([...growthArgs, '--out', npxOutput]);
  assert.equal(npxSaved.stdout, '');
  assert.equal(await readFile(npxOutput, 'utf8'), installedResult.stdout);
  const npxFailedOutput = runNpx(['diff', before, invalid, '--format', 'json', '--out', npxOutput], 2);
  assert.equal(npxFailedOutput.stdout, '');
  assert.equal(await readFile(npxOutput, 'utf8'), installedResult.stdout);
  assert(!(await readdir(npxConsumer)).some((name) => name.endsWith('.tmp')));
  assert.deepEqual(await Promise.all([before, after, clean].map(async (path) => hash(await readFile(path)))), inputHashes, 'Archive inputs must remain unchanged');

  const receipt = {
    package: packageName,
    version,
    verifiedAt: new Date().toISOString(),
    registry,
    registryPropagation,
    tarball: tarballURL.href,
    sha256,
    integrity,
    expectedArtifactSha256,
    expectedArtifactMatched: true,
    node: process.version,
    installedRuntime,
    npm: npmVersion,
    npx: npxVersion,
    platform: process.platform,
    architecture: process.arch,
    runner: process.env.GITHUB_ACTIONS === 'true' ? {
      os: process.env.RUNNER_OS,
      architecture: process.env.RUNNER_ARCH,
      image: process.env.ImageOS,
      imageVersion: process.env.ImageVersion,
    } : null,
    installedExecution: process.platform === 'win32' ? 'local npm exec --offline --no through installed .cmd shim' : 'direct installed bin',
    freshEmptyWorkingDirectories: true,
    independentFreshCaches: true,
    freshPrivateGlobalPrefix: true,
    anonymousNpmConfiguration: true,
    installedWithScriptsDisabled: true,
    runtimeDependencies: 0,
    checks: {
      publicMetadataAndTarballIntegrity: true,
      publicInstallPackumentsMatchExactVersion: true,
      reviewedCIArtifactMatchesRegistryBytes: true,
      npxCacheInstallationMatchesRegistry: true,
      globalFallbackExcluded: true,
      lockfileMatchesRegistry: true,
      npxExecutableInferenceAndHelp: true,
      installedExecutableHelp: true,
      npxAndInstalledReportsMatch: true,
      npxInclusiveBudgetPassExit: 0,
      npxExceededBudgetExit: 1,
      npxMalformedArchiveExit: 2,
      npxAtomicOutputAndFailurePreservation: true,
      independentGrowthBytes: 18_874_372,
      independentCleanupBytes: -18_874_372,
      deterministicJSON: true,
      findingsRetainSideAndPointer: true,
      inclusiveBudgetPassExit: 0,
      exceededBudgetExit: 1,
      malformedArchiveExit: 2,
      atomicOutputReplaced: true,
      validationFailurePreservesOutput: true,
      failedRenameExit: 3,
      temporaryFilesCleaned: true,
      inputsUnchanged: true,
    },
  };
  const destination = process.env.RELEASE_LENS_REGISTRY_REPORT ?? join(root, 'evidence/npm-registry.json');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`Registry CLI verified: ${specification} (${process.version}, ${process.platform}); fresh npx and npm install; exact +18,874,372/-18,874,372 bytes; exit codes and atomic output passed.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
