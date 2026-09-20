import assert from "node:assert/strict";
import { test } from "node:test";
import { disclosureVersion, parseConsent, planBackgroundTracking, serializeConsent } from "./location-consent";
import { TrackingController } from "./tracking-controller";
import { createTrackingReporter, newestFix, type LocationFix } from "./tracking-reporter";

// ---- a fake clock and a fake OS service -----------------------------------------------------------
function harness(options: { failToStart?: boolean } = {}) {
  let now = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  let nextId = 1;
  const log: string[] = [];
  const controller = new TrackingController({
    start: async () => {
      log.push("start");
      if (options.failToStart) throw new Error("permission not granted");
    },
    stop: async () => {
      log.push("stop");
    },
    schedule: (run, delay) => {
      const id = nextId++;
      timers.set(id, { at: now + delay, run });
      return id;
    },
    cancel: (handle) => void timers.delete(handle as number),
    stopDelayMs: 3_000
  });
  const advance = async (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) {
        timers.delete(id);
        timer.run();
      }
    }
    await Promise.resolve();
    await Promise.resolve();
  };
  const settle = async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
  };
  return { controller, log, advance, settle };
}

test("tracking starts when a delivery becomes active and stops shortly after it ends", async () => {
  const { controller, log, advance, settle } = harness();
  controller.want("delivery-detail", true);
  await settle();
  assert.deepEqual(log, ["start"]);
  assert.equal(controller.isRunning, true);

  controller.want("delivery-detail", false);
  await advance(2_999);
  assert.deepEqual(log, ["start"], "not yet: the delay rides out a screen change");
  await advance(2);
  await settle();
  assert.deepEqual(log, ["start", "stop"]);
  assert.equal(controller.isRunning, false);
});

test("opening a delivery from the home screen does not stop tracking for a moment", async () => {
  const { controller, log, advance, settle } = harness();
  controller.want("driver-home", true);
  await settle();
  // The home screen unmounts and the delivery screen mounts within the same moment.
  controller.want("driver-home", false);
  controller.want("delivery-detail", true);
  await advance(10_000);
  await settle();
  assert.deepEqual(log, ["start"], "started once, never stopped");
  assert.equal(controller.isRunning, true);
});

test("two screens can both want tracking, and it runs until the last one lets go", async () => {
  const { controller, log, advance, settle } = harness();
  controller.want("a", true);
  controller.want("b", true);
  await settle();
  assert.deepEqual(log, ["start"], "started once, not twice");
  controller.want("a", false);
  await advance(5_000);
  assert.equal(controller.isRunning, true, "b still wants it");
  controller.want("b", false);
  await advance(3_001);
  await settle();
  assert.deepEqual(log, ["start", "stop"]);
});

test("the server saying the delivery is over stops tracking at once, whatever a screen thinks", async () => {
  const { controller, log, settle } = harness();
  controller.want("delivery-detail", true);
  await settle();

  await controller.stopNow();

  assert.deepEqual(log, ["start", "stop"]);
  assert.equal(controller.isRunning, false);
});

test("logout and a completed delivery both end tracking, and stopping twice is harmless", async () => {
  const { controller, log, settle } = harness();
  controller.want("x", true);
  await settle();
  await controller.stopNow();
  await controller.stopNow();
  assert.deepEqual(log, ["start", "stop"]);
});

test("a stop asked for while tracking is still starting is not lost", async () => {
  const { controller, log, advance, settle } = harness();
  controller.want("x", true);
  controller.want("x", false); // the delivery ended before the OS finished starting the service
  await settle();
  await advance(3_001);
  await settle();
  assert.deepEqual(log, ["start", "stop"]);
  assert.equal(controller.isRunning, false);
});

test("if the OS refuses to start it (no permission), tracking simply is not running, and can be retried once granted", async () => {
  const { controller, log, settle } = harness({ failToStart: true });
  controller.want("x", true);
  await settle();
  assert.equal(controller.isRunning, false);
  controller.retry();
  await settle();
  assert.deepEqual(log, ["start", "start"], "retry tries again while a delivery is still wanted");
  controller.want("x", false);
  controller.retry();
  await settle();
  assert.equal(log.length, 2, "and does nothing once nobody wants it");
});

// ---- the reporter -----------------------------------------------------------------------------------
const fix = (latitude: number, longitude: number, timestamp: number): LocationFix => ({ latitude, longitude, timestamp });

test("only the newest fix in a batch is sent, and nonsense fixes are ignored", () => {
  assert.deepEqual(newestFix([fix(31, 35, 100), fix(31.1, 35.1, 300), fix(31.2, 35.2, 200)]), fix(31.1, 35.1, 300));
  assert.equal(newestFix([]), null);
  assert.equal(newestFix([fix(Number.NaN, 35, 1), fix(95, 35, 2), fix(31, 190, 3)]), null);
});

test("a fix is reported while the delivery is active", async () => {
  const sent: [string, number, number][] = [];
  let stopped = 0;
  const report = createTrackingReporter({
    getAccessToken: async () => "token",
    send: async (token, latitude, longitude) => (sent.push([token, latitude, longitude]), { hasActiveDelivery: true }),
    stopTracking: async () => void (stopped += 1)
  });

  assert.equal(await report([fix(31.9, 35.2, 5)]), "sent");
  assert.deepEqual(sent, [["token", 31.9, 35.2]]);
  assert.equal(stopped, 0);
});

test("when the server says there is no active delivery any more (completed or cancelled by an admin), tracking stops itself", async () => {
  let stopped = 0;
  const report = createTrackingReporter({
    getAccessToken: async () => "token",
    send: async () => ({ hasActiveDelivery: false }),
    stopTracking: async () => void (stopped += 1)
  });

  assert.equal(await report([fix(31.9, 35.2, 5)]), "stopped");
  assert.equal(stopped, 1);
});

test("signed out means nothing is sent and tracking is stopped", async () => {
  let sends = 0;
  let stopped = 0;
  const report = createTrackingReporter({
    getAccessToken: async () => null,
    send: async () => (sends += 1, {}),
    stopTracking: async () => void (stopped += 1)
  });

  assert.equal(await report([fix(31.9, 35.2, 5)]), "stopped");
  assert.equal(sends, 0);
  assert.equal(stopped, 1);
});

test("a dropped connection is not an error worth stopping for: the next fix tries again", async () => {
  let stopped = 0;
  const report = createTrackingReporter({
    getAccessToken: async () => "token",
    send: async () => {
      throw new TypeError("network request failed");
    },
    stopTracking: async () => void (stopped += 1)
  });

  assert.equal(await report([fix(31.9, 35.2, 5)]), "failed");
  assert.equal(stopped, 0);
});

test("an empty batch sends nothing", async () => {
  let sends = 0;
  const report = createTrackingReporter({
    getAccessToken: async () => "token",
    send: async () => (sends += 1, {}),
    stopTracking: async () => undefined
  });
  assert.equal(await report([]), "skipped");
  assert.equal(sends, 0);
});

// ---- consent ------------------------------------------------------------------------------------------
const now = new Date("2026-09-20T12:00:00.000Z");
const accepted = () => parseConsent(serializeConsent("accepted", now));
const declined = () => parseConsent(serializeConsent("declined", now));

test("a driver who has never been asked is shown the disclosure BEFORE any system prompt", () => {
  assert.equal(planBackgroundTracking({ consent: null, permission: "undetermined" }), "disclose");
});

test("a granted permission just starts tracking", () => {
  assert.equal(planBackgroundTracking({ consent: accepted(), permission: "granted" }), "start");
});

test("a driver who declined the disclosure is not nagged: the foreground map carries on", () => {
  assert.equal(planBackgroundTracking({ consent: declined(), permission: "undetermined" }), "foreground-only");
  assert.equal(planBackgroundTracking({ consent: declined(), permission: "denied" }), "foreground-only");
});

test("a driver who accepted but then denied the system permission is pointed at settings, where Android needs them to go", () => {
  assert.equal(planBackgroundTracking({ consent: accepted(), permission: "denied" }), "open-settings");
});

test("changing the disclosure text (a new version) means an earlier 'accepted' no longer counts", () => {
  const old = { decision: "accepted" as const, version: disclosureVersion - 1, at: now.toISOString() };
  assert.equal(planBackgroundTracking({ consent: old, permission: "undetermined" }), "disclose");
  // ...but permission that is already granted at the OS level is still honoured.
  assert.equal(planBackgroundTracking({ consent: old, permission: "granted" }), "start");
});

test("consent survives a round trip through storage, and a corrupt record is treated as none", () => {
  assert.deepEqual(accepted(), { decision: "accepted", version: disclosureVersion, at: now.toISOString() });
  assert.equal(parseConsent(null), null);
  assert.equal(parseConsent("not json"), null);
  assert.equal(parseConsent(JSON.stringify({ decision: "maybe", version: 1, at: "x" })), null);
});
