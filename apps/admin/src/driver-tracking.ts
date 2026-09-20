/**
 * Pure logic behind the live driver map. Kept free of React and Leaflet so it can be unit-tested
 * (the admin app has no component-test harness) and so the two screens that show drivers — the
 * live map and an order's tracking card — agree on what "live" means.
 */

export type DriverStatus = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
export type TrackedDeliveryStatus = "PENDING_ASSIGNMENT" | "ASSIGNED" | "PICKED_UP" | "ON_THE_WAY" | "DELIVERED" | "CANCELLED" | "FAILED";

export type TrackedDriver = {
  userId: string;
  fullName: string;
  phone: string;
  status: DriverStatus;
  isOnline: boolean;
  latitude: number | null;
  longitude: number | null;
  lastLocationAt: string | null;
  activeDelivery: {
    deliveryId: string;
    orderId: string;
    status: TrackedDeliveryStatus;
    restaurantName: string;
  } | null;
};

export type LocationUpdate = {
  userId: string;
  latitude: number;
  longitude: number;
  lastLocationAt: string;
};

/**
 * A driver's phone reports every ~10 seconds while a delivery is active, and much less otherwise,
 * so the age of the last fix is what tells dispatch whether a dot on the map can be trusted.
 * "live" is a fix from the last minute; "recent" within five; anything older is "stale", and a
 * driver who has never reported has "none". Stale positions are drawn muted, never hidden: where
 * someone was ten minutes ago is still useful, as long as it does not pass for where they are now.
 */
export type Freshness = "live" | "recent" | "stale" | "none";

export const liveWithinMs = 60_000;
export const recentWithinMs = 5 * 60_000;

export function freshness(lastLocationAt: string | null, now: number): Freshness {
  if (!lastLocationAt) return "none";
  const reported = Date.parse(lastLocationAt);
  if (Number.isNaN(reported)) return "none";
  const age = now - reported;
  if (age <= liveWithinMs) return "live";
  if (age <= recentWithinMs) return "recent";
  return "stale";
}

/** Whole seconds under a minute, minutes under an hour, then hours. Never negative (clock skew). */
export function ageLabel(lastLocationAt: string | null, now: number): { unit: "seconds" | "minutes" | "hours"; value: number } | null {
  if (!lastLocationAt) return null;
  const reported = Date.parse(lastLocationAt);
  if (Number.isNaN(reported)) return null;
  const seconds = Math.max(0, Math.round((now - reported) / 1000));
  if (seconds < 60) return { unit: "seconds", value: seconds };
  if (seconds < 3600) return { unit: "minutes", value: Math.floor(seconds / 60) };
  return { unit: "hours", value: Math.floor(seconds / 3600) };
}

export function hasPosition(driver: Pick<TrackedDriver, "latitude" | "longitude">): driver is { latitude: number; longitude: number } {
  return (
    typeof driver.latitude === "number" &&
    typeof driver.longitude === "number" &&
    Number.isFinite(driver.latitude) &&
    Number.isFinite(driver.longitude)
  );
}

/**
 * Applies one live position to the list. A position for a driver who is not in the list (they went
 * on shift after the list loaded) is ignored here rather than invented; the caller's refresh picks
 * the driver up. An older fix never overwrites a newer one, because sockets can deliver out of
 * order across a reconnect.
 */
export function applyLocationUpdate<T extends Pick<TrackedDriver, "userId" | "latitude" | "longitude" | "lastLocationAt">>(
  drivers: T[],
  update: unknown
): T[] {
  if (!isLocationUpdate(update)) return drivers;
  let changed = false;
  const next = drivers.map((driver) => {
    if (driver.userId !== update.userId) return driver;
    if (driver.lastLocationAt && Date.parse(driver.lastLocationAt) > Date.parse(update.lastLocationAt)) return driver;
    changed = true;
    return { ...driver, latitude: update.latitude, longitude: update.longitude, lastLocationAt: update.lastLocationAt };
  });
  return changed ? next : drivers;
}

export function isLocationUpdate(value: unknown): value is LocationUpdate {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.userId === "string" &&
    typeof candidate.latitude === "number" &&
    typeof candidate.longitude === "number" &&
    Number.isFinite(candidate.latitude) &&
    Number.isFinite(candidate.longitude) &&
    Math.abs(candidate.latitude) <= 90 &&
    Math.abs(candidate.longitude) <= 180 &&
    typeof candidate.lastLocationAt === "string" &&
    !Number.isNaN(Date.parse(candidate.lastLocationAt))
  );
}

/** Drivers on the map first (fresh before stale), then those with no position yet, by name. */
export function sortForList<T extends Pick<TrackedDriver, "fullName" | "latitude" | "longitude" | "lastLocationAt" | "activeDelivery">>(
  drivers: T[],
  now: number
): T[] {
  const rank = (driver: T) => {
    const state = freshness(driver.lastLocationAt, now);
    const order = { live: 0, recent: 1, stale: 2, none: 3 }[state];
    // A driver mid-delivery is what dispatch is watching, so they lead within their freshness band.
    return order * 2 + (driver.activeDelivery ? 0 : 1);
  };
  return [...drivers].sort((left, right) => rank(left) - rank(right) || left.fullName.localeCompare(right.fullName));
}

export const markerColors: Record<Freshness, string> = {
  live: "#1F5FBF",
  recent: "#B7791F",
  stale: "#8A8A8A",
  none: "#8A8A8A"
};
