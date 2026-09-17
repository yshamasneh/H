import assert from "node:assert/strict";
import { test } from "node:test";
import { DeferredEmitter } from "./deferred-emitter";
import { FakeRealtimeGateway } from "./testing/fake-realtime-gateway";

test("queued events do not reach the gateway until flush is called", () => {
  const gateway = new FakeRealtimeGateway();
  const emitter = new DeferredEmitter(gateway);

  emitter.emitToUser("user-1", "notification.created", { id: "n1" });
  emitter.emitToOrder("order-1", "order.status.changed", { status: "ACCEPTED" });
  assert.equal(gateway.emitted.length, 0);

  emitter.flush();
  assert.deepEqual(gateway.emitted, [
    { room: "user:user-1", event: "notification.created", payload: { id: "n1" } },
    { room: "order:order-1", event: "order.status.changed", payload: { status: "ACCEPTED" } }
  ]);
});

test("events are discarded when flush is never reached, as happens on a rolled-back transaction", () => {
  const gateway = new FakeRealtimeGateway();
  const emitter = new DeferredEmitter(gateway);

  try {
    emitter.emitToUser("user-1", "notification.created", { id: "n1" });
    throw new Error("the surrounding transaction failed");
  } catch {
    // The caller flushes only after `$transaction` resolves, so a throw skips the flush.
  }

  assert.equal(gateway.emitted.length, 0);
});

test("flush is idempotent so a queued event is never delivered twice", () => {
  const gateway = new FakeRealtimeGateway();
  const emitter = new DeferredEmitter(gateway);

  emitter.emitToAdmins("order.created", { orderId: "o1" });
  emitter.flush();
  emitter.flush();

  assert.equal(gateway.emitted.length, 1);
});

test("every emit method the domain services use is buffered", () => {
  const gateway = new FakeRealtimeGateway();
  const emitter = new DeferredEmitter(gateway);

  emitter.emitToUser("u", "e", null);
  emitter.emitToRestaurant("r", "e", null);
  emitter.emitToOrder("o", "e", null);
  emitter.emitToAdmins("e", null);
  assert.equal(gateway.emitted.length, 0);

  emitter.flush();
  assert.deepEqual(
    gateway.emitted.map((entry) => entry.room),
    ["user:u", "restaurant:r", "order:o", "admins"]
  );
});
