import { describe, it, expect } from 'vitest';
import { isRetryableError, calculateDelay, withRetry } from '../src/core/llm/retry.js';

describe('Retry – isRetryableError', () => {
  it('should retry on 429 errors', () => {
    expect(isRetryableError(new Error('Request failed with status 429'))).toBe(true);
  });

  it('should retry on 5xx errors', () => {
    expect(isRetryableError(new Error('internal server error 500'))).toBe(true);
    expect(isRetryableError(new Error('bad gateway 502'))).toBe(true);
    expect(isRetryableError(new Error('service unavailable 503'))).toBe(true);
  });

  it('should not retry on 400/401/403/404', () => {
    expect(isRetryableError(new Error('bad request 400'))).toBe(false);
    expect(isRetryableError(new Error('unauthorized 401'))).toBe(false);
    expect(isRetryableError(new Error('forbidden 403'))).toBe(false);
    expect(isRetryableError(new Error('not found 404'))).toBe(false);
  });

  it('should retry on network errors', () => {
    expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
    expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
  });
});

describe('Retry – calculateDelay', () => {
  it('should use exponential backoff', () => {
    const d0 = calculateDelay(0, { baseDelay: 100, maxDelay: 10000 });
    const d1 = calculateDelay(1, { baseDelay: 100, maxDelay: 10000 });
    const d2 = calculateDelay(2, { baseDelay: 100, maxDelay: 10000 });
    // Should grow: ~100, ~200, ~400 (with jitter)
    expect(d0).toBeGreaterThanOrEqual(50);
    expect(d0).toBeLessThanOrEqual(200);
    expect(d1).toBeGreaterThanOrEqual(100);
    expect(d2).toBeGreaterThanOrEqual(200);
  });

  it('should not exceed maxDelay plus jitter', () => {
    const d = calculateDelay(20, { baseDelay: 100, maxDelay: 5000 });
    // jitter adds up to 30%, so max = 5000 * 1.3 = 6500
    expect(d).toBeLessThanOrEqual(6500);
  });
});

describe('Retry – withRetry', () => {
  it('should succeed on first try', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => { attempts++; return 'ok'; },
      { maxRetries: 3, baseDelay: 10, maxDelay: 100 },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(1);
  });

  it('should retry on failure then succeed', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error('internal server error 500');
        return 'ok';
      },
      { maxRetries: 5, baseDelay: 10, maxDelay: 50 },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('should throw after max retries', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => { attempts++; throw new Error('internal server error 500'); },
        { maxRetries: 2, baseDelay: 10, maxDelay: 50 },
      ),
    ).rejects.toBeDefined();
    expect(attempts).toBe(3); // 1 initial + 2 retries
  });
});
