import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const example = (name: string) => resolve(`apps/web/public/examples/${name}.tgz`);
const basePath = process.env.RELEASE_LENS_BASE_PATH ?? '/';
async function choosePair(page: Page, after = 'after') {
  await page.getByLabel('Before archive').setInputFiles(example('before'));
  await page.getByLabel('After archive').setInputFiles(example(after));
}
async function compare(page: Page) {
  await page.getByRole('button', { name: 'Compare archives', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review summary' })).toBeVisible();
}

test('local files produce a useful review, searchable evidence, and canonical JSON', async ({ page }) => {
  await page.goto(basePath);
  await expect(page.getByRole('heading', { name: /A closer look/ })).toBeVisible();
  await choosePair(page);
  await page.getByLabel('Growth budget in bytes').fill('0');
  await compare(page);
  await expect(page.getByText('Budget exceeded', { exact: true })).toBeVisible();
  await expect(page.getByText('Filename heuristics', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Manifest changes' })).toBeVisible();
  await page.getByLabel('Search file paths').fill('fixtures');
  await expect(page.locator('tbody tr').first()).toContainText('fixtures');
  await page.getByLabel('Search file paths').fill('no-such-path-9bf');
  await expect(page.getByText('No paths match these filters.')).toBeVisible();
  await page.getByLabel('Search file paths').fill('');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const download = await downloadEvent;
  const actual = await readFile((await download.path())!, 'utf8');
  const core = await import('../../packages/core/src/index');
  const [before, after] = await Promise.all(['before', 'after'].map(async name => {
    const bytes = await readFile(example(name));
    return core.readInventory(new Blob([new Uint8Array(bytes)]).stream(), bytes.byteLength, core.DEFAULT_LIMITS);
  }));
  expect(actual).toBe(core.serializeReport(core.applyBudget(core.compare(before, after), 0)));
  const cli = spawnSync(process.execPath, ['packages/cli/dist/main.js', 'diff', example('before'), example('after'), '--format', 'json', '--max-unpacked-growth', '0'], { encoding: 'utf8' });
  expect(cli.status, cli.stderr).toBe(1);
  expect(actual).toBe(cli.stdout);
  const parsed = JSON.parse(actual);
  expect(parsed.schemaVersion).toBe(1);
  expect(parsed.budget).toBe('fail');
  expect(parsed.unpackedDelta).toBeGreaterThan(18 * 1024 * 1024 - 1024);
  expect(actual).not.toContain('127.0.0.1');
});

test('replacement clears stale output and clean follow-up removes after-side target warnings', async ({ page }) => {
  await page.goto(basePath);
  await choosePair(page);
  await compare(page);
  await page.getByLabel('After archive').setInputFiles(example('clean'));
  await expect(page.getByRole('heading', { name: 'Review summary' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download JSON' })).toHaveCount(0);
  await compare(page);
  await expect(page.getByText('No missing local targets in the after archive.')).toBeVisible();
});

test('invalid bytes and invalid budget never leave partial success', async ({ page }) => {
  await page.goto(basePath);
  await choosePair(page);
  await page.getByLabel('Growth budget in bytes').fill('1.5');
  await page.getByRole('button', { name: 'Compare archives', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('whole number');
  await page.getByLabel('Growth budget in bytes').fill('');
  await page.getByLabel('After archive').setInputFiles({ name: 'broken.tgz', mimeType: 'application/gzip', buffer: Buffer.from('broken') });
  await page.getByRole('button', { name: 'Compare archives', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review summary' })).toHaveCount(0);
});

test('analysis cancels and remains usable', async ({ page }) => {
  await page.goto(basePath);
  await choosePair(page);
  await page.getByRole('button', { name: 'Compare archives', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel analysis' }).click();
  await expect(page.getByRole('status')).toContainText('Analysis cancelled');
  await expect(page.getByRole('heading', { name: 'Review summary' })).toHaveCount(0);
  await choosePair(page, 'clean');
  await compare(page);
});

test('loaded application analyzes local files offline without external requests', async ({ page, context }) => {
  const external: string[] = [];
  const violations: string[] = [];
  page.on('console', message => { if (message.type() === 'error' && /Content Security Policy|violates.*directive|Refused to/.test(message.text())) violations.push(message.text()); });
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4317') && !request.url().startsWith('blob:')) external.push(request.url()); });
  await page.goto(basePath);
  await page.waitForLoadState('networkidle');
  await context.setOffline(true);
  await choosePair(page, 'clean');
  await compare(page);
  expect(external).toEqual([]);
  expect(violations).toEqual([]);
});

test('archive names, paths, and manifest scripts remain literal text', async ({ page }) => {
  let dialog = false;
  page.on('dialog', async event => { dialog = true; await event.dismiss(); });
  await page.goto(basePath);
  await page.getByLabel('Before archive').setInputFiles(example('before'));
  await page.getByLabel('After archive').setInputFiles(example('hostile'));
  await compare(page);
  await page.getByLabel('Search file paths').fill('<img');
  await expect(page.locator('tbody')).toContainText('assets/<img onerror=alert(1)>.txt');
  await expect(page.locator('.manifest-list')).toContainText('<img onerror=alert(1)>');
  await expect(page.locator('.results img, .results script')).toHaveCount(0);
  expect(dialog).toBe(false);
});

test('examples demonstrate a finding and its corrected follow-up', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => {
    if (request.url().endsWith('.tgz')) requests.push(new URL(request.url()).pathname);
  });
  await page.goto(basePath);
  await page.getByRole('button', { name: 'Explore an example', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review summary' })).toBeVisible();
  await expect(page.locator('.findings-list')).toContainText('dist/missing.js');
  await page.getByRole('button', { name: 'Compare clean follow-up' }).click();
  await expect(page.getByText('No missing local targets in the after archive.')).toBeVisible();
  await expect(page.locator('.primary-measurement .exact-value')).toHaveText('−18,874,372 B');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const download = await downloadEvent;
  const followup = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(followup.unpackedDelta).toBe(-18_874_372);
  expect(followup.before.entries.some((entry: { path: string }) => entry.path.startsWith('fixtures/'))).toBe(true);
  expect(followup.fileDeltas.filter((entry: { kind: string; path: string }) => entry.kind === 'removed' && entry.path.startsWith('fixtures/'))).toHaveLength(2);
  expect(requests.sort()).toEqual(['before', 'after', 'after', 'clean'].map(name => `${basePath}examples/${name}.tgz`).sort());
  const notices = page.getByRole('link', { name: 'Licenses & notices' });
  await expect(notices).toHaveAttribute('href', `${basePath}THIRD_PARTY_NOTICES.md`);
  expect(await (await page.request.get((await notices.getAttribute('href'))!)).text()).toContain('# Third-party notices');
});

test('keyboard controls and narrow layout remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(basePath);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to comparison' })).toBeFocused();
  await page.keyboard.press('Enter');
  await choosePair(page, 'clean');
  await compare(page);
  await page.getByRole('button', { name: /^Unchanged \(/ }).click();
  await page.getByLabel('Search file paths').focus();
  await page.keyboard.type('dist/');
  await expect(page.locator('tbody')).toContainText('dist/');
  await page.getByRole('button', { name: 'Download JSON' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Download JSON' })).toBeInViewport();
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
});

test('swapping archives clears the old review and reverses the measured change', async ({ page }) => {
  await page.goto(basePath);
  await expect(page.getByRole('button', { name: 'Swap archives' })).toBeDisabled();
  await choosePair(page);
  await compare(page);
  await expect(page.locator('.primary-measurement .exact-value')).toHaveText('+18,874,372 B');
  await page.getByRole('button', { name: 'Swap archives' }).click();
  await expect(page.getByRole('heading', { name: 'Review summary' })).toHaveCount(0);
  await compare(page);
  await expect(page.locator('.primary-measurement .exact-value')).toHaveText('−18,874,372 B');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const downloaded = JSON.parse(await readFile((await (await downloadEvent).path())!, 'utf8'));
  expect(downloaded.before.unpackedBytes).toBe(18_875_059);
  expect(downloaded.after.unpackedBytes).toBe(687);
});

test('budget presets set exact bytes and invalidate an earlier report', async ({ page }) => {
  await page.goto(basePath);
  await choosePair(page);
  const presets = page.getByRole('group', { name: 'Budget presets' });
  await presets.getByRole('button', { name: '1 MiB', exact: true }).click();
  await expect(page.getByLabel('Growth budget in bytes')).toHaveValue('1048576');
  await compare(page);
  await expect(page.getByText('Budget exceeded', { exact: true })).toBeVisible();
  await presets.getByRole('button', { name: 'None', exact: true }).click();
  await expect(page.getByLabel('Growth budget in bytes')).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Review summary' })).toHaveCount(0);
  await compare(page);
  await expect(page.getByText('No budget set', { exact: true })).toBeVisible();
});

test('category and change filters compose and can be cleared', async ({ page }) => {
  await page.goto(basePath);
  await choosePair(page);
  await compare(page);
  const category = page.getByRole('button', { name: 'Filter files by tests and fixtures', exact: true });
  await expect(category).toHaveAccessibleDescription('2 paths +18.00 MiB');
  await category.click();
  await expect(category).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('tbody')).toContainText('fixtures/training-a.bin');
  await page.getByRole('button', { name: /^Removed \(/ }).click();
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.getByText('No paths match these filters.')).toBeVisible();
  await page.getByRole('button', { name: /^Added \(/ }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear category filter' }).click();
  await expect(category).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: /^Unchanged \(/ }).click();
  await page.getByLabel('Search file paths').fill('dist/');
  await expect(page.locator('tbody')).toContainText('dist/');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const report = JSON.parse(await readFile((await (await downloadEvent).path())!, 'utf8'));
  expect(report.unpackedDelta).toBe(18_874_372);
  expect(report.fileDeltas.some((file: { path: string }) => file.path === 'fixtures/training-a.bin')).toBe(true);
});

test('x-ray preview preserves a review until its selected example is analyzed', async ({ page }) => {
  await page.goto(basePath);
  const preview = page.getByRole('region', { name: 'Release example preview' });
  await expect(preview).toContainText('Synthetic example');
  await expect(preview.getByRole('button', { name: 'Added fixtures', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Explore an example', exact: true }).click();
  await expect(page.locator('.primary-measurement .exact-value')).toHaveText('+18,874,372 B');
  await preview.getByRole('button', { name: 'Clean follow-up preview', exact: true }).click();
  await expect(preview.getByRole('button', { name: 'Clean follow-up preview', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.primary-measurement .exact-value')).toHaveText('+18,874,372 B');
  await preview.getByRole('button', { name: 'Review this example', exact: true }).click();
  await expect(page.locator('.primary-measurement .exact-value')).toHaveText('−18,874,372 B');
  await expect(page.getByText('No missing local targets in the after archive.')).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const report = JSON.parse(await readFile((await (await downloadEvent).path())!, 'utf8'));
  expect(report.unpackedDelta).toBe(-18_874_372);
  expect(report.findings.filter((finding: { side: string; code: string }) => finding.side === 'after' && finding.code === 'MISSING_LITERAL_TARGET')).toHaveLength(0);
});
