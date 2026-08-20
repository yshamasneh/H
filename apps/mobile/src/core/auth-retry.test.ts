import assert from "node:assert/strict";
import { test } from "node:test";
import { createRefreshCoordinator, sendWithAuthRetry } from "./auth-retry";

type FakeResponse = { status: number; token: string | undefined };
const statusOf = (response: FakeResponse) => response.status;

test("concurrent callers share a single in-flight refresh (no refresh storm)", async () => {
  let calls = 0;
  let release!: (token: string | null) => void;
  const refresh = createRefreshCoordinator(
    () =>
      new Promise<string | null>((resolve) => {
        calls += 1;
        release = resolve;
      })
  );

  const inFlight = [refresh(), refresh(), refresh()];
  release("fresh-token");
  const results = await Promise.all(inFlight);

  assert.equal(calls, 1, "three concurrent callers must trigger exactly one refresh");
  assert.deepEqual(results, ["fresh-token", "fresh-token", "fresh-token"]);
});

test("the coordinator refreshes again after the previous refresh settles", async () => {
  let calls = 0;
  const refresh = createRefreshCoordinator(async () => {
    calls += 1;
    return `token-${calls}`;
  });

  assert.equal(await refresh(), "token-1");
  assert.equal(await refresh(), "token-2");
  assert.equal(calls, 2);
});

test("a non-401 response is returned as-is and never triggers a refresh", async () => {
  let refreshCalls = 0;
  let sends = 0;
  const { response, usedToken } = await sendWithAuthRetry<FakeResponse>(
    async (token) => {
      sends += 1;
      return { status: 200, token };
    },
    {
      accessToken: "t0",
      refresh: async () => {
        refreshCalls += 1;
        return "t1";
      },
      canRefresh: true,
      statusOf
    }
  );

  assert.equal(response.status, 200);
  assert.equal(usedToken, "t0");
  assert.equal(sends, 1);
  assert.equal(refreshCalls, 0);
});

test("a 401 refreshes once and replays the request with the new token", async () => {
  let refreshCalls = 0;
  const tokensSeen: (string | undefined)[] = [];
  const { response, usedToken } = await sendWithAuthRetry<FakeResponse>(
    async (token) => {
      tokensSeen.push(token);
      return token === "fresh" ? { status: 200, token } : { status: 401, token };
    },
    {
      accessToken: "stale",
      refresh: async () => {
        refreshCalls += 1;
        return "fresh";
      },
      canRefresh: true,
      statusOf
    }
  );

  assert.equal(refreshCalls, 1);
  assert.deepEqual(tokensSeen, ["stale", "fresh"]);
  assert.equal(response.status, 200);
  assert.equal(usedToken, "fresh");
});

test("a 401 is returned unchanged when refreshing is not allowed (e.g. the refresh call itself)", async () => {
  let refreshCalls = 0;
  const { response } = await sendWithAuthRetry<FakeResponse>(
    async (token) => ({ status: 401, token }),
    {
      accessToken: "t0",
      refresh: async () => {
        refreshCalls += 1;
        return "t1";
      },
      canRefresh: false,
      statusOf
    }
  );
  assert.equal(response.status, 401);
  assert.equal(refreshCalls, 0);
});

test("a 401 on an unauthenticated request does not refresh", async () => {
  let refreshCalls = 0;
  const { response } = await sendWithAuthRetry<FakeResponse>(
    async (token) => ({ status: 401, token }),
    {
      accessToken: undefined,
      refresh: async () => {
        refreshCalls += 1;
        return "t1";
      },
      canRefresh: true,
      statusOf
    }
  );
  assert.equal(response.status, 401);
  assert.equal(refreshCalls, 0);
});

test("when refresh fails (returns null) the original 401 is surfaced, no replay", async () => {
  let sends = 0;
  const { response, usedToken } = await sendWithAuthRetry<FakeResponse>(
    async (token) => {
      sends += 1;
      return { status: 401, token };
    },
    {
      accessToken: "stale",
      refresh: async () => null,
      canRefresh: true,
      statusOf
    }
  );
  assert.equal(response.status, 401);
  assert.equal(usedToken, "stale");
  assert.equal(sends, 1, "no replay when there is no fresh token");
});

test("many requests that 401 at once refresh only once between them", async () => {
  let refreshCalls = 0;
  const refresh = createRefreshCoordinator(async () => {
    refreshCalls += 1;
    return "shared-fresh";
  });
  const send = async (token: string | undefined): Promise<FakeResponse> =>
    token === "shared-fresh" ? { status: 200, token } : { status: 401, token };

  const results = await Promise.all(
    ["a", "b", "c", "d"].map((token) =>
      sendWithAuthRetry<FakeResponse>(send, { accessToken: token, refresh, canRefresh: true, statusOf })
    )
  );

  assert.equal(refreshCalls, 1, "four concurrent 401s share one refresh");
  assert.ok(results.every((r) => r.response.status === 200 && r.usedToken === "shared-fresh"));
});
