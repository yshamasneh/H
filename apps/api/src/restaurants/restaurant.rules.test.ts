import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidTimeOfDay, isWithinWeeklyHours } from "./restaurant.rules";

const at = (hours: number, minutes = 0) => new Date(2026, 0, 1, hours, minutes);

test("a store with no schedule is never time-restricted", () => {
  assert.equal(isWithinWeeklyHours(null, null, at(3)), true);
  assert.equal(isWithinWeeklyHours("09:00", null, at(3)), true);
  assert.equal(isWithinWeeklyHours(null, "22:00", at(3)), true);
});

test("a normal daytime window opens inclusively and closes exclusively", () => {
  assert.equal(isWithinWeeklyHours("09:00", "22:00", at(9, 0)), true);
  assert.equal(isWithinWeeklyHours("09:00", "22:00", at(12)), true);
  assert.equal(isWithinWeeklyHours("09:00", "22:00", at(8, 59)), false);
  assert.equal(isWithinWeeklyHours("09:00", "22:00", at(22, 0)), false);
});

test("a window whose close is before its open spans midnight", () => {
  assert.equal(isWithinWeeklyHours("18:00", "02:00", at(23)), true);
  assert.equal(isWithinWeeklyHours("18:00", "02:00", at(1)), true);
  assert.equal(isWithinWeeklyHours("18:00", "02:00", at(3)), false);
  assert.equal(isWithinWeeklyHours("18:00", "02:00", at(17, 59)), false);
});

test("a zero-length window is always closed", () => {
  assert.equal(isWithinWeeklyHours("10:00", "10:00", at(10)), false);
});

test("time-of-day validation accepts HH:mm and rejects the rest", () => {
  assert.equal(isValidTimeOfDay("00:00"), true);
  assert.equal(isValidTimeOfDay("23:59"), true);
  assert.equal(isValidTimeOfDay("24:00"), false);
  assert.equal(isValidTimeOfDay("9:00"), false);
  assert.equal(isValidTimeOfDay("09:60"), false);
  assert.equal(isValidTimeOfDay(""), false);
});
