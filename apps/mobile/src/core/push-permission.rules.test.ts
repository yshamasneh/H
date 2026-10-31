import assert from "node:assert/strict";
import { test } from "node:test";
import { planPushPermission } from "./push-permission.rules";

test("store audit L4: an unasked permission gets the JOVO explainer first", () => {
  assert.equal(planPushPermission({ granted: false, status: "undetermined", canAskAgain: true }), "explain-then-ask");
});

test("granted or permanently denied never shows an explainer", () => {
  assert.equal(planPushPermission({ granted: true, status: "granted" }), "granted");
  assert.equal(planPushPermission({ granted: false, status: "denied", canAskAgain: false }), "denied");
  assert.equal(planPushPermission({ granted: false, status: "denied", canAskAgain: true }), "ask");
});
