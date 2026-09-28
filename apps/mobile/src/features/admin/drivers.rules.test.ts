import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdminDriver } from "../../core/api";
import {
  generateDriverPassword,
  isStrongPassword,
  matchesDriverSearch,
  selectDrivers,
  splitDriverPhone,
  visibleDriverFilters
} from "./drivers.rules";

function driver(overrides: Partial<AdminDriver>): AdminDriver {
  return {
    userId: "d",
    fullName: "Driver",
    phone: "+970599000111",
    isActive: true,
    status: "APPROVED",
    isOnline: false,
    completedDeliveriesCount: 0,
    activeDeliveryId: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides
  };
}

test("search: name words in any order, Arabic-aware, or phone digits with or without the leading 0", () => {
  const ahmad = driver({ fullName: "أحمد يوسف", phone: "+970599123456" });
  assert.equal(matchesDriverSearch(ahmad, "يوسف احمد"), true);
  assert.equal(matchesDriverSearch(ahmad, "0599123"), true);
  assert.equal(matchesDriverSearch(ahmad, "123 456"), true);
  assert.equal(matchesDriverSearch(ahmad, "سامي"), false);
  assert.equal(matchesDriverSearch(ahmad, "0588"), false);
});

test("ordering and filters, with pending/rejected shown only while any exist", () => {
  const drivers = [
    driver({ userId: "s", fullName: "Sam", status: "SUSPENDED" }),
    driver({ userId: "b", fullName: "Bassam" }),
    driver({ userId: "o", fullName: "Omar", isOnline: true })
  ];
  assert.deepEqual(selectDrivers(drivers, "ALL", "").map((row) => row.userId), ["o", "b", "s"]);
  assert.deepEqual(selectDrivers(drivers, "ONLINE", "").map((row) => row.userId), ["o"]);
  assert.deepEqual(visibleDriverFilters(drivers, "ALL"), ["ALL", "ONLINE", "APPROVED", "SUSPENDED"]);
  assert.deepEqual(visibleDriverFilters([...drivers, driver({ status: "PENDING" })], "ALL"), ["ALL", "ONLINE", "APPROVED", "SUSPENDED", "PENDING"]);
});

test("passwords: the API's rule, and generated ones always pass it", () => {
  assert.equal(isStrongPassword("Strong@123"), true);
  assert.equal(isStrongPassword("weakpassword"), false);
  for (let run = 0; run < 200; run += 1) {
    const password = generateDriverPassword();
    assert.equal(isStrongPassword(password), true, password);
    assert.doesNotMatch(password, /[0O1lI]/);
  }
});

test("a stored number splits back into the form's code and local number", () => {
  assert.deepEqual(splitDriverPhone("+970599123456"), { countryCode: "+970", phoneNumber: "0599123456" });
  assert.deepEqual(splitDriverPhone("+972501234567"), { countryCode: "+972", phoneNumber: "0501234567" });
});
