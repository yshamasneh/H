/**
 * Tells the server whether the driver's app is running.
 *
 * The server alerts a driver about a new delivery only while their app is running (see
 * apps/api/src/drivers/presence.rules.ts). A force-closed app cannot say so, so it is inferred from
 * the reports stopping. This session produces those reports:
 *
 *   app in the foreground   FOREGROUND now, and again every intervalMs (a heartbeat),
 *   app goes to background  one BACKGROUND report, then quiet (the server allows a longer grace),
 *   logout                  CLOSED, which ends the lease at once.
 *
 * Kept free of React Native so it can be tested with a fake clock.
 */

export type PresenceState = "FOREGROUND" | "BACKGROUND" | "CLOSED";
export type AppLifecycle = "active" | "background" | "inactive" | string;

export const presenceIntervalMs = 45_000;

export type PresenceSessionDeps = {
  send: (state: PresenceState) => Promise<unknown>;
  schedule: (run: () => void, everyMs: number) => unknown;
  cancel: (handle: unknown) => void;
  intervalMs?: number;
};

export class PresenceSession {
  private timer: unknown = null;
  private lastSent: PresenceState | null = null;

  constructor(private readonly deps: PresenceSessionDeps) {}

  /** Call with the app's current state at start, and on every change. */
  onAppState(state: AppLifecycle): void {
    if (state === "active") {
      this.report("FOREGROUND");
      this.startHeartbeat();
    } else if (state === "background") {
      this.stopHeartbeat();
      this.report("BACKGROUND");
    }
    // "inactive" is iOS's brief in-between state (control centre, an incoming call). It is neither
    // open nor gone, so it changes nothing.
  }

  /** The session is ending without a logout (the screen tree unmounted): stop heartbeating. */
  stop(): void {
    this.stopHeartbeat();
  }

  /** Explicitly closed, e.g. logout. Sent even if it repeats the last state. */
  async close(): Promise<void> {
    this.stopHeartbeat();
    this.lastSent = "CLOSED";
    await this.deps.send("CLOSED").catch(() => undefined);
  }

  private startHeartbeat(): void {
    if (this.timer !== null) return;
    this.timer = this.deps.schedule(() => this.report("FOREGROUND"), this.deps.intervalMs ?? presenceIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.timer === null) return;
    this.deps.cancel(this.timer);
    this.timer = null;
  }

  private report(state: PresenceState): void {
    this.lastSent = state;
    // Best effort: a missed heartbeat is covered by the lease, and the next one tries again.
    void this.deps.send(state).catch(() => undefined);
  }

  get last(): PresenceState | null {
    return this.lastSent;
  }
}
