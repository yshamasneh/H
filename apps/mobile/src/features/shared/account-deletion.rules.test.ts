import assert from "node:assert/strict";
import { test } from "node:test";
import { canSelfDelete, formatDeletionDate } from "./account-deletion.rules";

test("customers, drivers and store staff can delete in the app; administrators cannot", () => {
  assert.equal(canSelfDelete("CUSTOMER"), true);
  assert.equal(canSelfDelete("DRIVER"), true);
  assert.equal(canSelfDelete("RESTAURANT"), true);
  assert.equal(canSelfDelete("ADMIN"), false);
});

test("the scheduled date is readable and an invalid value never throws", () => {
  assert.match(formatDeletionDate("2026-12-01T10:00:00.000Z", "en"), /2026/);
  assert.equal(formatDeletionDate("not-a-date", "en"), "not-a-date");
});
