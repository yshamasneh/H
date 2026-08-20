import assert from "node:assert/strict";
import { test } from "node:test";
import { createRefreshCoordinator, sendWithAuthRetry } from "./auth-retry";

// A minimal localStorage shim so the token-store persistence functions in api.ts can be
// exercised under node:test (jsdom is not part of this workspace).
class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}
(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();

type FakeResponse = { status: number; token: string | undefined };
const statusOf = (response: FakeResponse) => response.status;

test("concurrent 401s share a single refresh (no refresh storm on the admin console)", async () => {
  let calls = 0;
  const refresh = createRefreshCoordinator(async () => {
    calls += 1;
    return "fresh";
  });
  const send = async (token: string | undefined): Promise<FakeResponse> =>
    token === "fresh" ? { status: 200, token } : { status: 401, token };

  const results = await Promise.all(
    ["a", "b", "c"].map((token) =>
      sendWithAuthRetry<FakeResponse>(send, { accessToken: token, refresh, canRefresh: true, statusOf })
    )
  );

  assert.equal(calls, 1);
  assert.ok(results.every((r) => r.response.status === 200 && r.usedToken === "fresh"));
});

test("a 401 refreshes once and replays with the new token", async () => {
  let refreshCalls = 0;
  const { response, usedToken } = await sendWithAuthRetry<FakeResponse>(
    async (token) => (token === "new" ? { status: 200, token } : { status: 401, token }),
    {
      accessToken: "old",
      refresh: async () => {
        refreshCalls += 1;
        return "new";
      },
      canRefresh: true,
      statusOf
    }
  );
  assert.equal(refreshCalls, 1);
  assert.equal(response.status, 200);
  assert.equal(usedToken, "new");
});

test("the refresh token is persisted on sign-in and read back for a refresh", async () => {
  const { storeSession, getRefreshToken, getAccessToken, clearSession } = await import("./api");
  storeSession({
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresInSeconds: 900,
    refreshExpiresInSeconds: 2_592_000,
    user: { id: "a1", fullName: "Admin", phone: "+970590000000", role: "ADMIN" }
  });
  assert.equal(getRefreshToken(), "refresh-1", "refresh token must be persisted, not just the access token");
  assert.equal(getAccessToken(), "access-1");

  clearSession();
  assert.equal(getRefreshToken(), null);
  assert.equal(getAccessToken(), null);
});
