import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { syncBuiltinESMExports } from 'node:module';
import promiseTimers from 'node:timers/promises';
import test from 'node:test';
import { createRegistryFetcher } from './registry-fetch.mjs';

async function serve(t, respond) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, headers: request.headers });
    respond(request, response, requests.length);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

const fast = { timeoutMs: 2_000, initialDelayMs: 10, maxDelayMs: 20, requestTimeoutMs: 500 };
const expectedVersion = {
  name: '@example/release-lens',
  version: '1.2.3',
  dist: { tarball: 'https://registry.npmjs.org/@example/release-lens/-/release-lens-1.2.3.tgz', integrity: 'sha512-reviewed-archive-integrity' },
};

test('waits for a successful compact packument to expose the exact version before checking the ordinary packument', async (t) => {
  let compactAttempts = 0;
  const { url, requests } = await serve(t, (request, response) => {
    if (request.url === '/compact') compactAttempts += 1;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      name: '@example/release-lens',
      versions: request.url === '/compact' && compactAttempts === 1 ? {} : { '1.2.3': expectedVersion },
    }));
  });
  const registry = createRegistryFetcher(fast);
  const compact = await registry.packument(`${url}/compact`, expectedVersion);
  const ordinary = await registry.packument(`${url}/full`, expectedVersion, { accept: 'application/json' });
  assert.equal(compact.versions['1.2.3'].version, '1.2.3');
  assert.equal(ordinary.versions['1.2.3'].version, '1.2.3');
  assert.equal(compactAttempts, 2);
  assert.deepEqual(requests.map(({ headers }) => headers.accept), ['application/vnd.npm.install-v1+json', 'application/vnd.npm.install-v1+json', 'application/json']);
  assert(requests.every(({ headers }) => headers.authorization === undefined && headers.cookie === undefined));
  assert.deepEqual(registry.receipt().requests.map(({ attempts }) => attempts), [2, 1]);
});

for (const [field, value] of [
  ['name', { ...expectedVersion, name: '@example/other' }],
  ['version', { ...expectedVersion, version: '1.2.2' }],
  ['tarball', { ...expectedVersion, dist: { ...expectedVersion.dist, tarball: 'https://registry.npmjs.org/other.tgz' } }],
  ['integrity', { ...expectedVersion, dist: { ...expectedVersion.dist, integrity: 'sha512-wrong-archive-integrity' } }],
]) {
  test(`does not retry a present packument version with mismatched ${field}`, async (t) => {
    const { url, requests } = await serve(t, (_request, response) => {
      response.end(JSON.stringify({ name: '@example/release-lens', versions: { '1.2.3': value } }));
    });
    await assert.rejects(createRegistryFetcher(fast).packument(url, expectedVersion), new RegExp(field, 'iu'));
    assert.equal(requests.length, 1);
  });
}

test('does not retry an invalid successful packument response', async (t) => {
  const { url, requests } = await serve(t, (_request, response) => {
    response.end('{"name":"@example/release-lens","versions":null}');
  });
  await assert.rejects(createRegistryFetcher(fast).packument(url, expectedVersion), /versions/iu);
  assert.equal(requests.length, 1);
});

test('does not wait for a missing version when the packument identifies a different package', async (t) => {
  const { url, requests } = await serve(t, (_request, response) => {
    response.end('{"name":"@example/other","versions":{}}');
  });
  await assert.rejects(createRegistryFetcher(fast).packument(url, expectedVersion), /name/iu);
  assert.equal(requests.length, 1);
});

test('bounds repeated successful packuments that still omit the target version', async (t) => {
  const { url, requests } = await serve(t, (_request, response) => {
    response.end('{"name":"@example/release-lens","versions":{}}');
  });
  const registry = createRegistryFetcher({ ...fast, timeoutMs: 200 });
  const started = performance.now();
  await assert.rejects(registry.packument(url, expectedVersion), /deadline|timed out/iu);
  assert(performance.now() - started < 1_000);
  assert(requests.length >= 2);
});

test('waits for missing metadata and a rate-limited tarball using anonymous requests', async (t) => {
  let metadataAttempts = 0;
  let tarballAttempts = 0;
  const { url, requests } = await serve(t, (request, response) => {
    if (request.url === '/metadata') {
      metadataAttempts += 1;
      response.writeHead(metadataAttempts === 1 ? 404 : 200, { 'content-type': 'application/json' });
      response.end(metadataAttempts === 1 ? '{}' : '{"version":"1.2.3"}');
    } else {
      tarballAttempts += 1;
      response.writeHead(tarballAttempts === 1 ? 429 : 200, { 'retry-after': '0' });
      response.end(tarballAttempts === 1 ? 'try later' : 'reviewed archive bytes');
    }
  });
  const registry = createRegistryFetcher(fast);
  assert.deepEqual(await registry.json(`${url}/metadata`), { version: '1.2.3' });
  assert.equal((await registry.bytes(`${url}/tarball`)).toString(), 'reviewed archive bytes');
  assert.equal(metadataAttempts, 2);
  assert.equal(tarballAttempts, 2);
  assert(requests.every(({ headers }) => headers.authorization === undefined && headers.cookie === undefined));
  assert.deepEqual(registry.receipt().requests.map(({ attempts }) => attempts), [2, 2]);
});

test('recovers from a service error and a disconnected network response', async (t) => {
  const { url, requests } = await serve(t, (request, response, attempt) => {
    if (attempt === 1) response.writeHead(503).end('unavailable');
    else if (attempt === 2) request.socket.destroy();
    else response.end('available');
  });
  assert.equal((await createRegistryFetcher(fast).bytes(url)).toString(), 'available');
  assert.equal(requests.length, 3);
});

for (const status of [400, 401, 403, 302]) {
  test(`fails immediately on terminal HTTP ${status}`, async (t) => {
    const { url, requests } = await serve(t, (_request, response) => {
      response.writeHead(status, { location: '/elsewhere' }).end('terminal');
    });
    await assert.rejects(createRegistryFetcher(fast).bytes(url), new RegExp(`HTTP ${status}`));
    assert.equal(requests.length, 1);
  });
}

test('does not retry malformed successful metadata', async (t) => {
  const { url, requests } = await serve(t, (_request, response) => response.end('{broken-json'));
  await assert.rejects(createRegistryFetcher(fast).json(url), SyntaxError);
  assert.equal(requests.length, 1);
});

test('returns successful bytes once so an integrity mismatch cannot become a retry', async (t) => {
  const { url, requests } = await serve(t, (_request, response) => response.end('wrong archive bytes'));
  const actual = await createRegistryFetcher(fast).bytes(url);
  assert.notEqual(actual.toString(), 'reviewed archive bytes');
  assert.equal(requests.length, 1);
});

test('stops polling at a single shared deadline for metadata and tarball', async (t) => {
  const { url, requests } = await serve(t, (request, response) => {
    if (request.url === '/metadata' && requests.length < 3) response.writeHead(404).end();
    else if (request.url === '/metadata') response.end('{"version":"1.2.3"}');
    else response.writeHead(404).end();
  });
  const registry = createRegistryFetcher({ ...fast, timeoutMs: 300, initialDelayMs: 50, maxDelayMs: 50 });
  const started = performance.now();
  assert.deepEqual(await registry.json(`${url}/metadata`), { version: '1.2.3' });
  await assert.rejects(registry.bytes(`${url}/tarball`), /deadline|timed out/iu);
  const elapsed = performance.now() - started;
  assert(elapsed >= 270 && elapsed < 1_500, `The shared 300ms budget took ${elapsed}ms`);
  assert(requests.filter(({ url: path }) => path === '/tarball').length < 6);
});

test('bounds a stalled HTTP response and retries it within the overall deadline', async (t) => {
  const { url, requests } = await serve(t, (_request, _response) => {});
  const registry = createRegistryFetcher({ ...fast, timeoutMs: 200, requestTimeoutMs: 30 });
  const started = performance.now();
  await assert.rejects(registry.bytes(url), /deadline|timed out/iu);
  assert(performance.now() - started < 1_000);
  assert(requests.length >= 2);
});

test('does not extend the deadline for Retry-After and validates the bounded timeout', async (t) => {
  const { url, requests } = await serve(t, (_request, response) => {
    response.writeHead(429, { 'retry-after': '3600' }).end();
  });
  const started = performance.now();
  await assert.rejects(createRegistryFetcher({ ...fast, timeoutMs: 200 }).bytes(url), /deadline|timed out/iu);
  assert(performance.now() - started < 1_000);
  assert.equal(requests.length, 1);
  for (const timeoutMs of [0, -1, NaN, 600_001, 1.5]) {
    assert.throws(() => createRegistryFetcher({ timeoutMs }), /timeoutMs/);
  }
});

test('never retries before Retry-After when a capped deadline timer wakes early', async (t) => {
  const { url, requests } = await serve(t, (_request, response) => {
    response.writeHead(429, { 'retry-after': '3600' }).end();
  });
  const earlyTimer = t.mock.method(promiseTimers, 'setTimeout', async () => {});
  syncBuiltinESMExports();
  t.after(() => {
    earlyTimer.mock.restore();
    syncBuiltinESMExports();
  });
  const registry = createRegistryFetcher({ ...fast, timeoutMs: 200 });
  let failure;
  await assert.rejects(registry.bytes(url), (error) => {
    failure = error;
    assert.match(error.message, /deadline/iu);
    return true;
  });
  assert.equal(requests.length, 1, 'A Retry-After beyond the remaining budget must prohibit another request');
  assert.match(failure.cause.message, /HTTP 429/u);
});
