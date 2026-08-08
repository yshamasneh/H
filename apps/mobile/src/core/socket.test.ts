import assert from "node:assert/strict";
import { test } from "node:test";
import { attachOrderSubscription } from "./order-subscription";

test("order subscriptions join the authorized room and refresh only for its order", () => {
  const emitted: { event: string; payload: unknown }[] = [];
  const handlers = new Map<string, (payload: unknown) => void>();
  const fakeSocket = {
    emit(event: string, payload: unknown) {
      emitted.push({ event, payload });
      return fakeSocket;
    },
    on(event: string, handler: (payload: unknown) => void) {
      handlers.set(event, handler);
      return fakeSocket;
    },
    off(event: string, handler: (payload: unknown) => void) {
      if (handlers.get(event) === handler) handlers.delete(event);
      return fakeSocket;
    }
  };
  const changes: unknown[] = [];

  const cleanup = attachOrderSubscription(fakeSocket as never, "order-1", (payload) => changes.push(payload));

  assert.deepEqual(emitted, [{ event: "order.subscribe", payload: { orderId: "order-1" } }]);
  handlers.get("order.status.changed")?.({ orderId: "order-2" });
  assert.equal(changes.length, 0);
  handlers.get("order.status.changed")?.({ orderId: "order-1", status: "ACCEPTED" });
  handlers.get("order.fulfillment.changed")?.({ orderId: "order-1" });
  handlers.get("order.fulfillment.changed")?.({ orderId: "order-2" });
  handlers.get("delivery.status.changed")?.({ deliveryId: "delivery-1", status: "ASSIGNED" });
  assert.equal(changes.length, 3);

  cleanup();
  assert.equal(handlers.size, 0);
});
