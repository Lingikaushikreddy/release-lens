import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { defineConfig, type Plugin } from 'vite';

function distributionNotices(): Plugin {
  return {
    name: 'release-lens-distribution-notices',
    apply: 'build',
    async generateBundle() {
      for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
        this.emitFile({
          type: 'asset',
          fileName: name,
          source: await readFile(new URL(name, import.meta.url)),
        });
      }
    },
  };
}

// Vite's development CSS client reads this meta nonce before creating style tags.
// Generate it per HTML response; the production build keeps its self-only CSP.
function developmentStyleNonce(): Plugin {
  return {
    name: 'release-lens-development-style-nonce',
    apply: 'serve',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const nonce = randomBytes(18).toString('base64');
        return {
          html: html.replace("style-src 'self';", `style-src 'self' 'nonce-${nonce}';`),
          tags: [{ tag: 'meta', attrs: { property: 'csp-nonce', nonce }, injectTo: 'head-prepend' }],
        };
      },
    },
  };
}

export default defineConfig({
  root: 'apps/web',
  base: process.env.RELEASE_LENS_BASE_PATH ?? '/',
  plugins: [developmentStyleNonce(), distributionNotices()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: { fs: { allow: ['../..'] } },
});
