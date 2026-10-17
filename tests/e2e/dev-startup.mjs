import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from '@playwright/test';

// Run against `pnpm dev --port 4322 --strictPort` (not the production preview).
const url = process.env.RELEASE_LENS_DEV_URL ?? 'http://127.0.0.1:4322';
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => {
      window.__startupCspViolations = [];
      document.addEventListener('securitypolicyviolation', event => {
        window.__startupCspViolations.push({ directive: event.violatedDirective, blocked: event.blockedURI });
      });
    });
    await page.goto(url);
    await page.getByRole('heading', { name: 'Review what your package ships.' }).waitFor();
    const startup = await page.evaluate(() => ({
      headerHeight: getComputedStyle(document.querySelector('.app-header')).height,
      headingSize: getComputedStyle(document.querySelector('h1')).fontSize,
      violations: window.__startupCspViolations,
    }));
    console.log(JSON.stringify({ engine: name, startup }));
    assert.deepEqual(startup.violations, [], 'Documented dev startup must not violate CSP.');
    assert.equal(startup.headerHeight, '74px', 'Development CSS must apply.');
    assert.equal(startup.headingSize, '31px', 'Development typography must apply.');
    await page.getByRole('button', { name: 'Compare example releases' }).click();
    await page.getByRole('heading', { name: 'Review summary' }).waitFor();
    assert.equal(await page.locator('.primary-measurement .exact-value').textContent(), '+18,874,372 B');
    assert.deepEqual(await page.evaluate(() => window.__startupCspViolations), []);
    const firstNonce = await page.locator('meta[property="csp-nonce"]').evaluate(element => element.nonce);
    assert.match(firstNonce, /^[A-Za-z0-9+/]{24}$/, 'Development CSP must use a random nonce.');
    await page.reload();
    await page.getByRole('heading', { name: 'Review what your package ships.' }).waitFor();
    const nextNonce = await page.locator('meta[property="csp-nonce"]').evaluate(element => element.nonce);
    assert.notEqual(firstNonce, nextNonce, 'Each HTML request must receive a fresh nonce.');
    console.log(`${name}: styled startup, worker comparison, strict CSP, and fresh document nonce passed.`);
  } finally { await browser.close(); }
}
