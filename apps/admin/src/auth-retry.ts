/**
 * Pure, dependency-injected "refresh the token on a 401 and replay once" coordination for
 * the admin web client — the counterpart to the mobile app's core/auth-retry.ts. Kept free
 * of `import.meta` / `localStorage` / `fetch` so it can be unit-tested directly
 * (auth-retry.test.ts); api.ts wires it to `fetch` and the localStorage-backed token store.
 */

/** Collapses concurrent refresh attempts into one shared in-flight call (no refresh storm). */
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
  accessToken?: string;
  refresh: () => Promise<string | null>;
  canRefresh: boolean;
  statusOf: (response: T) => number;
};

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
    return { response: first, usedToken: options.accessToken };
  }

  const second = await send(refreshedToken);
  return { response: second, usedToken: refreshedToken };
}
