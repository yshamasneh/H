// The native position watcher is configured to deliver at most one fix per 10 s or 30 m
// (see watchCurrentCoordinates). The browser's watchPosition has no such setting and fires on every
// change, so the web watcher applies the same rule here. Pure, so it can be tested without a browser.
export type Fix = { latitude: number; longitude: number; at: number };

export const minimumFixIntervalMs = 10_000;
export const minimumFixDistanceMeters = 30;

const earthRadiusMeters = 6_371_000;

export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
}

/** The first fix always passes; after that a fix passes when 10 s have elapsed or the driver moved 30 m. */
export function shouldDeliverFix(last: Fix | null, next: Fix): boolean {
  if (!last) return true;
  return next.at - last.at >= minimumFixIntervalMs || distanceMeters(last, next) >= minimumFixDistanceMeters;
}
