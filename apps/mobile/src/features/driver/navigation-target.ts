import type { DeliveryView } from "../../core/api";
import type { LocationMapPin, MapCoordinate } from "../../components/location-map.types";

/**
 * Pure helpers for the driver's navigation map: where to head next, how far it is, and how to hand
 * the trip to a turn-by-turn navigation app. The maps used across the app show position and
 * landmarks but do no routing, so the driving directions themselves come from the phone's own
 * navigation app.
 */

export type NavigationTarget = {
  /** Head to the store first; once the goods are picked up, head to the customer. */
  kind: "pickup" | "customer";
  coordinate: MapCoordinate;
  label: string;
};

function hasCoordinate(latitude: number | null, longitude: number | null): boolean {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
  );
}

/**
 * The next place the driver has to be. An accepted-but-not-collected delivery points at the store;
 * a collected one points at the customer. Older orders and stores without coordinates give no
 * target, so the screen falls back to an address-only view rather than navigating to nowhere.
 */
export function navigationTarget(delivery: DeliveryView): NavigationTarget | null {
  const { restaurant, order } = delivery;
  if (delivery.status === "ASSIGNED") {
    return hasCoordinate(restaurant.latitude, restaurant.longitude)
      ? {
          kind: "pickup",
          coordinate: { latitude: restaurant.latitude!, longitude: restaurant.longitude! },
          label: restaurant.name
        }
      : null;
  }
  if (delivery.status === "PICKED_UP" || delivery.status === "ON_THE_WAY") {
    return hasCoordinate(order.latitude, order.longitude)
      ? {
          kind: "customer",
          coordinate: { latitude: order.latitude!, longitude: order.longitude! },
          label: order.deliveryAddressLine
        }
      : null;
  }
  return null;
}

/**
 * The three always-visible markers of the delivery map: the driver's own position (blue dot), the
 * pickup store (green dot) and the customer's destination (orange pin). A marker whose coordinate
 * is missing is left out rather than drawn at 0,0.
 */
export function deliveryPins(
  delivery: DeliveryView | null,
  driver: MapCoordinate | null,
  labels: { driver: string },
  palette: { driver: string; store: string; destination: string }
): LocationMapPin[] {
  const pins: LocationMapPin[] = [];
  if (driver) {
    pins.push({ id: "driver", ...driver, title: labels.driver, color: palette.driver, shape: "dot" });
  }
  if (!delivery) return pins;
  const { restaurant, order } = delivery;
  if (hasCoordinate(restaurant.latitude, restaurant.longitude)) {
    pins.push({
      id: "store",
      latitude: restaurant.latitude!,
      longitude: restaurant.longitude!,
      title: restaurant.name,
      color: palette.store,
      shape: "dot"
    });
  }
  if (hasCoordinate(order.latitude, order.longitude)) {
    pins.push({
      id: "destination",
      latitude: order.latitude!,
      longitude: order.longitude!,
      title: order.deliveryAddressLine,
      color: palette.destination,
      shape: "pin"
    });
  }
  return pins;
}

const earthRadiusMeters = 6_371_000;

/** Great-circle distance in metres. A straight line, not a driving distance. */
export function haversineMeters(from: MapCoordinate, to: MapCoordinate): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** "180 m" under a kilometre, "1.4 km" above it; the numerals follow the active locale's digits. */
export function formatDistance(meters: number, locale?: string): string {
  if (meters < 1_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.max(10, Math.round(meters / 10) * 10))} ${
      locale?.startsWith("ar") ? "م" : "m"
    }`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(meters / 1_000)} ${
    locale?.startsWith("ar") ? "كم" : "km"
  }`;
}

/**
 * A link that opens the phone's own navigation app on driving directions to the target.
 *
 * Android uses the `google.navigation:` intent, which starts turn-by-turn straight away in Google
 * Maps; iOS uses Apple Maps' directions URL, which is always installed; anything else (web) gets
 * the Google Maps directions page. Coordinates are formatted with a dot and no grouping so the URL
 * is valid whatever the device locale.
 */
export function externalNavigationUrl(platform: string, target: MapCoordinate): string {
  const point = `${target.latitude.toFixed(6)},${target.longitude.toFixed(6)}`;
  if (platform === "android") return `google.navigation:q=${point}&mode=d`;
  if (platform === "ios") return `http://maps.apple.com/?daddr=${point}&dirflg=d`;
  return `https://www.google.com/maps/dir/?api=1&destination=${point}&travelmode=driving`;
}
