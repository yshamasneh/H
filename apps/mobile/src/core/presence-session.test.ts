import assert from "node:assert/strict";
import { test } from "node:test";
import { PresenceSession, presenceIntervalMs, type PresenceState } from "./presence-session";

function harness() {
  const sent: PresenceState[] = [];
  const timers = new Map<number, { every: number; run: () => void }>();
  let nextId = 1;
  const session = new PresenceSession({
    send: async (state) => void sent.push(state),
    schedule: (run, every) => {
      const id = nextId++;
      timers.set(id, { every, run });
      return id;
    },
    cancel: (handle) => void timers.delete(handle as number)
  });
  const tick = () => [...timers.values()].forEach((timer) => timer.run());
  return { session, sent, timers, tick };
}

test("opening the app reports FOREGROUND at once and then heartbeats while it stays open", () => {
  const { session, sent, tick, timers } = harness();
  session.onAppState("active");
  assert.deepEqual(sent, ["FOREGROUND"]);
  assert.equal([...timers.values()][0].every, presenceIntervalMs);

  tick();
  tick();
  assert.deepEqual(sent, ["FOREGROUND", "FOREGROUND", "FOREGROUND"]);
});

test("going to the background reports it once and stops heartbeating: the server then allows a longer grace", () => {
  const { session, sent, tick, timers } = harness();
  session.onAppState("active");
  session.onAppState("background");
  assert.deepEqual(sent, ["FOREGROUND", "BACKGROUND"]);
  assert.equal(timers.size, 0, "no heartbeat while backgrounded");

  tick();
  assert.deepEqual(sent, ["FOREGROUND", "BACKGROUND"]);
});

test("coming back to the foreground resumes the heartbeat with one timer, never two", () => {
  const { session, sent, timers } = harness();
  session.onAppState("active");
  session.onAppState("active");
  session.onAppState("background");
  session.onAppState("active");
  assert.equal(timers.size, 1);
  assert.deepEqual(sent, ["FOREGROUND", "FOREGROUND", "BACKGROUND", "FOREGROUND"]);
});

test("iOS's brief 'inactive' state changes nothing: the app is neither open nor gone", () => {
  const { session, sent, timers } = harness();
  session.onAppState("active");
  session.onAppState("inactive");
  assert.deepEqual(sent, ["FOREGROUND"]);
  assert.equal(timers.size, 1);
});

test("logout closes the lease explicitly and stops the heartbeat", async () => {
  const { session, sent, timers } = harness();
  session.onAppState("active");
  await session.close();
  assert.deepEqual(sent, ["FOREGROUND", "CLOSED"]);
  assert.equal(timers.size, 0);
  assert.equal(session.last, "CLOSED");
});

test("a failing network never throws out of a heartbeat", async () => {
  const session = new PresenceSession({
    send: async () => {
      throw new TypeError("network request failed");
    },
    schedule: () => 1,
    cancel: () => undefined
  });
  assert.doesNotThrow(() => session.onAppState("active"));
  await assert.doesNotReject(session.close());
});

test("stopping without a logout (the tree unmounted) ends the heartbeat but claims nothing about the app", () => {
  const { session, sent, timers } = harness();
  session.onAppState("active");
  session.stop();
  assert.equal(timers.size, 0);
  assert.deepEqual(sent, ["FOREGROUND"]);
});
