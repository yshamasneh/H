import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdminDriverView } from "./api";
import {
  driverFilterCounts,
  generateDriverPassword,
  isStrongPassword,
  matchesDriverSearch,
  selectDrivers
} from "./drivers-view";

function driver(overrides: Partial<AdminDriverView>): AdminDriverView {
  return {
    appState: null,
    appLeaseUntil: null,
    appOpen: false,
    userId: "d",
    fullName: "Driver",
    phone: "+970599000111",
    isActive: true,
    status: "APPROVED",
    isOnline: false,
    completedDeliveriesCount: 0,
    activeDeliveryId: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    ...overrides
  };
}

test("search matches name words in any order, Arabic-aware, or digits of the phone", () => {
  const ahmad = driver({ fullName: "أحمد يوسف", phone: "+970599123456" });
  assert.equal(matchesDriverSearch(ahmad, "يوسف احمد"), true);
  assert.equal(matchesDriverSearch(ahmad, "0599123"), true, "a local number with its leading 0");
  assert.equal(matchesDriverSearch(ahmad, "123456"), true);
  assert.equal(matchesDriverSearch(ahmad, "+970 599"), true);
  assert.equal(matchesDriverSearch(ahmad, "سامي"), false);
  assert.equal(matchesDriverSearch(ahmad, "777"), false);
  assert.equal(matchesDriverSearch(ahmad, ""), true);
});

test("filters and ordering: on shift first, then approved, then the rest", () => {
  const drivers = [
    driver({ userId: "s", fullName: "Suspended", status: "SUSPENDED" }),
    driver({ userId: "b", fullName: "Bassam", status: "APPROVED" }),
    driver({ userId: "o", fullName: "Omar", status: "APPROVED", isOnline: true }),
    driver({ userId: "p", fullName: "Pending", status: "PENDING" })
  ];
  assert.deepEqual(selectDrivers(drivers, "all", "").map((row) => row.userId), ["o", "b", "p", "s"]);
  assert.deepEqual(selectDrivers(drivers, "onShift", "").map((row) => row.userId), ["o"]);
  assert.deepEqual(selectDrivers(drivers, "active", "").map((row) => row.userId), ["o", "b"]);
  assert.deepEqual(selectDrivers(drivers, "suspended", "").map((row) => row.userId), ["s"]);
  assert.deepEqual(driverFilterCounts(drivers), { all: 4, onShift: 1, active: 2, suspended: 1, pending: 1, rejected: 0 });
});

test("the password rule is the API's, and generated passwords always meet it", () => {
  assert.equal(isStrongPassword("Strong@123"), true);
  for (const weak of ["alllowercase1!", "NoDigits!!", "NoSymbol123", "Sh0rt!"]) {
    assert.equal(isStrongPassword(weak), false, weak);
  }
  for (let run = 0; run < 200; run += 1) {
    const password = generateDriverPassword();
    assert.equal(password.length, 12);
    assert.equal(isStrongPassword(password), true, password);
    assert.doesNotMatch(password, /[0O1lI]/);
  }
});
