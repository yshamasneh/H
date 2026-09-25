import type { MapCoordinate } from "./location-map.types";

/**
 * Pure camera maths shared by the three map implementations (MapLibre on Android, Apple Maps on
 * iOS, Leaflet on web), kept free of any map library so it can be unit-tested and so all three
 * frame a set of points the same way.
 */

/** [west, south, east, north] — the order MapLibre and Leaflet-style bounds both use. */
export type CoordinateBounds = [number, number, number, number];

export function boundsForCoordinates(coordinates: MapCoordinate[]): CoordinateBounds | null {
  if (coordinates.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const point of coordinates) {
    west = Math.min(west, point.longitude);
    east = Math.max(east, point.longitude);
    south = Math.min(south, point.latitude);
    north = Math.max(north, point.latitude);
  }
  return [west, south, east, north];
}

export type CoordinateRegion = MapCoordinate & { latitudeDelta: number; longitudeDelta: number };

/**
 * A region that frames every point with breathing room. `minSpan` keeps a single point, or two
 * points a few metres apart, from zooming in to street-corner level, and `padding` is how much
 * larger than the points' own extent the view is.
 */
export function regionForCoordinates(
  coordinates: MapCoordinate[],
  { minSpan = 0.006, padding = 1.6 }: { minSpan?: number; padding?: number } = {}
): CoordinateRegion | null {
  const bounds = boundsForCoordinates(coordinates);
  if (!bounds) return null;
  const [west, south, east, north] = bounds;
  return {
    latitude: (south + north) / 2,
    longitude: (west + east) / 2,
    latitudeDelta: Math.max(minSpan, (north - south) * padding),
    longitudeDelta: Math.max(minSpan, (east - west) * padding)
  };
}

/** Zoom used when the camera starts following the driver: roughly a few city blocks. */
export const followZoom = 16;
/** The same framing for Apple Maps, which is region-based rather than zoom-based. */
export const followDelta = 0.006;

/**
 * Whether two coordinates are the same spot for camera purposes. A map that emitted a coordinate
 * (the customer dragged or tapped) already shows it, so only a coordinate that arrives from outside
 * — "use my location", a saved address — should move the camera to bring the pin into view.
 */
export function sameSpot(a: MapCoordinate, b: MapCoordinate): boolean {
  return Math.abs(a.latitude - b.latitude) < 1e-7 && Math.abs(a.longitude - b.longitude) < 1e-7;
}

/** Street level, so a pin set from outside is close enough to nudge into place. */
export const pinFocusZoom = 17;
export const pinFocusDelta = 0.003;
