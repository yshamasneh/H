import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alertDecision,
  defaultPresenceDurations,
  isAppOpen,
  leaseUntil,
  nextPresence,
  renewedPresence
} from "./presence.rules";

const now = new Date("2026-09-20T12:00:00.000Z");
const at = (secondsFromNow: number) => new Date(now.getTime() + secondsFromNow * 1_000);
const driver = (overrides: Partial<Parameters<typeof alertDecision>[0]> = {}) => ({
  approved: true,
  accountActive: true,
  isOnline: true,
  appLeaseUntil: at(60) as Date | null,
  ...overrides
});

test("online with the app open is alerted", () => {
  assert.equal(alertDecision(driver(), now), "ALERT");
});

test("online with the app closed is not alerted at all, however stale the online flag", () => {
  assert.equal(alertDecision(driver({ appLeaseUntil: null }), now), "APP_CLOSED", "never reported in");
  assert.equal(alertDecision(driver({ appLeaseUntil: at(-1) }), now), "APP_CLOSED", "lease has just run out");
  assert.equal(alertDecision(driver({ appLeaseUntil: at(-86_400) }), now), "APP_CLOSED", "forgot to go offline yesterday");
});

test("offline with the app open is not alerted: going offline stops alerts without closing the app", () => {
  assert.equal(alertDecision(driver({ isOnline: false }), now), "OFFLINE");
});

test("an unapproved or deactivated driver is never alerted", () => {
  assert.equal(alertDecision(driver({ approved: false }), now), "NOT_ELIGIBLE");
  assert.equal(alertDecision(driver({ accountActive: false }), now), "NOT_ELIGIBLE");
});

test("a foreground report buys a short lease and a background report a longer grace", () => {
  const foreground = leaseUntil("FOREGROUND", now, defaultPresenceDurations);
  const background = leaseUntil("BACKGROUND", now, defaultPresenceDurations);
  assert.equal(foreground.getTime() - now.getTime(), 120_000);
  assert.equal(background.getTime() - now.getTime(), 30 * 60_000);
  assert.ok(background > foreground);
});

test("the lease runs out on its own: open just before the deadline, closed at and after it", () => {
  const presence = nextPresence("FOREGROUND", now, defaultPresenceDurations);
  assert.equal(isAppOpen(presence, new Date(now.getTime() + 119_999)), true);
  assert.equal(isAppOpen(presence, new Date(now.getTime() + 120_000)), false);
});

test("a backgrounded app is still alerted through the grace, then stops if it never comes back", () => {
  const presence = nextPresence("BACKGROUND", now, defaultPresenceDurations);
  const minutesLater = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  assert.equal(alertDecision(driver({ appLeaseUntil: presence.appLeaseUntil }), minutesLater(29)), "ALERT");
  assert.equal(alertDecision(driver({ appLeaseUntil: presence.appLeaseUntil }), minutesLater(31)), "APP_CLOSED");
});

test("an explicit close ends the lease at once", () => {
  const closed = nextPresence("CLOSED", now, defaultPresenceDurations);
  assert.deepEqual(closed, { appState: null, appLeaseUntil: null });
  assert.equal(isAppOpen(closed, now), false);
});

test("a location fix renews the lease in whichever state the app last announced", () => {
  const backgrounded = renewedPresence({ appState: "BACKGROUND", appLeaseUntil: at(10) }, now, defaultPresenceDurations);
  assert.equal(backgrounded.appState, "BACKGROUND");
  assert.equal(backgrounded.appLeaseUntil!.getTime() - now.getTime(), 30 * 60_000);
  const fresh = renewedPresence({ appState: null, appLeaseUntil: null }, now, defaultPresenceDurations);
  assert.equal(fresh.appState, "FOREGROUND");
});

test("the durations can be configured", () => {
  const custom = { foregroundLeaseMs: 30_000, backgroundGraceMs: 5 * 60_000 };
  assert.equal(leaseUntil("FOREGROUND", now, custom).getTime() - now.getTime(), 30_000);
  assert.equal(leaseUntil("BACKGROUND", now, custom).getTime() - now.getTime(), 300_000);
});
