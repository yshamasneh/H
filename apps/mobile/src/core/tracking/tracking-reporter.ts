/**
 * What the background location task does with each batch of fixes.
 *
 * The phone delivers fixes in batches, possibly several at once after the OS wakes the task. Only
 * the newest matters to dispatch, so only it is sent. The server's reply says whether the driver
 * still has a delivery to track; when it says no, tracking stops itself. That is what ends tracking
 * when a delivery is cancelled by an admin while the driver is in another app and no screen of ours
 * is there to notice.
 */

export type LocationFix = { latitude: number; longitude: number; timestamp: number };

export type TrackingReporterDeps = {
  getAccessToken: () => Promise<string | null>;
  send: (accessToken: string, latitude: number, longitude: number) => Promise<{ hasActiveDelivery?: boolean }>;
  /** Ends background tracking now. */
  stopTracking: () => Promise<void>;
};

export type ReportOutcome = "sent" | "stopped" | "skipped" | "failed";

export function newestFix(fixes: LocationFix[]): LocationFix | null {
  let newest: LocationFix | null = null;
  for (const fix of fixes) {
    if (!Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)) continue;
    if (Math.abs(fix.latitude) > 90 || Math.abs(fix.longitude) > 180) continue;
    if (newest === null || fix.timestamp >= newest.timestamp) newest = fix;
  }
  return newest;
}

export function createTrackingReporter(deps: TrackingReporterDeps): (fixes: LocationFix[]) => Promise<ReportOutcome> {
  return async (fixes) => {
    const fix = newestFix(fixes);
    if (!fix) return "skipped";
    const accessToken = await deps.getAccessToken().catch(() => null);
    // Signed out: there is no driver to report for, and nothing should keep tracking them.
    if (!accessToken) {
      await deps.stopTracking().catch(() => undefined);
      return "stopped";
    }
    try {
      const reply = await deps.send(accessToken, fix.latitude, fix.longitude);
      if (reply.hasActiveDelivery === false) {
        await deps.stopTracking().catch(() => undefined);
        return "stopped";
      }
      return "sent";
    } catch {
      // A dropped connection is normal on a moving phone. The next fix tries again.
      return "failed";
    }
  };
}
