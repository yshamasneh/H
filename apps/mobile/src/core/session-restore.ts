import { isUnauthorized } from "./api-error";
import type { PublicUser } from "./api";

/**
 * The decision made at cold launch about a stored session. Extracted from App.tsx into a
 * pure, injectable function so the "when do we clear the tokens?" rule can be unit-tested
 * directly (session-restore.test.ts) — the bug this fixes (H-1) was that a transient
 * network failure at launch was treated the same as a real credential rejection and wiped
 * the session.
 */
export type RestoreResult =
  | { status: "unauthenticated" }
  | { status: "authenticated"; user: PublicUser }
  | { status: "offline"; user: PublicUser | null }
  | { status: "signed-out" };

export type RestoreDeps = {
  getAccessToken: () => Promise<string | null>;
  /** Confirms the session with the server. Goes through `request()`, which itself will
   *  transparently refresh an expired access token on a 401 before this ever sees one. */
  fetchCurrentUser: (accessToken: string) => Promise<PublicUser>;
  /** Last known user, persisted locally, used to stay usable when the server is unreachable. */
  getCachedUser: () => Promise<PublicUser | null>;
  clearTokens: () => Promise<void>;
};

export async function restoreSession(deps: RestoreDeps): Promise<RestoreResult> {
  const accessToken = await deps.getAccessToken();
  if (!accessToken) return { status: "unauthenticated" };

  try {
    const user = await deps.fetchCurrentUser(accessToken);
    return { status: "authenticated", user };
  } catch (error) {
    // Only a 401 means the server actively rejected our credentials (and `request()` has
    // already tried, and failed, to refresh them) — that session is genuinely dead, so
    // clear it and send the user to login.
    //
    // ANY other failure — a NETWORK_ERROR (statusCode 0) from airplane mode / a dropped
    // connection, a 5xx, or a non-ApiError throw — means we simply could not confirm the
    // session this launch. We deliberately KEEP the stored tokens and boot into an offline
    // state (using the cached user if we have one) rather than logging the user out over a
    // transient outage. Do not "simplify" this back to an unconditional clearTokens().
    if (isUnauthorized(error)) {
      await deps.clearTokens();
      return { status: "signed-out" };
    }
    const cachedUser = await deps.getCachedUser().catch(() => null);
    return { status: "offline", user: cachedUser };
  }
}
