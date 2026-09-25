import assert from "node:assert/strict";
import { test } from "node:test";
import * as copy from "./notification-copy";

const hasArabic = (text: string) => /[؀-ۿ]/.test(text);
const hasLatin = (text: string) => /[A-Za-z]/.test(text);
const bilingual = (text: string) => hasArabic(text) && hasLatin(text);

const failureReasons = ["CUSTOMER_REFUSED", "CUSTOMER_UNREACHABLE", "WRONG_ADDRESS", "BUSINESS_ERROR", "DRIVER_ISSUE", "OTHER"] as const;

test("every fixed notification string is written in both Arabic and English", () => {
  const cases: Array<[string, copy.Copy]> = [
    ["newOrderForBusiness", copy.newOrderForBusiness(1750)],
    ["productDecisionNeeded/replacement", copy.productDecisionNeeded("Milk", true)],
    ["productDecisionNeeded/quantity", copy.productDecisionNeeded("Milk", false)],
    ["fulfillment approved", copy.fulfillmentDecisionForBusiness("APPROVED")],
    ["fulfillment rejected", copy.fulfillmentDecisionForBusiness("REJECTED")],
    ["customer cancel", copy.orderCancelledByCustomerForBusiness()],
    ["admin cancel customer", copy.orderCancelledByAdminForCustomer("reason")],
    ["admin cancel business", copy.orderCancelledByAdminForBusiness("reason")],
    ["driver cancel", copy.deliveryCancelledForDriver()],
    ["delivery available", copy.deliveryAvailable("JOVO MARKET")],
    ["driver assigned", copy.driverAssignedForCustomer()],
    ["restaurant approved", copy.restaurantReview(true, null)],
    ["restaurant rejected", copy.restaurantReview(false, null)],
    ["restaurant rejected + reason", copy.restaurantReview(false, "docs")],
    ["restaurant suspended", copy.restaurantSuspension(true, null)],
    ["restaurant reactivated", copy.restaurantSuspension(false, null)]
  ];
  for (const status of ["ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "REJECTED", "DELIVERED", "CANCELLED", "PLACED"] as const) {
    cases.push([`order ${status}`, copy.orderStatusForCustomer(status, undefined)]);
  }
  for (const status of ["PICKED_UP", "ON_THE_WAY", "DELIVERED", "FAILED", "ASSIGNED"] as const) {
    cases.push([`delivery ${status}`, copy.deliveryStatusForCustomer(status)]);
  }
  for (const status of ["APPROVED", "REJECTED", "SUSPENDED", "PENDING"] as const) {
    cases.push([`driver ${status}`, copy.driverAccountStatus(status, null)]);
  }
  for (const reason of failureReasons) {
    cases.push([`failed/business ${reason}`, copy.deliveryFailedForBusiness(reason)]);
    cases.push([`failed/admin ${reason}`, copy.deliveryFailedForAdmin("ab12cd34", reason)]);
  }
  for (const [name, entry] of cases) {
    assert.ok(bilingual(entry.title), `${name}: title is not bilingual: ${entry.title}`);
    assert.ok(bilingual(entry.body), `${name}: body is not bilingual: ${entry.body}`);
  }
});

test("a failure reason is shown as words, never as the raw enum", () => {
  for (const reason of failureReasons) {
    assert.ok(!copy.deliveryFailedForBusiness(reason).body.includes("_"), reason);
    assert.ok(!copy.deliveryFailedForAdmin("x", reason).body.includes("_"), reason);
  }
  assert.ok(copy.deliveryFailedForBusiness(null).body.length > 0, "a missing reason still reads sensibly");
});

test("operator-typed text is passed through untouched, alongside the translation", () => {
  const rejected = copy.orderStatusForCustomer("REJECTED", "  نفدت الكمية  ");
  assert.ok(rejected.body.includes("نفدت الكمية"));
  assert.ok(hasLatin(rejected.body));
  assert.equal(copy.orderStatusForCustomer("ACCEPTED", "Ready in 20 minutes").body, "Ready in 20 minutes");
});

test("the driver alert's lock-screen text names only the store, never an address", () => {
  const alert = copy.deliveryAvailable("JOVO MARKET");
  assert.ok(alert.body.startsWith("JOVO MARKET"));
});
