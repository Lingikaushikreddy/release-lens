import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { gzip, tar } from './helpers/archive';

const script = fileURLToPath(new URL('../scripts/package-candidate.py', import.meta.url));
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function candidate(rootVersion = '0.2.3') {
  const root = await mkdtemp(join(tmpdir(), 'release lens-candidate-'));
  temporary.push(root);
  const files = [
    '.github/workflows/example.yml', '.gitignore', '.npmrc', 'CHANGELOG.md', 'CONTRIBUTING.md',
    'LICENSE', 'README.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md', 'apps/web/index.html',
    'docs/measurement-contract.md', 'evidence/RELEASE.md', 'fixtures/example.tgz',
    'packages/core/src/index.ts', 'packages/cli/src/main.ts', 'packages/cli/dist/main.js',
    'playwright.config.ts', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json',
    'vite.config.ts', 'vitest.config.ts', 'tests/example.test.ts', 'dist/web/index.html',
  ];
  for (const file of files) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), 'fixture\n');
  }
  await mkdir(join(root, 'scripts'));
  await copyFile(script, join(root, 'scripts/package-candidate.py'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: rootVersion }));
  await writeFile(join(root, 'packages/cli/package.json'), JSON.stringify({ name: '@example/cli', version: '0.2.3' }));
  return root;
}

async function assemble(root: string, manifest: { name: string; version: string }) {
  const artifact = join(root, 'tested.tgz');
  await writeFile(artifact, gzip(tar({ name: 'package/package.json', body: JSON.stringify(manifest) })));
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', [
    join(root, 'scripts/package-candidate.py'), '--cli-artifact', artifact, '--output', join(root, 'candidate'),
  ], { encoding: 'utf8' });
  expect(result.error).toBeUndefined();
  return { ...result, artifact, output: join(root, 'candidate') };
}

// Removing the embedded manifest check must make these inputs publishable again.
it.each([
  { name: '@example/cli', version: '0.2.2' },
  { name: '@example/other', version: '0.2.3' },
])('rejects a supplied tarball with mismatched identity: $name@$version', async manifest => {
  const result = await assemble(await candidate(), manifest);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('CLI artifact identity');
});

it('rejects inconsistent workspace and CLI release versions', async () => {
  const result = await assemble(await candidate('0.2.2'), { name: '@example/cli', version: '0.2.3' });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Workspace and CLI versions');
});

// Repacking, using a fixed version, or hashing different bytes breaks this receipt.
it('preserves the tested tarball bytes in a versioned bundle and records their identity', async () => {
  const result = await assemble(await candidate(), { name: '@example/cli', version: '0.2.3' });
  expect(result.status, result.stderr).toBe(0);
  const original = await readFile(result.artifact);
  const shipped = await readFile(join(result.output, 'releaselens-0.2.3.tgz'));
  expect(shipped).toEqual(original);
  const receipt = JSON.parse(await readFile(join(result.output, 'release.json'), 'utf8'));
  expect(receipt.version).toBe('0.2.3');
  expect(receipt.package).toBe('@example/cli@0.2.3');
  expect(receipt.sourceCommit).toBeTruthy();
  expect(receipt.artifacts['releaselens-0.2.3.tgz']).toEqual({
    bytes: original.length,
    sha256: createHash('sha256').update(original).digest('hex'),
  });
  for (const filename of ['release-lens-0.2.3-source.tar.gz', 'release-lens-0.2.3-web.zip']) {
    expect(receipt.artifacts[filename].bytes).toBe((await readFile(join(result.output, filename))).length);
  }
});
