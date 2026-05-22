/**
 * Retry logic with exponential backoff for LLM API calls.
 */

export interface RetryOptions {
  maxRetries?: number;       // Maximum number of retry attempts
  baseDelay?: number;        // Base delay in ms (doubles each retry)
  maxDelay?: number;         // Maximum delay cap in ms
  jitter?: boolean;          // Add random jitter to prevent thundering herd
  retryableErrors?: number[]; // HTTP status codes to retry
}

const DEFAULT_RETRYABLE = [429, 500, 502, 503, 504];

/**
 * Determine if an error is retryable based on its message.
 */
export function isRetryableError(error: any, retryableStatuses: number[] = DEFAULT_RETRYABLE): boolean {
  const message = String(error?.message || error || '').toLowerCase();

  // Network errors
  if (
    message.includes('enotfound') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('socket hang up') ||
    message.includes('network') ||
    message.includes('fetch failed')
  ) {
    return true;
  }

  // HTTP status codes
  for (const status of retryableStatuses) {
    if (message.includes(String(status))) return true;
  }

  // Rate limit keywords
  if (message.includes('rate limit') || message.includes('too many requests')) {
    return true;
  }

  // Server-side errors
  if (message.includes('internal server') || message.includes('bad gateway') || message.includes('service unavailable')) {
    return true;
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and optional jitter.
 */
export function calculateDelay(attempt: number, options: RetryOptions = {}): number {
  const { baseDelay = 1000, maxDelay = 30000, jitter = true } = options;
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, maxDelay);
  const jitterValue = jitter ? Math.random() * cappedDelay * 0.3 : 0;
  return cappedDelay + jitterValue;
}

/**
 * Sleep for a given duration in milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with retry and exponential backoff.
 * Returns the result of the first successful attempt.
 * Throws the last error if all retries are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 3 } = options;
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Don't retry non-retryable errors (auth, bad request, etc.)
      if (!isRetryableError(error)) {
        throw error;
      }

      // Don't retry if we've exhausted attempts
      if (attempt >= maxRetries) {
        throw new Error(`All ${maxRetries} retries exhausted. Last error: ${error.message || String(error)}`);
      }

      const delay = calculateDelay(attempt, options);
      await sleep(delay);
    }
  }

  throw lastError;
}
