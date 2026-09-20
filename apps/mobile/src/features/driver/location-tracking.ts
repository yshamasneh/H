import { useEffect } from "react";
import { updateDriverLocation } from "../../core/api";
import { watchCurrentCoordinates, type CurrentCoordinates } from "../../core/location";
import { getAccessToken } from "../../core/session";

/**
 * Follows the driver's position while `enabled` (an active delivery) and reports every fix, so the
 * map pin moves with the driver and dispatch has a current position. Fixes arrive at most every
 * 10 s / 30 m (see `watchCurrentCoordinates`). Foreground only; the watcher is released as soon as
 * the delivery ends or the screen goes away.
 *
 * Shared by the driver's home and delivery-detail screens. Only one of them is mounted at a time,
 * so opening a delivery hands tracking over rather than doubling it — and, importantly, does not
 * drop it: the watcher used to live only on the home screen and stopped the moment the driver
 * opened the delivery to navigate.
 */
export function useDriverLocationTracking(
  enabled: boolean,
  onFix: (coordinate: CurrentCoordinates) => void,
  onDenied?: () => void
): void {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let subscription: { remove: () => void } | null = null;
    void watchCurrentCoordinates((next) => {
      onFix(next);
      void getAccessToken()
        .then((accessToken) => (accessToken ? updateDriverLocation(accessToken, next.latitude, next.longitude) : undefined))
        .catch(() => undefined);
    })
      .then((handle) => {
        if (cancelled) handle.remove();
        else subscription = handle;
      })
      // No permission or no GPS: the pin simply stays where the last one-off read put it.
      .catch(() => onDenied?.());
    return () => {
      cancelled = true;
      subscription?.remove();
    };
    // onFix / onDenied are setters or stable callbacks owned by the screen; only \`enabled\` restarts the watch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
