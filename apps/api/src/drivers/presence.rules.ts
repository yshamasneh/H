/**
 * Whether a driver's app is running, as far as the server can tell.
 *
 * The server cannot see a phone force-close an app; the only thing it can know is that the app has
 * stopped saying it is there. So presence is a lease. While the app is running it reports in — a
 * heartbeat from the foreground, and a final "going to the background" report — and each report
 * buys a lease that runs out on its own. When the lease has run out the app is treated as closed,
 * which is what stops a driver who forgot to go offline from being alerted all day.
 *
 *   FOREGROUND  short lease, renewed by a heartbeat every ~45 s while the app is open.
 *   BACKGROUND  a longer grace, because a backgrounded app (phone locked, or another app on top) is
 *               still running but cannot heartbeat. Long enough to cover a locked phone in a
 *               pocket between deliveries; short enough that an app that was then force-closed
 *               stops being alerted within a working break, not a working day.
 *   CLOSED      an explicit "I am done" (logout) that ends the lease at once.
 *
 * A driver is alerted to a new delivery only if they are approved, marked online, AND the lease is
 * still valid. Online alone is not enough, and neither is an open app while offline.
 */

export type DriverAppState = "FOREGROUND" | "BACKGROUND";
export type PresenceReport = DriverAppState | "CLOSED";

export const defaultForegroundLeaseSeconds = 120;
export const defaultBackgroundGraceMinutes = 30;

export type PresenceDurations = { foregroundLeaseMs: number; backgroundGraceMs: number };

export const defaultPresenceDurations: PresenceDurations = {
  foregroundLeaseMs: defaultForegroundLeaseSeconds * 1_000,
  backgroundGraceMs: defaultBackgroundGraceMinutes * 60_000
};

/** When a report made `now` stops being enough evidence that the app is running. */
export function leaseUntil(state: DriverAppState, now: Date, durations: PresenceDurations): Date {
  return new Date(now.getTime() + (state === "FOREGROUND" ? durations.foregroundLeaseMs : durations.backgroundGraceMs));
}

export type PresenceFields = { appState: DriverAppState | null; appLeaseUntil: Date | null };

/** What to store for a report, or the cleared state for CLOSED. */
export function nextPresence(report: PresenceReport, now: Date, durations: PresenceDurations): PresenceFields {
  if (report === "CLOSED") return { appState: null, appLeaseUntil: null };
  return { appState: report, appLeaseUntil: leaseUntil(report, now, durations) };
}

/** Is the app believed to be running right now? */
export function isAppOpen(presence: Pick<PresenceFields, "appLeaseUntil">, now: Date): boolean {
  return presence.appLeaseUntil !== null && presence.appLeaseUntil.getTime() > now.getTime();
}

/**
 * Renew the lease on evidence that is not a presence report (a location fix): the app is running,
 * and it keeps whichever state it last announced, so a fix from a background task extends the
 * background grace rather than pretending the app is in the foreground.
 */
export function renewedPresence(current: PresenceFields, now: Date, durations: PresenceDurations): PresenceFields {
  return nextPresence(current.appState ?? "FOREGROUND", now, durations);
}

export type AlertEligibility = {
  approved: boolean;
  isOnline: boolean;
  appLeaseUntil: Date | null;
  accountActive: boolean;
};

export type AlertDecision = "ALERT" | "OFFLINE" | "APP_CLOSED" | "NOT_ELIGIBLE";

/**
 * The single rule for "should this driver be alerted?", stated once so the database query that
 * selects drivers and the tests that describe the behaviour cannot drift apart.
 *
 *   online + app open   -> ALERT
 *   online + app closed -> APP_CLOSED  (no alert is even attempted, whatever the stale online flag says)
 *   offline + app open  -> OFFLINE     (going offline stops alerts while the app stays open)
 */
export function alertDecision(driver: AlertEligibility, now: Date): AlertDecision {
  if (!driver.approved || !driver.accountActive) return "NOT_ELIGIBLE";
  if (!driver.isOnline) return "OFFLINE";
  if (!isAppOpen(driver, now)) return "APP_CLOSED";
  return "ALERT";
}
