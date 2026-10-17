import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

// npm's exact-version metadata, tarball, and installation packuments can
// propagate separately. All reads share one deadline. A successful packument
// is retried only while its target version is absent, never when it disagrees
// with the exact-version metadata or reviewed archive.
export function createRegistryFetcher({
  timeoutMs = 600_000,
  initialDelayMs = 1_000,
  maxDelayMs = 15_000,
  requestTimeoutMs = 30_000,
  onRetry = () => {},
} = {}) {
  assert(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 600_000, 'timeoutMs must be an integer from 1 to 600000');
  for (const [name, value] of Object.entries({ initialDelayMs, maxDelayMs, requestTimeoutMs })) {
    assert(Number.isInteger(value) && value > 0, `${name} must be a positive integer`);
  }
  const started = performance.now();
  const deadline = started + timeoutMs;
  const requests = [];

  async function read(url, kind, { accept, ready = () => true, pending } = {}) {
    const requestStarted = performance.now();
    const record = { url: String(url), accept: accept ?? '*/*', attempts: 0, retries: 0, elapsedMs: 0 };
    requests.push(record);
    let lastError;
    try {
      for (;;) {
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw new Error(`Public npm registry propagation deadline (${timeoutMs}ms) exceeded for ${url}`, { cause: lastError });
        record.attempts += 1;
        record.retries = record.attempts - 1;
        let retryAfterMs = 0;
        let completed = false;
        let value;
        try {
          const response = await fetch(url, {
            cache: 'no-store',
            redirect: 'manual',
            headers: accept === undefined ? undefined : { accept },
            signal: AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, Math.ceil(remaining)))),
          });
          if (response.status === 200) {
            value = kind === 'json' ? await response.json() : Buffer.from(await response.arrayBuffer());
            completed = true;
          } else {
            const error = new Error(`Public npm registry returned HTTP ${response.status} for ${url}`);
            // A broken error-response body must not turn a terminal status
            // such as 401/403 into a retryable transport error.
            await response.body?.cancel().catch(() => {});
            if (response.status !== 404 && response.status !== 429 && (response.status < 500 || response.status > 599)) throw error;
            lastError = error;
            const retryAfter = response.headers.get('retry-after');
            if (retryAfter !== null) {
              const seconds = Number(retryAfter);
              const delay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(retryAfter) - Date.now();
              if (Number.isFinite(delay)) retryAfterMs = Math.max(0, delay);
            }
          }
        } catch (error) {
          if (!(error instanceof TypeError) && !['AbortError', 'TimeoutError'].includes(error.name)) throw error;
          lastError = error;
        }
        // Keep semantic checks outside the transport catch. Invalid metadata
        // must fail immediately even if validation raises a TypeError.
        if (completed) {
          if (ready(value)) return value;
          lastError = new Error(pending);
        }
        const remainingAfterRequest = deadline - performance.now();
        if (remainingAfterRequest <= 0) continue;
        const backoff = Math.min(maxDelayMs, initialDelayMs * 2 ** Math.min(record.attempts - 1, 30));
        const intendedDelayMs = Math.max(backoff, retryAfterMs);
        const delayMs = Math.min(remainingAfterRequest, intendedDelayMs);
        onRetry({ url: String(url), attempt: record.attempts, delayMs: Math.ceil(delayMs), reason: lastError.message });
        await sleep(Math.ceil(delayMs));
        // Timers may wake fractionally early. If the next permitted attempt
        // already exceeded our budget, never let that wake issue a request
        // before Retry-After or extend the shared propagation deadline.
        if (intendedDelayMs >= remainingAfterRequest) {
          throw new Error(`Public npm registry propagation deadline (${timeoutMs}ms) exceeded for ${url}`, { cause: lastError });
        }
      }
    } finally {
      record.elapsedMs = Math.round(performance.now() - requestStarted);
    }
  }

  return {
    json: (url) => read(url, 'json', { accept: 'application/json' }),
    bytes: (url) => read(url, 'bytes'),
    packument: (url, expected, { accept = 'application/vnd.npm.install-v1+json' } = {}) => read(url, 'json', {
      accept,
      pending: `Public npm packument does not yet include ${expected.name}@${expected.version}`,
      ready: (packument) => {
        assert(packument && typeof packument === 'object' && !Array.isArray(packument), 'Public npm packument must be an object');
        assert.equal(packument.name, expected.name, 'Packument name must match exact-version metadata');
        assert(packument.versions && typeof packument.versions === 'object' && !Array.isArray(packument.versions), 'Packument versions must be an object');
        if (!Object.hasOwn(packument.versions, expected.version)) return false;
        const published = packument.versions[expected.version];
        assert(published && typeof published === 'object' && !Array.isArray(published), 'Packument version must be an object');
        assert.equal(published.name, expected.name, 'Packument version name must match exact-version metadata');
        assert.equal(published.version, expected.version, 'Packument version must match exact-version metadata');
        assert(published.dist && typeof published.dist === 'object', 'Packument version dist must be an object');
        assert.equal(published.dist.tarball, expected.dist.tarball, 'Packument tarball must match exact-version metadata');
        assert.equal(published.dist.integrity, expected.dist.integrity, 'Packument integrity must match exact-version metadata');
        return true;
      },
    }),
    receipt: () => ({ timeoutMs, elapsedMs: Math.round(performance.now() - started), requests: structuredClone(requests) }),
  };
}
