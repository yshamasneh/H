import assert from "node:assert/strict";
import { test } from "node:test";
import { createReconnectResync, type ResyncTimers } from "./reconnect-resync";

/** A hand-driven timer: `set` records the callback, `flush` runs the one pending timer. */
function controllableTimers() {
  let pending: { fn: () => void } | null = null;
  const timers: ResyncTimers = {
    set: (fn) => {
      pending = { fn };
      return pending;
    },
    clear: (handle) => {
      if (pending === handle) pending = null;
    }
  };
  return {
    timers,
    flush: () => {
      const current = pending;
      pending = null;
      current?.fn();
    },
    isPending: () => pending !== null
  };
}

test("the initial connect does NOT trigger a resync (screen already loaded on mount)", () => {
  const clock = controllableTimers();
  let resyncs = 0;
  const { onConnect } = createReconnectResync(() => (resyncs += 1), { timers: clock.timers });

  onConnect();
  assert.equal(clock.isPending(), false);
  assert.equal(resyncs, 0);
});

test("a reconnect triggers exactly one refetch", () => {
  const clock = controllableTimers();
  let resyncs = 0;
  const { onConnect } = createReconnectResync(() => (resyncs += 1), { timers: clock.timers });

  onConnect(); // initial connect (ignored)
  onConnect(); // first reconnect → schedules
  assert.equal(resyncs, 0, "nothing fires until the debounce elapses");
  clock.flush();
  assert.equal(resyncs, 1);
});

test("rapid reconnect flapping collapses into a single refetch (no storm)", () => {
  const clock = controllableTimers();
  let resyncs = 0;
  const { onConnect } = createReconnectResync(() => (resyncs += 1), { timers: clock.timers });

  onConnect(); // initial connect
  onConnect(); // reconnect 1 → schedules
  onConnect(); // reconnect 2 → reschedules (cancels previous)
  onConnect(); // reconnect 3 → reschedules
  clock.flush();
  assert.equal(resyncs, 1, "three flaps in a row → one refetch");
});

test("cancel() prevents a pending resync from firing (e.g. on unmount)", () => {
  const clock = controllableTimers();
  let resyncs = 0;
  const { onConnect, cancel } = createReconnectResync(() => (resyncs += 1), { timers: clock.timers });

  onConnect(); // initial
  onConnect(); // reconnect → schedules
  cancel();
  clock.flush();
  assert.equal(resyncs, 0);
  assert.equal(clock.isPending(), false);
});
