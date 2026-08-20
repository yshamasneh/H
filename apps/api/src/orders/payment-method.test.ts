import assert from "node:assert/strict";
import { test } from "node:test";
import { orderPaymentMethodValues } from "./orders.dto";

// TC-186 — Payment is CASH-only; there is no card/online-payment path to log, store, or send.
test("the order API validates CASH as the only accepted payment method (TC-186)", () => {
  assert.deepEqual([...orderPaymentMethodValues], ["CASH"]);
  // Guards against a future addition silently widening the payment surface.
  assert.equal(orderPaymentMethodValues.length, 1);
});
