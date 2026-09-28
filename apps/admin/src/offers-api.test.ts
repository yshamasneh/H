import assert from "node:assert/strict";
import { test } from "node:test";
import { adminStoreApi, ownStoreApi } from "./api.business";

/**
 * The offers screens save through the existing product-update endpoints: a store's own under
 * /restaurant/me (where the API checks MANAGE_PRODUCTS + MANAGE_PRICES) and an administrator's under
 * /admin/restaurants/:id (MANAGE_BUSINESSES). The body is just the sale price; null ends the offer.
 */
test("offers save the sale price through the store's own and the admin product endpoints", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: "p1" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    await ownStoreApi.updateMenuItem("p1", { salePriceMinor: 1000 });
    await adminStoreApi("s1").updateMenuItem("p1", { salePriceMinor: null });
    await adminStoreApi("s1").listMenuItems();
  } finally {
    globalThis.fetch = original;
  }
  assert.match(calls[0].url, /\/api\/v1\/restaurant\/me\/menu\/items\/p1$/);
  assert.equal(calls[0].init.method, "PATCH");
  assert.equal(calls[0].init.body, JSON.stringify({ salePriceMinor: 1000 }));
  assert.match(calls[1].url, /\/api\/v1\/admin\/restaurants\/s1\/menu\/items\/p1$/);
  assert.equal(calls[1].init.body, JSON.stringify({ salePriceMinor: null }));
  assert.match(calls[2].url, /\/api\/v1\/admin\/restaurants\/s1\/menu\/items$/);
});
