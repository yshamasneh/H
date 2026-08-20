import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "./api-error";
import {
  fetchWithTimeout,
  isTransientError,
  retryPolicyFor,
  runWithRetry
} from "./http-retry";

const noSleep = async () => {};
const errors = {
  timeout: () => new ApiError(0, "TIMEOUT", "timed out"),
  network: () => new ApiError(0, "NETWORK_ERROR", "offline")
};

// --- policy: only idempotent GETs are auto-retried ---------------------------------

test("retryPolicyFor gives GETs a retry budget and mutations none", () => {
  assert.equal(retryPolicyFor("GET").maxAttempts, 3);
  assert.equal(retryPolicyFor("get").maxAttempts, 3);
  assert.equal(retryPolicyFor("POST").maxAttempts, 1);
  assert.equal(retryPolicyFor("PATCH").maxAttempts, 1);
  assert.equal(retryPolicyFor("DELETE").maxAttempts, 1);
});

test("only timeouts / network errors are treated as transient", () => {
  assert.equal(isTransientError(new ApiError(0, "TIMEOUT", "x")), true);
  assert.equal(isTransientError(new ApiError(0, "NETWORK_ERROR", "x")), true);
  assert.equal(isTransientError(new ApiError(500, "API_ERROR", "x")), false);
  assert.equal(isTransientError(new ApiError(401, "UNAUTHORIZED", "x")), false);
  assert.equal(isTransientError(new Error("boom")), false);
});

// --- runWithRetry ------------------------------------------------------------------

test("a GET that fails transiently once then succeeds is retried and returns the result", async () => {
  let calls = 0;
  const result = await runWithRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw new ApiError(0, "NETWORK_ERROR", "flaky");
      return "ok";
    },
    retryPolicyFor("GET"),
    noSleep
  );
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("a non-idempotent mutation is NOT auto-retried on a transient failure", async () => {
  let calls = 0;
  await assert.rejects(
    runWithRetry(
      async () => {
        calls += 1;
        throw new ApiError(0, "NETWORK_ERROR", "flaky");
      },
      retryPolicyFor("POST"),
      noSleep
    ),
    (error: unknown) => error instanceof ApiError && error.code === "NETWORK_ERROR"
  );
  assert.equal(calls, 1, "a POST must run exactly once — no dedup key means no safe replay");
});

test("a non-transient error (HTTP 500) is not retried even for a GET", async () => {
  let calls = 0;
  await assert.rejects(
    runWithRetry(
      async () => {
        calls += 1;
        throw new ApiError(500, "API_ERROR", "server error");
      },
      retryPolicyFor("GET"),
      noSleep
    ),
    (error: unknown) => error instanceof ApiError && error.statusCode === 500
  );
  assert.equal(calls, 1);
});

test("retries are hard-capped: a persistently timing-out GET stops after maxAttempts", async () => {
  let calls = 0;
  const backoffs: number[] = [];
  const policy = retryPolicyFor("GET");
  await assert.rejects(
    runWithRetry(
      async () => {
        calls += 1;
        throw new ApiError(0, "TIMEOUT", "still hung");
      },
      policy,
      async (ms) => {
        backoffs.push(ms);
      }
    ),
    (error: unknown) => error instanceof ApiError && error.code === "TIMEOUT"
  );
  assert.equal(calls, 3, "exactly maxAttempts total calls — no runaway loop");
  assert.deepEqual(backoffs, [300, 600], "exponential backoff between the 2 retries");
});

// --- fetchWithTimeout --------------------------------------------------------------

test("a hung request aborts and rejects with a TIMEOUT ApiError", async () => {
  // A fetch that never resolves on its own — it only settles when the signal aborts.
  const hangingFetch = ((_input: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as unknown as typeof fetch;

  await assert.rejects(
    fetchWithTimeout(hangingFetch, "https://x/test", {}, 30, errors),
    (error: unknown) => error instanceof ApiError && error.code === "TIMEOUT"
  );
});

test("a resolving fetch passes its response straight through", async () => {
  const okFetch = (async () => ({ status: 200 }) as Response) as unknown as typeof fetch;
  const response = await fetchWithTimeout(okFetch, "https://x/test", {}, 1000, errors);
  assert.equal(response.status, 200);
});

test("a transport failure (not a timeout) becomes a NETWORK_ERROR ApiError", async () => {
  const failingFetch = (async () => {
    throw new TypeError("Network request failed");
  }) as unknown as typeof fetch;
  await assert.rejects(
    fetchWithTimeout(failingFetch, "https://x/test", {}, 1000, errors),
    (error: unknown) => error instanceof ApiError && error.code === "NETWORK_ERROR"
  );
});

// --- combined: timeout-retry composed with a 401-refresh doesn't runaway -----------

test("combined GET timeout + eventual 401-then-success stays within the attempt cap", async () => {
  // Model the composed behaviour: runWithRetry wraps an inner op that itself may do the
  // auth-retry's one 401 replay. We assert total inner sends are bounded, never unbounded.
  let sends = 0;
  const policy = retryPolicyFor("GET"); // 3 attempts max
  const result = await runWithRetry(
    async (attempt) => {
      // Attempt 1: times out. Attempt 2: the (single) 401 replay inside then succeeds.
      if (attempt === 1) {
        sends += 1;
        throw new ApiError(0, "TIMEOUT", "hung");
      }
      sends += 2; // original 401 + one refreshed replay (what sendWithAuthRetry would do)
      return "ok";
    },
    policy,
    noSleep
  );
  assert.equal(result, "ok");
  assert.ok(sends <= policy.maxAttempts * 2, "total sends bounded by attempts × (1 request + 1 replay)");
  assert.equal(sends, 3);
});
