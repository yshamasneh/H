import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canSubmitNewAdmin,
  countsTowardCustomerTotals,
  formatMinorExact,
  hasAdminPermission,
  pageCount,
  usersListQuery
} from "./users.rules";

test("the customer list asks only for customers and ignores any role filter", () => {
  assert.deepEqual(usersListQuery("customers", { role: "ADMIN", search: " 0599 ", page: 2 }), {
    audience: "CUSTOMERS",
    search: "0599",
    page: 2,
    pageSize: 20
  });
});

test("the staff list asks for staff, narrowed to a staff role, never to customers", () => {
  assert.deepEqual(usersListQuery("staff", { role: "DRIVER", search: "", page: 1 }), {
    audience: "STAFF",
    role: "DRIVER",
    search: undefined,
    page: 1,
    pageSize: 20
  });
  assert.equal(usersListQuery("staff", { role: "CUSTOMER", page: 1 }).role, undefined);
  assert.equal(usersListQuery("staff", { role: "ALL", page: 1 }).role, undefined);
});

test("page count never drops below one", () => {
  assert.equal(pageCount(0), 1);
  assert.equal(pageCount(20), 1);
  assert.equal(pageCount(21), 2);
});

test("permissions follow the API: super admin holds all, others only what they were granted", () => {
  assert.equal(hasAdminPermission(null, "VIEW_ALL_ORDERS"), false);
  assert.equal(hasAdminPermission({ isSuperAdmin: true, permissions: [] }, "VIEW_ALL_ORDERS"), true);
  assert.equal(hasAdminPermission({ isSuperAdmin: false, permissions: ["MANAGE_USERS"] }, "VIEW_ALL_ORDERS"), false);
  assert.equal(
    hasAdminPermission({ isSuperAdmin: false, permissions: ["MANAGE_USERS", "VIEW_ALL_ORDERS"] }, "VIEW_ALL_ORDERS"),
    true
  );
});

test("only DELIVERED orders count toward a customer's totals", () => {
  assert.equal(countsTowardCustomerTotals("DELIVERED"), true);
  for (const status of ["PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "CANCELLED", "REJECTED", "DELIVERY_FAILED"]) {
    assert.equal(countsTowardCustomerTotals(status), false, status);
  }
});

test("amounts are formatted from whole agorot without float drift", () => {
  // 34.23 + 53.95 + 28.00 from the API's hand-computed example.
  assert.equal(formatMinorExact(11618), "116.18 ILS");
  assert.equal(formatMinorExact(3423), "34.23 ILS");
  assert.equal(formatMinorExact(0), "0.00 ILS");
  assert.equal(formatMinorExact(5), "0.05 ILS");
  assert.equal(formatMinorExact(-455), "-4.55 ILS");
  // 1.15 * 100 is 114.99999… in floating point; integer formatting never goes near that.
  assert.equal(formatMinorExact(115), "1.15 ILS");
  assert.equal(formatMinorExact(900719925474099), "9007199254740.99 ILS");
  assert.throws(() => formatMinorExact(1.5));
});

test("the create-admin form needs a name, a number and an 8+ character password", () => {
  assert.equal(canSubmitNewAdmin({ fullName: "Sara", phoneNumber: "0599000000", password: "12345678" }), true);
  assert.equal(canSubmitNewAdmin({ fullName: " ", phoneNumber: "0599000000", password: "12345678" }), false);
  assert.equal(canSubmitNewAdmin({ fullName: "Sara", phoneNumber: "", password: "12345678" }), false);
  assert.equal(canSubmitNewAdmin({ fullName: "Sara", phoneNumber: "0599000000", password: "1234567" }), false);
});
