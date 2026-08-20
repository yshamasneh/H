/**
 * Coordinates a one-time refetch when a dropped socket reconnects (M-5). REST is the source
 * of truth in this app (a socket event just means "something changed, go re-fetch"), so any
 * events emitted while we were disconnected are missed — on reconnect we reconcile by
 * refetching once. Pure and injectable (timers passed in) so it's unit-testable without
 * real timers or a real socket.
 */
export type ResyncTimers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const defaultTimers: ResyncTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export function createReconnectResync(
  onResync: () => void,
  options: { debounceMs?: number; timers?: ResyncTimers } = {}
): { onConnect: () => void; cancel: () => void } {
  const debounceMs = options.debounceMs ?? 500;
  const timers = options.timers ?? defaultTimers;
  let seenFirstConnect = false;
  let pending: unknown = null;

  function onConnect() {
    // The first `connect` is the initial connection — the screen already fetched on mount,
    // so there is nothing to reconcile. Only *re*connects need a resync.
    if (!seenFirstConnect) {
      seenFirstConnect = true;
      return;
    }
    // Debounce so a flapping connection (several reconnects in quick succession) triggers a
    // single refetch, not one per flap.
    if (pending !== null) timers.clear(pending);
    pending = timers.set(() => {
      pending = null;
      onResync();
    }, debounceMs);
  }

  function cancel() {
    if (pending !== null) {
      timers.clear(pending);
      pending = null;
    }
  }

  return { onConnect, cancel };
}
