/**
 * Pure, dependency-injected coordination for "refresh the access token on a 401 and
 * replay the request once". Kept free of react-native / fetch / SecureStore imports so
 * it can be unit-tested directly (see auth-retry.test.ts) — the real `request()` in
 * api.ts wires these helpers to `fetch` and the SecureStore-backed session.
 */

/**
 * Wraps a token-refresh function so that any number of concurrent callers share a
 * single in-flight refresh instead of each firing their own — the fix for the
 * "refresh storm" when several requests 401 at the same moment.
 */
export function createRefreshCoordinator(
  refreshFn: () => Promise<string | null>
): () => Promise<string | null> {
  let inFlight: Promise<string | null> | null = null;
  return function refresh(): Promise<string | null> {
    if (!inFlight) {
      inFlight = refreshFn().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}

export type AuthRetryOptions<T> = {
  /** The access token the caller started with (undefined for unauthenticated calls). */
  accessToken?: string;
  /** Shared refresh coordinator; called at most once per 401. */
  refresh: () => Promise<string | null>;
  /**
   * Whether a 401 is allowed to trigger a refresh+replay. False for the refresh
   * endpoint itself and for calls that carried no token, so we never recurse.
   */
  canRefresh: boolean;
  /** How to read the HTTP status off whatever `send` resolves to. */
  statusOf: (response: T) => number;
};

/**
 * Sends a request; if it comes back 401 and refreshing is allowed, refreshes the token
 * once and replays the request with the new token. Returns the final response and the
 * token that was ultimately used. Never refreshes more than once per call.
 */
export async function sendWithAuthRetry<T>(
  send: (accessToken: string | undefined) => Promise<T>,
  options: AuthRetryOptions<T>
): Promise<{ response: T; usedToken: string | undefined }> {
  const first = await send(options.accessToken);
  if (options.statusOf(first) !== 401 || !options.canRefresh || options.accessToken === undefined) {
    return { response: first, usedToken: options.accessToken };
  }

  const refreshedToken = await options.refresh();
  if (!refreshedToken) {
    // Refresh could not produce a new token (network failure, or the refresh token was
    // itself rejected and the session cleared). Hand the original 401 back to the caller.
    return { response: first, usedToken: options.accessToken };
  }

  const second = await send(refreshedToken);
  return { response: second, usedToken: refreshedToken };
}
