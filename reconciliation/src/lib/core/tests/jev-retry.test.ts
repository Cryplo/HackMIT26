import test from 'node:test';
import assert from 'node:assert/strict';
import { JevRateLimitError, retryDelayMs, withJevRateLimitRetries } from '../jev-retry';

test('Retry-After seconds and dates take precedence; invalid headers use exponential jitter', () => {
  const now = Date.parse('2026-09-20T12:00:00Z');
  assert.equal(retryDelayMs('3', 0, now, 0), 3000);
  assert.equal(retryDelayMs('0', 2, now, 0), 0);
  assert.equal(retryDelayMs('Sun, 20 Sep 2026 12:00:05 GMT', 0, now, 0), 5000);
  assert.equal(retryDelayMs('Sun, 20 Sep 2026 11:59:00 GMT', 0, now, 0), 0);
  assert.equal(retryDelayMs(null, 0, now, 0), 1000);
  assert.equal(retryDelayMs('invalid', 1, now, .5), 2500);
  assert.equal(retryDelayMs(null, 2, now, 0), 4000);
});

test('429 retries stop at four attempts and preserve the final provider error', async () => {
  let calls = 0;
  const error = new JevRateLimitError('PROVIDER_UNAVAILABLE', 'throttled', '0');
  await assert.rejects(withJevRateLimitRetries(async () => { calls++; throw error; }, new AbortController().signal), error);
  assert.equal(calls, 4);
});

test('other errors are not retried', async () => {
  let calls = 0;
  await assert.rejects(withJevRateLimitRetries(async () => { calls++; throw new Error('bad credentials'); }, new AbortController().signal), /bad credentials/);
  assert.equal(calls, 1);
});

test('cancellation interrupts a long provider delay without a second request', async () => {
  const controller = new AbortController(); let calls = 0;
  const result = withJevRateLimitRetries(async () => {
    calls++;
    setTimeout(() => controller.abort(), 5);
    throw new JevRateLimitError('PROVIDER_UNAVAILABLE', 'throttled', '9999999999');
  }, controller.signal);
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(calls, 1);
});
