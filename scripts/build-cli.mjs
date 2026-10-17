import { build } from 'esbuild';
import { chmod, cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageRoot = join(root, 'packages/cli');
await mkdir(join(packageRoot, 'dist'), { recursive: true });
await build({
  entryPoints: [join(packageRoot, 'src/main.ts')],
  outfile: join(packageRoot, 'dist/main.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'eof',
});
await chmod(join(packageRoot, 'dist/main.js'), 0o755);

for (const name of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'CONTRIBUTING.md']) {
  await cp(join(root, name), join(packageRoot, name));
}
await mkdir(join(packageRoot, 'docs'), { recursive: true });
for (const name of ['measurement-contract.md', 'parser-audit.md']) {
  await cp(join(root, 'docs', name), join(packageRoot, 'docs', name));
}
await mkdir(join(packageRoot, 'evidence'), { recursive: true });
for (const name of ['RELEASE.md', 'PUBLIC_RELEASE.md']) {
  await cp(join(root, 'evidence', name), join(packageRoot, 'evidence', name));
}
const fixtureRoot = join(root, 'fixtures');
await rm(join(packageRoot, 'fixtures'), { recursive: true, force: true });
await mkdir(join(packageRoot, 'fixtures'), { recursive: true });
for (const name of ['before.tgz', 'after.tgz', 'clean.tgz', 'synthetic-records.json', 'hostile']) {
  await cp(join(fixtureRoot, name), join(packageRoot, 'fixtures', name), { recursive: true });
}
