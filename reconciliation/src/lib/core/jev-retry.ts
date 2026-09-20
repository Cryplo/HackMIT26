import { setTimeout as sleep } from 'node:timers/promises';
import { CoreError } from './validation';

/** Only explicit throttling is retryable; validation, auth and network errors are not. */
export class JevRateLimitError extends CoreError {
  constructor(code: string, message: string, readonly retryAfter: string | null) {
    super(code, message, 503);
  }
}

export function retryDelayMs(header: string | null, retry: number, now = Date.now(), random = Math.random()) {
  const value = header?.trim();
  if (value) {
    if (/^\d+(\.\d+)?$/.test(value)) {
      const ms = Number(value) * 1000;
      if (Number.isFinite(ms)) return ms;
    } else {
      const date = Date.parse(value);
      if (Number.isFinite(date)) return Math.max(0, date - now);
    }
  }
  return Math.min(8000, 1000 * 2 ** retry) * (1 + random * .5);
}

export async function withJevRateLimitRetries<T>(attempt: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let retry = 0; ; retry++) {
    signal.throwIfAborted();
    try { return await attempt(); }
    catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof JevRateLimitError) || retry >= 3) throw error;
      let remaining = retryDelayMs(error.retryAfter, retry);
      // Long provider delays must not overflow Node's timer and trigger an early retry.
      do {
        const chunk = Math.min(remaining, 60_000);
        await sleep(chunk, undefined, { signal });
        remaining -= chunk;
      } while (remaining > 0);
    }
  }
}
