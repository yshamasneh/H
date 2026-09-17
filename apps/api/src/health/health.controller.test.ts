import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiException } from "../common/api.exception";
import { HealthController } from "./health.controller";

function responseOf(error: unknown): Record<string, unknown> {
  assert.ok(error instanceof ApiException);
  return error.getResponse() as Record<string, unknown>;
}

test("all required accounts present: readiness passes", async () => {
  const prisma = { $queryRaw: async () => [{ ok: 1 }] };
  const partners = { validate: async () => ({ ready: true, issues: [] }), logInvalid: () => {} };
  const controller = new HealthController(prisma as never, partners as never);
  assert.equal((await controller.ready()).status, "ready");
  assert.equal((await controller.health()).database, "connected");
});

test("required account missing: liveness passes and readiness returns a sanitized failure", async () => {
  const prisma = { $queryRaw: async () => [{ ok: 1 }] };
  const logged: string[][] = [];
  const partners = {
    validate: async () => ({ ready: false, issues: [{ code: "MISSING_REQUIRED_ACCOUNT", key: "OWNER_A" }] }),
    logInvalid: (codes: string[]) => logged.push(codes)
  };
  const controller = new HealthController(prisma as never, partners as never);

  assert.equal(controller.live().status, "alive");
  await assert.rejects(controller.ready(), (error) => {
    const response = responseOf(error);
    assert.equal(response.code, "FINANCIAL_REFERENCE_DATA_NOT_READY");
    const serialized = JSON.stringify(response);
    assert.doesNotMatch(serialized, /OWNER_A|Mohammad|amount|balance/i);
    return true;
  });
  assert.deepEqual(logged, [["MISSING_REQUIRED_ACCOUNT"]]);
});

test("database unavailable: liveness remains healthy and existing readiness failure is preserved", async () => {
  let validationCalled = false;
  const prisma = { $queryRaw: async () => { throw new Error("connection contains private details"); } };
  const partners = {
    validate: async () => { validationCalled = true; return { ready: true, issues: [] }; },
    logInvalid: () => {}
  };
  const controller = new HealthController(prisma as never, partners as never);

  assert.equal(controller.live().status, "alive");
  await assert.rejects(controller.ready(), (error) => {
    const response = responseOf(error);
    assert.equal(response.code, "SERVICE_NOT_READY");
    assert.doesNotMatch(JSON.stringify(response), /private details/);
    return true;
  });
  assert.equal(validationCalled, false);
});

test("correcting the invariant makes readiness recover on the next request", async () => {
  let ready = false;
  const prisma = { $queryRaw: async () => [{ ok: 1 }] };
  const partners = {
    validate: async () => ({ ready, issues: ready ? [] : [{ code: "REQUIRED_ACCOUNT_INACTIVE" }] }),
    logInvalid: () => {}
  };
  const controller = new HealthController(prisma as never, partners as never);

  await assert.rejects(controller.ready());
  ready = true;
  assert.equal((await controller.ready()).status, "ready");
});
