import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countsTowardCustomerTotals,
  customerDetailPath,
  parseUserSection,
  usersListQuery
} from "./users-sections";

test("the section comes from the URL and defaults to customers", () => {
  assert.equal(parseUserSection("staff"), "staff");
  assert.equal(parseUserSection("customers"), "customers");
  for (const other of [null, undefined, "", "STAFF", "admins"]) {
    assert.equal(parseUserSection(other), "customers", String(other));
  }
});

test("the customer list asks only for customers and ignores any role filter", () => {
  assert.deepEqual(usersListQuery("customers", { role: "ADMIN", search: " 0599 ", page: 2, pageSize: 20 }), {
    audience: "CUSTOMERS",
    search: "0599",
    page: 2,
    pageSize: 20
  });
});

test("the staff list asks for staff, narrowed to a staff role, never to customers", () => {
  assert.deepEqual(usersListQuery("staff", { role: "DRIVER", search: "", page: 1, pageSize: 20 }), {
    audience: "STAFF",
    role: "DRIVER",
    search: undefined,
    page: 1,
    pageSize: 20
  });
  assert.equal(usersListQuery("staff", { role: "CUSTOMER", page: 1, pageSize: 20 }).role, undefined);
  assert.equal(usersListQuery("staff", { role: "", page: 1, pageSize: 20 }).role, undefined);
});

test("customer detail paths are encoded", () => {
  assert.equal(customerDetailPath("0b7c"), "/users/customers/0b7c");
  assert.equal(customerDetailPath("a/b"), "/users/customers/a%2Fb");
});

test("only DELIVERED orders count toward a customer's totals", () => {
  assert.equal(countsTowardCustomerTotals("DELIVERED"), true);
  for (const status of ["PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "CANCELLED", "REJECTED", "DELIVERY_FAILED"]) {
    assert.equal(countsTowardCustomerTotals(status), false, status);
  }
});
