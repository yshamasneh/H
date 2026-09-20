/**
 * Decides when background location tracking runs, and when it must stop.
 *
 * Tracking exists for one purpose: dispatch can see a delivery in progress even when the driver has
 * handed the trip to a navigation app. So it runs only while some screen says a delivery is active,
 * and it stops when that stops - not on a timer, and not "eventually".
 *
 * Several screens can want tracking (the driver's home and the delivery screen), and opening a
 * delivery unmounts one and mounts the other. A plain "stop when this screen goes away" would stop
 * tracking for a moment on every navigation, so stopping is debounced: tracking ends only if nobody
 * has wanted it for stopDelayMs. That is short enough to end tracking promptly and long enough to
 * ride out a screen change.
 *
 * Kept free of Expo, timers and I/O so the rules can be tested exactly. The real start/stop and the
 * scheduler are passed in.
 */

export type TrackingControllerDeps = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** setTimeout-alike. Returns a handle for cancel. */
  schedule: (run: () => void, delayMs: number) => unknown;
  cancel: (handle: unknown) => void;
  stopDelayMs?: number;
};

export const defaultStopDelayMs = 3_000;

export class TrackingController {
  private readonly wanting = new Set<string>();
  private running = false;
  private pendingStop: unknown = null;
  private starting: Promise<void> | null = null;

  constructor(private readonly deps: TrackingControllerDeps) {}

  /** A screen (source) says a delivery is, or is no longer, being tracked. */
  want(source: string, wanted: boolean): void {
    if (wanted) {
      this.wanting.add(source);
      this.cancelPendingStop();
      void this.ensureStarted();
      return;
    }
    this.wanting.delete(source);
    if (this.wanting.size === 0) this.scheduleStop();
  }

  /** The server says the delivery is over: stop now, regardless of what any screen thinks. */
  async stopNow(): Promise<void> {
    this.wanting.clear();
    this.cancelPendingStop();
    await this.stopIfRunning();
  }

  /** Try again to start, e.g. because the permission has just been granted. Does nothing if no one wants tracking. */
  retry(): void {
    if (this.wanting.size > 0) void this.ensureStarted();
  }

  get isRunning(): boolean {
    return this.running;
  }

  private async ensureStarted(): Promise<void> {
    if (this.running) return;
    if (!this.starting) {
      this.starting = this.deps
        .start()
        .then(() => {
          this.running = true;
        })
        .catch(() => {
          // Permission denied or the service could not start: tracking simply does not run. The
          // foreground watcher keeps working, and the next want(true) will try again.
        })
        .finally(() => {
          this.starting = null;
        });
    }
    await this.starting;
    // A stop that was requested while starting must not be lost.
    if (this.wanting.size === 0 && this.pendingStop === null) await this.stopIfRunning();
  }

  private scheduleStop(): void {
    if (this.pendingStop !== null) return;
    this.pendingStop = this.deps.schedule(() => {
      this.pendingStop = null;
      if (this.wanting.size === 0) void this.stopIfRunning();
    }, this.deps.stopDelayMs ?? defaultStopDelayMs);
  }

  private cancelPendingStop(): void {
    if (this.pendingStop === null) return;
    this.deps.cancel(this.pendingStop);
    this.pendingStop = null;
  }

  private async stopIfRunning(): Promise<void> {
    if (this.starting) await this.starting;
    if (!this.running) return;
    this.running = false;
    await this.deps.stop().catch(() => undefined);
  }
}
