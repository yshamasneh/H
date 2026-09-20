import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicUser } from "./api";
import {
  attachNotificationResponseHandlers,
  NotificationOrderNavigator,
  type NotificationResponseLike
} from "./notification-navigation";

const orderId = "11111111-1111-4111-8111-111111111111";
const customer: PublicUser = { id: "customer-1", fullName: "Sara", phone: "+970590000000", role: "CUSTOMER" };

function response(overrides: {
  id?: unknown;
  type?: unknown;
  relatedEntityId?: unknown;
  actionIdentifier?: unknown;
} = {}): NotificationResponseLike {
  return {
    actionIdentifier: overrides.actionIdentifier ?? "expo.modules.notifications.actions.DEFAULT",
    notification: {
      request: {
        identifier: overrides.id ?? "notification-1",
        content: {
          data: {
            type: overrides.type ?? "ORDER_STATUS_CHANGED",
            relatedEntityId: overrides.relatedEntityId ?? orderId
          }
        }
      }
    }
  };
}

function harness(canAccess = true) {
  const screens: Array<{ name: string; orderId?: string }> = [];
  let unavailable = 0;
  const navigator = new NotificationOrderNavigator({
    canAccessOrder: async () => canAccess,
    navigate: (screen) => screens.push(screen as { name: string; orderId?: string }),
    showUnavailable: () => {
      unavailable += 1;
    }
  });
  return { navigator, screens, unavailable: () => unavailable };
}

test("a notification tapped while backgrounded opens the customer order route", async () => {
  const { navigator, screens } = harness();
  await navigator.setSession({ accessToken: "access", user: customer });
  let liveListener!: (item: NotificationResponseLike) => void;
  const cleanup = attachNotificationResponseHandlers(
    {
      addNotificationResponseReceivedListener: (listener) => {
        liveListener = listener;
        return { remove() {} };
      },
      getLastNotificationResponseAsync: async () => null
    },
    (item) => navigator.handleResponse(item)
  );
  liveListener(response());
  await new Promise((resolve) => setImmediate(resolve));
  cleanup();
  assert.deepEqual(screens, [{ name: "order-detail", user: customer, orderId }]);
});

test("the cold-start API response waits for restoration and then opens the order", async () => {
  const { navigator, screens } = harness();
  const coldResponse = response({ id: "cold-start-1" });
  const cleanup = attachNotificationResponseHandlers(
    {
      addNotificationResponseReceivedListener: () => ({ remove() {} }),
      getLastNotificationResponseAsync: async () => coldResponse
    },
    (item) => navigator.handleResponse(item)
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(screens.length, 0);
  await navigator.setSession({ accessToken: "access", user: customer });
  cleanup();
  assert.deepEqual(screens, [{ name: "order-detail", user: customer, orderId }]);
});

test("a cold-start response waits for session restoration before navigating", async () => {
  const { navigator, screens } = harness();
  assert.equal(await navigator.handleResponse(response({ id: "waiting-1" })), "queued");
  assert.equal(screens.length, 0);
  await navigator.setSession({ accessToken: "access", user: customer });
  assert.equal(screens.length, 1);
  assert.equal(screens[0].orderId, orderId);
});

test("the exact payload order ID is passed to authorization and navigation", async () => {
  let authorizedOrderId: string | null = null;
  const screens: Array<{ orderId?: string }> = [];
  const navigator = new NotificationOrderNavigator({
    canAccessOrder: async (_session, nextOrderId) => {
      authorizedOrderId = nextOrderId;
      return true;
    },
    navigate: (screen) => screens.push(screen as { orderId?: string }),
    showUnavailable() {}
  });
  await navigator.setSession({ accessToken: "access", user: customer });
  await navigator.handleResponse(response({ relatedEntityId: orderId }));
  assert.equal(authorizedOrderId, orderId);
  assert.equal(screens[0].orderId, orderId);
});

test("business and admin users are routed to their existing order-detail screens", async () => {
  for (const [role, expectedName] of [
    ["RESTAURANT", "restaurant-order-detail"],
    ["ADMIN", "admin-order-detail"]
  ] as const) {
    const user: PublicUser = { ...customer, id: role.toLowerCase(), role };
    const { navigator, screens } = harness();
    await navigator.setSession({ accessToken: "access", user });
    await navigator.handleResponse(response({ id: `notification-${role}` }));
    assert.equal(screens[0]?.name, expectedName);
    assert.equal(screens[0]?.orderId, orderId);
  }
});

test("malformed or missing payloads are ignored", async () => {
  const { navigator, screens, unavailable } = harness();
  await navigator.setSession({ accessToken: "access", user: customer });
  assert.equal(await navigator.handleResponse({}), "ignored");
  assert.equal(await navigator.handleResponse(response({ relatedEntityId: "not-a-uuid" })), "ignored");
  assert.equal(await navigator.handleResponse(response({ id: "" })), "ignored");
  assert.equal(screens.length, 0);
  assert.equal(unavailable(), 0);
});

test("unsupported notification types are ignored", async () => {
  const { navigator, screens } = harness();
  await navigator.setSession({ accessToken: "access", user: customer });
  assert.equal(await navigator.handleResponse(response({ type: "RESTAURANT_APPROVED" })), "ignored");
  assert.equal(screens.length, 0);
});

test("the same response is navigated only once", async () => {
  const { navigator, screens } = harness();
  await navigator.setSession({ accessToken: "access", user: customer });
  assert.equal(await navigator.handleResponse(response()), "navigated");
  assert.equal(await navigator.handleResponse(response()), "duplicate");
  assert.equal(screens.length, 1);
});

test("a logged-out user is never navigated by a notification", async () => {
  const { navigator, screens, unavailable } = harness();
  await navigator.setSession(null);
  assert.equal(await navigator.handleResponse(response()), "logged-out");
  assert.equal(screens.length, 0);
  assert.equal(unavailable(), 0);
});

test("an inaccessible or missing order shows a safe fallback and does not navigate", async () => {
  const { navigator, screens, unavailable } = harness(false);
  await navigator.setSession({ accessToken: "access", user: customer });
  assert.equal(await navigator.handleResponse(response()), "unavailable");
  assert.equal(screens.length, 0);
  assert.equal(unavailable(), 1);
});

test("listener cleanup removes the subscription and ignores a late cold-start result", async () => {
  let removed = 0;
  let deliverLast!: (value: NotificationResponseLike | null) => void;
  let seen = 0;
  const cleanup = attachNotificationResponseHandlers(
    {
      addNotificationResponseReceivedListener: () => ({ remove: () => { removed += 1; } }),
      getLastNotificationResponseAsync: () => new Promise((resolve) => { deliverLast = resolve; })
    },
    () => {
      seen += 1;
    }
  );

  cleanup();
  deliverLast(response());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(removed, 1);
  assert.equal(seen, 0);
});

const driver: PublicUser = { id: "driver-1", fullName: "Omar", phone: "+970590000001", role: "DRIVER" };
const deliveryId = "22222222-2222-4222-8222-222222222222";

test("tapping a delivery alert opens the driver's home, where the waiting deliveries are", async () => {
  const { navigator, screens } = harness();
  await navigator.setSession({ accessToken: "access", user: driver });

  const result = await navigator.handleResponse(
    response({ id: "alert-1", type: "DELIVERY_AVAILABLE", relatedEntityId: deliveryId })
  );

  assert.equal(result, "navigated");
  assert.deepEqual(screens, [{ name: "driver-home", user: driver }]);
});

test("a delivery alert that opened a cold app waits for session restore, then opens the driver's home", async () => {
  const { navigator, screens } = harness();
  const alert = response({ id: "alert-cold", type: "DELIVERY_AVAILABLE", relatedEntityId: deliveryId });

  assert.equal(await navigator.handleResponse(alert), "queued");
  assert.equal(screens.length, 0);
  await navigator.setSession({ accessToken: "access", user: driver });

  assert.deepEqual(screens, [{ name: "driver-home", user: driver }]);
});

test("a delivery alert is ignored for anyone who is not a driver, and is never opened twice", async () => {
  const { navigator, screens } = harness();
  await navigator.setSession({ accessToken: "access", user: customer });
  const alert = response({ id: "alert-2", type: "DELIVERY_AVAILABLE", relatedEntityId: deliveryId });

  assert.equal(await navigator.handleResponse(alert), "ignored");
  assert.equal(await navigator.handleResponse(alert), "duplicate");
  assert.equal(screens.length, 0);
});

test("a delivery alert with a malformed id is rejected rather than trusted", async () => {
  const { navigator, screens } = harness();
  await navigator.setSession({ accessToken: "access", user: driver });

  const result = await navigator.handleResponse(
    response({ id: "alert-3", type: "DELIVERY_AVAILABLE", relatedEntityId: "not-a-uuid" })
  );

  assert.equal(result, "ignored");
  assert.equal(screens.length, 0);
});
