import assert from "node:assert/strict";
import { after, test } from "node:test";
import { isWithinWeeklyHours } from "./restaurant.rules";

/**
 * Opening hours are wall-clock, and the wall clock is the server's.
 *
 * `isWithinWeeklyHours` compares "HH:mm" against `Date#getHours()`, which reads the *process's*
 * local time. That is correct behaviour and deliberately not changed here — but it means the
 * deployment must run on the trading timezone. A container left on UTC (the default for
 * node:22-bookworm-slim) would open and close every store two to three hours late, and nothing
 * would report an error: the store would simply be shut when customers arrived.
 *
 * These tests pin that contract. They run the real function against real UTC instants under two
 * timezones and assert the answers differ, so:
 *
 *  - if someone drops `ENV TZ` from the Dockerfile or the compose file, the "wrong timezone"
 *    cases below document exactly what breaks;
 *  - if the base image ever ships without tzdata, `Asia/Hebron` silently falls back to UTC and
 *    the offset assertions fail loudly rather than the store quietly keeping the wrong hours;
 *  - if the function is ever rewritten to use UTC internally, every assertion here fails.
 *
 * Node re-reads `process.env.TZ` on assignment, and the test runner gives each file its own
 * process, so switching zones here cannot disturb any other suite.
 */

const originalTimeZone = process.env.TZ;
after(() => {
  process.env.TZ = originalTimeZone;
});

function withTimeZone<T>(timeZone: string, body: () => T): T {
  process.env.TZ = timeZone;
  try {
    return body();
  } finally {
    process.env.TZ = originalTimeZone;
  }
}

/** A store trading 07:00 to 23:00 local — the shape JOVO MARKET will actually use. */
const opensAt = "07:00";
const closesAt = "23:00";

/** 07:30 in Palestinian summer time (UTC+3): inside the window, but 04:30 as far as UTC knows. */
const summerMorning = new Date("2026-07-15T04:30:00Z");
/** 23:30 in Palestinian summer time: past closing, but still 20:30 in UTC. */
const summerNight = new Date("2026-07-15T20:30:00Z");
/** 07:30 in Palestinian winter time (UTC+2): inside the window, but 05:30 in UTC. */
const winterMorning = new Date("2026-01-15T05:30:00Z");

test("Asia/Hebron is a real zone in this runtime, at +3 in summer and +2 in winter", () => {
  // If tzdata were missing the zone would silently resolve to UTC and both offsets would be 0.
  // Failing here is the point: that is the misconfiguration this whole file exists to catch.
  withTimeZone("Asia/Hebron", () => {
    assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, "Asia/Hebron");
    assert.equal(summerMorning.getTimezoneOffset(), -180, "Palestine is UTC+3 in July");
    assert.equal(winterMorning.getTimezoneOffset(), -120, "Palestine is UTC+2 in January");
  });
});

test("on Palestinian local time a 07:00-23:00 store keeps the hours it was given", () => {
  withTimeZone("Asia/Hebron", () => {
    assert.equal(summerMorning.getHours(), 7, "04:30Z is 07:30 in Hebron in July");
    assert.equal(isWithinWeeklyHours(opensAt, closesAt, summerMorning), true);

    assert.equal(summerNight.getHours(), 23, "20:30Z is 23:30 in Hebron in July");
    assert.equal(isWithinWeeklyHours(opensAt, closesAt, summerNight), false);

    assert.equal(winterMorning.getHours(), 7, "05:30Z is 07:30 in Hebron in January");
    assert.equal(isWithinWeeklyHours(opensAt, closesAt, winterMorning), true);
  });
});

test("on UTC the same store is shut when it should be open and open when it should be shut", () => {
  // This is the production bug in miniature. Every assertion below is the opposite of the one
  // above for the very same instant, which is what a container left on UTC would actually do.
  withTimeZone("UTC", () => {
    assert.equal(summerMorning.getHours(), 4);
    assert.equal(
      isWithinWeeklyHours(opensAt, closesAt, summerMorning),
      false,
      "a UTC server turns customers away at 07:30 local"
    );

    assert.equal(summerNight.getHours(), 20);
    assert.equal(
      isWithinWeeklyHours(opensAt, closesAt, summerNight),
      true,
      "a UTC server keeps taking orders at 23:30 local"
    );

    assert.equal(isWithinWeeklyHours(opensAt, closesAt, winterMorning), false);
  });
});

test("the DST boundary does not open or close a store an hour early", () => {
  // Palestine moved to EEST at 02:00 on 2026-03-28. An 08:00 opening must hold on both sides.
  withTimeZone("Asia/Hebron", () => {
    const beforeSwitch = new Date("2026-03-20T06:30:00Z"); // 08:30 at UTC+2
    const afterSwitch = new Date("2026-04-03T05:30:00Z"); // 08:30 at UTC+3
    assert.equal(beforeSwitch.getHours(), 8);
    assert.equal(afterSwitch.getHours(), 8);
    assert.equal(isWithinWeeklyHours("08:00", "22:00", beforeSwitch), true);
    assert.equal(isWithinWeeklyHours("08:00", "22:00", afterSwitch), true);

    const beforeOpening = new Date("2026-04-03T04:30:00Z"); // 07:30 at UTC+3
    assert.equal(isWithinWeeklyHours("08:00", "22:00", beforeOpening), false);
  });
});
