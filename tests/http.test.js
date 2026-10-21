import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, RateLimiter, HttpError } from '../core/http.js';

const json = (status, body) => ({ ok: status < 400, status, headers: new Map(), json: async () => body });

test('returns parsed JSON', async () => {
  const data = await fetchJson('https://x.test/a', { fetchImpl: async () => json(200, { a: 1 }) });
  assert.deepEqual(data, { a: 1 });
});

test('404 is not retried and is flagged as not found', async () => {
  let calls = 0;
  const err = await fetchJson('https://x.test/a', {
    retries: 2,
    fetchImpl: async () => {
      calls++;
      return json(404, {});
    },
  }).catch((e) => e);
  assert.ok(err instanceof HttpError);
  assert.equal(err.isNotFound, true);
  assert.equal(calls, 1);
});

test('5xx is retried', async () => {
  let calls = 0;
  const data = await fetchJson('https://x.test/a', {
    retries: 1,
    fetchImpl: async () => (++calls === 1 ? json(503, {}) : json(200, { ok: true })),
  });
  assert.deepEqual(data, { ok: true });
  assert.equal(calls, 2);
});

test('times out', async () => {
  const err = await fetchJson('https://x.test/a', {
    timeoutMs: 30,
    retries: 0,
    fetchImpl: (url, { signal }) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
  }).catch((e) => e);
  assert.equal(err.kind, 'timeout');
});

test('rate limiter spaces requests to the same host', async () => {
  const limiter = new RateLimiter({ minIntervalMs: 40, maxConcurrent: 1 });
  const starts = [];
  const task = () => {
    starts.push(Date.now());
    return Promise.resolve();
  };
  await Promise.all([limiter.schedule('h', task), limiter.schedule('h', task), limiter.schedule('h', task)]);
  assert.ok(starts[1] - starts[0] >= 35);
  assert.ok(starts[2] - starts[1] >= 35);
});
