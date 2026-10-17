import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const outputs = new Map<string, string>();

beforeAll(async () => {
  const originalBase = process.env.RELEASE_LENS_BASE_PATH;
  try {
    for (const base of ['/', '/release-lens/']) {
      const output = await mkdtemp(join(tmpdir(), 'release lens-web-'));
      outputs.set(base, output);
      process.env.RELEASE_LENS_BASE_PATH = base;
      await build({
        configFile: join(root, 'vite.config.ts'),
        logLevel: 'silent',
        build: { outDir: output, emptyOutDir: true },
      });
    }
  } finally {
    if (originalBase === undefined) delete process.env.RELEASE_LENS_BASE_PATH;
    else process.env.RELEASE_LENS_BASE_PATH = originalBase;
  }
});

afterAll(async () => {
  await Promise.all([...outputs.values()].map(output => rm(output, { recursive: true, force: true })));
});

describe.each(['/', '/release-lens/'])('production web distribution at %s', (base) => {
  it.each(['LICENSE', 'THIRD_PARTY_NOTICES.md'])('includes the exact root %s', async (name) => {
    const shipped = await readFile(join(outputs.get(base)!, name));
    expect(shipped).toEqual(await readFile(join(root, name)));
  });

  it('keeps the production CSP free of development nonces and inline allowances', async () => {
    const html = await readFile(join(outputs.get(base)!, 'index.html'), 'utf8');
    expect(html).toContain("script-src 'self'");
    expect(html).toContain("style-src 'self'");
    expect(html).not.toContain('csp-nonce');
    expect(html).not.toContain('nonce=');
    expect(html).not.toContain("'nonce-");
    expect(html).not.toContain("'unsafe-inline'");
  });

  it('references emitted scripts, styles, and favicon under the configured base path', async () => {
    const output = outputs.get(base)!;
    const html = await readFile(join(output, 'index.html'), 'utf8');
    expect(html).toContain(`href="${base}favicon.svg"`);
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => match[1]);
    expect(assets).toHaveLength(2);
    for (const asset of assets) {
      expect(asset.startsWith(`${base}assets/`), asset).toBe(true);
      expect((await readFile(join(output, asset.slice(base.length)))).length).toBeGreaterThan(0);
    }
  });
});
