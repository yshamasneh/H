import { ApiError } from "./api-error";

/**
 * Timeout + bounded-retry primitives for the mobile API client (M-2). Pure and
 * dependency-injected (no react-native / i18n imports) so the policy and control flow can
 * be unit-tested directly — `request()` in api.ts wires these to real `fetch`, an
 * `AbortController`, and the localized error messages. Composes with the H-2
 * refresh-on-401 wrapper (`auth-retry.ts`): timeouts/network errors are *thrown* and drive
 * the retry here; a 401 comes back as a *Response* and is handled there, so the two never
 * compound into a runaway loop.
 */

/** Errors worth retrying: a timeout or a transport-level network failure — never an HTTP 4xx/5xx. */
export function isTransientError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === "TIMEOUT" || error.code === "NETWORK_ERROR");
}

export type RetryPolicy = {
  /** Total attempts including the first (so 1 = no retry). */
  maxAttempts: number;
  isRetryable: (error: unknown) => boolean;
  /** Delay before the retry that follows `attempt` (1-indexed). */
  backoffMs: (attempt: number) => number;
};

/**
 * The retry budget for a request. Only idempotent GETs are auto-retried: no mutation in
 * this app carries an idempotency key (order creation's dedup — M-1 — is out of scope), so
 * blindly replaying a POST/PATCH/DELETE could double-apply it.
 */
export function retryPolicyFor(
  method: string,
  options: { maxGetAttempts?: number; baseBackoffMs?: number } = {}
): RetryPolicy {
  const maxGetAttempts = options.maxGetAttempts ?? 3;
  const baseBackoffMs = options.baseBackoffMs ?? 300;
  const idempotent = method.toUpperCase() === "GET";
  return {
    maxAttempts: idempotent ? maxGetAttempts : 1,
    isRetryable: isTransientError,
    backoffMs: (attempt) => baseBackoffMs * 2 ** (attempt - 1)
  };
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `operation`, retrying transient failures per `policy` with a hard cap of
 * `policy.maxAttempts` total calls. `sleep` is injectable so tests don't wait on real time.
 */
export async function runWithRetry<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  sleep: (ms: number) => Promise<void> = realSleep
): Promise<T> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= policy.maxAttempts || !policy.isRetryable(error)) throw error;
      await sleep(policy.backoffMs(attempt));
    }
  }
}

export type TimeoutErrorFactories = {
  /** Built when the request is aborted by the timeout. */
  timeout: () => ApiError;
  /** Built for any other transport failure (DNS, connection reset, offline, …). */
  network: () => ApiError;
};

/**
 * Wraps a single fetch attempt in an `AbortController` timeout. On timeout it throws the
 * `timeout` ApiError (code `TIMEOUT`); any other transport error becomes the `network`
 * ApiError (code `NETWORK_ERROR`). Both are transient, so `runWithRetry` will retry them
 * for a GET. `fetchFn` is injectable for tests.
 */
export async function fetchWithTimeout(
  fetchFn: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
  errors: TimeoutErrorFactories
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw errors.timeout();
    throw errors.network();
  } finally {
    clearTimeout(timer);
  }
}
