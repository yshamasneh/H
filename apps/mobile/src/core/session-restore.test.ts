import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "./api-error";
import { restoreSession, type RestoreDeps } from "./session-restore";
import type { PublicUser } from "./api";

const user: PublicUser = { id: "u1", fullName: "Sara", phone: "+970590000000", role: "CUSTOMER" };

function deps(overrides: Partial<RestoreDeps> & { clearCalls?: { n: number } } = {}): RestoreDeps {
  const clearCalls = overrides.clearCalls ?? { n: 0 };
  return {
    getAccessToken: overrides.getAccessToken ?? (async () => "access-token"),
    fetchCurrentUser: overrides.fetchCurrentUser ?? (async () => user),
    getCachedUser: overrides.getCachedUser ?? (async () => null),
    clearTokens: overrides.clearTokens ?? (async () => { clearCalls.n += 1; })
  };
}

test("no stored access token → unauthenticated, tokens left alone", async () => {
  const clearCalls = { n: 0 };
  const result = await restoreSession(deps({ getAccessToken: async () => null, clearCalls }));
  assert.deepEqual(result, { status: "unauthenticated" });
  assert.equal(clearCalls.n, 0);
});

test("session confirmed → authenticated, tokens left alone", async () => {
  const clearCalls = { n: 0 };
  const result = await restoreSession(deps({ clearCalls }));
  assert.deepEqual(result, { status: "authenticated", user });
  assert.equal(clearCalls.n, 0);
});

test("a genuine 401 clears the session and signs the user out", async () => {
  const clearCalls = { n: 0 };
  const result = await restoreSession(
    deps({
      fetchCurrentUser: async () => {
        throw new ApiError(401, "UNAUTHORIZED", "Session expired");
      },
      clearCalls
    })
  );
  assert.deepEqual(result, { status: "signed-out" });
  assert.equal(clearCalls.n, 1);
});

test("a network error (statusCode 0) KEEPS the tokens and boots offline with the cached user", async () => {
  const clearCalls = { n: 0 };
  const result = await restoreSession(
    deps({
      fetchCurrentUser: async () => {
        throw new ApiError(0, "NETWORK_ERROR", "Cannot connect");
      },
      getCachedUser: async () => user,
      clearCalls
    })
  );
  assert.deepEqual(result, { status: "offline", user });
  assert.equal(clearCalls.n, 0, "a transient network failure must not clear the session");
});

test("offline with no cached user → offline with null user, tokens still kept", async () => {
  const clearCalls = { n: 0 };
  const result = await restoreSession(
    deps({
      fetchCurrentUser: async () => {
        throw new ApiError(0, "NETWORK_ERROR", "Cannot connect");
      },
      clearCalls
    })
  );
  assert.deepEqual(result, { status: "offline", user: null });
  assert.equal(clearCalls.n, 0);
});

test("a non-ApiError throw is treated as offline, not a logout", async () => {
  const clearCalls = { n: 0 };
  const result = await restoreSession(
    deps({
      fetchCurrentUser: async () => {
        throw new Error("boom");
      },
      clearCalls
    })
  );
  assert.equal(result.status, "offline");
  assert.equal(clearCalls.n, 0);
});

test("a 5xx (server error, not 401) keeps the session", async () => {
  const clearCalls = { n: 0 };
  const result = await restoreSession(
    deps({
      fetchCurrentUser: async () => {
        throw new ApiError(503, "SERVICE_UNAVAILABLE", "Down for maintenance");
      },
      clearCalls
    })
  );
  assert.equal(result.status, "offline");
  assert.equal(clearCalls.n, 0);
});
