import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiException } from "../common/api.exception";
import { LoginAttemptLimiter } from "./login-attempt-limiter";

const phone = "+970590000001";

function limiter(overrides: Partial<ConstructorParameters<typeof LoginAttemptLimiter>[0]> = {}) {
  let now = 1_000_000;
  const sleeps: number[] = [];
  const instance = new LoginAttemptLimiter({
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...overrides
  });
  return {
    instance,
    sleeps,
    advance: (ms: number) => {
      now += ms;
    }
  };
}

function blocked(retryAfterSeconds?: number) {
  return (error: unknown) =>
    error instanceof ApiException &&
    error.getStatus() === 429 &&
    (error.getResponse() as { code: string }).code === "LOGIN_TEMPORARILY_BLOCKED" &&
    (retryAfterSeconds === undefined ||
      (error.getResponse() as { details: { retryAfterSeconds: number } }).details.retryAfterSeconds === retryAfterSeconds);
}

describe("LoginAttemptLimiter", () => {
  it("allows the first five failures from one IP, then backs off exponentially", async () => {
    const { instance, advance } = limiter();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await instance.beforeAttempt(phone, "1.1.1.1");
      instance.recordFailure(phone, "1.1.1.1");
    }
    await instance.beforeAttempt(phone, "1.1.1.1");
    instance.recordFailure(phone, "1.1.1.1"); // fifth failure: 1 s backoff starts
    await assert.rejects(instance.beforeAttempt(phone, "1.1.1.1"), blocked(1));
    advance(1_001);
    await instance.beforeAttempt(phone, "1.1.1.1");
    instance.recordFailure(phone, "1.1.1.1"); // sixth: 2 s
    await assert.rejects(instance.beforeAttempt(phone, "1.1.1.1"), blocked(2));
    advance(2_001);
    instance.recordFailure(phone, "1.1.1.1"); // seventh: 4 s
    await assert.rejects(instance.beforeAttempt(phone, "1.1.1.1"), blocked(4));
  });

  it("caps the backoff at fifteen minutes, so it is never a permanent lock", async () => {
    const { instance, advance } = limiter();
    for (let attempt = 0; attempt < 40; attempt += 1) instance.recordFailure(phone, "1.1.1.1");
    await assert.rejects(instance.beforeAttempt(phone, "1.1.1.1"), blocked(15 * 60));
    advance(15 * 60_000 + 1);
    await instance.beforeAttempt(phone, "1.1.1.1");
  });

  it("does not block the same account from a different IP", async () => {
    const { instance } = limiter();
    for (let attempt = 0; attempt < 9; attempt += 1) instance.recordFailure(phone, "6.6.6.6");
    await assert.rejects(instance.beforeAttempt(phone, "6.6.6.6"), blocked());
    await instance.beforeAttempt(phone, "2.2.2.2");
  });

  it("slows, but never refuses, an account attacked from many IPs", async () => {
    const { instance, sleeps } = limiter();
    for (let attempt = 0; attempt < 13; attempt += 1) instance.recordFailure(phone, `10.0.0.${attempt}`);
    await instance.beforeAttempt(phone, "2.2.2.2");
    assert.deepEqual(sleeps, [2_000]); // 13 failures, 10 free: 250 ms * 2^3
    for (let attempt = 0; attempt < 20; attempt += 1) instance.recordFailure(phone, `10.0.1.${attempt}`);
    await instance.beforeAttempt(phone, "2.2.2.2");
    assert.equal(sleeps.at(-1), 4_000);
  });

  it("forgets failures after the window and on a successful login", async () => {
    const { instance, sleeps, advance } = limiter();
    for (let attempt = 0; attempt < 12; attempt += 1) instance.recordFailure(phone, "1.1.1.1");
    instance.recordSuccess(phone, "1.1.1.1");
    await instance.beforeAttempt(phone, "1.1.1.1");
    assert.deepEqual(sleeps, []);

    for (let attempt = 0; attempt < 4; attempt += 1) instance.recordFailure(phone, "1.1.1.1");
    advance(15 * 60_000 + 1);
    instance.recordFailure(phone, "1.1.1.1"); // a fresh window: this is failure one, not five
    await instance.beforeAttempt(phone, "1.1.1.1");
  });

  it("keeps a bounded number of keys", async () => {
    const { instance } = limiter({ maxEntries: 3 });
    for (let attempt = 0; attempt < 6; attempt += 1) instance.recordFailure(phone, "1.1.1.1");
    for (const other of ["+970590000002", "+970590000003", "+970590000004"]) instance.recordFailure(other, "1.1.1.1");
    // The oldest key was evicted, so its backoff is gone rather than memory growing without bound.
    await instance.beforeAttempt(phone, "1.1.1.1");
  });
});
