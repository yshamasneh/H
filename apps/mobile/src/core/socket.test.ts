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

test("on reconnect the subscription re-joins the room and refetches exactly once", () => {
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
  let pending: { fn: () => void } | null = null;
  const timers = {
    set: (fn: () => void) => {
      pending = { fn };
      return pending;
    },
    clear: (handle: unknown) => {
      if (pending === handle) pending = null;
    }
  };

  const cleanup = attachOrderSubscription(fakeSocket as never, "order-1", (payload) => changes.push(payload), {
    resync: { timers }
  });

  const subscribeCount = () => emitted.filter((entry) => entry.event === "order.subscribe").length;
  assert.equal(subscribeCount(), 1, "subscribes once on attach");

  const connect = handlers.get("connect")!;
  connect(undefined); // initial connection → no refetch (screen already loaded)
  assert.equal(pending, null);
  assert.equal(changes.length, 0);

  connect(undefined); // reconnect → schedules a resync
  assert.notEqual(pending, null);
  pending!.fn(); // debounce elapses
  assert.equal(subscribeCount(), 2, "re-joins the room on reconnect");
  assert.equal(changes.length, 1, "refetches exactly once");

  cleanup();
  assert.equal(handlers.size, 0);
});
