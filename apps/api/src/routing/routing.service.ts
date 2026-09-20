import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Road-following routes, from any OSRM-compatible routing service.
 *
 * OSRM's `/route/v1/driving/{lng},{lat};{lng},{lat}` protocol is the vendor-neutral choice here:
 * the same request works against the public demo server, a self-hosted OSRM, and several hosted
 * services, so switching is one environment variable (`ROUTING_BASE_URL`), the same shape as the
 * OTP webhook and error-tracking endpoints. Nothing about the provider leaks past this file.
 *
 * The route the driver sees is store -> customer, which never changes once an order exists, so each
 * one is fetched once and cached; a delivery therefore costs about one routing request however many
 * times the screen is opened. Failures are cached briefly so a routing outage is not retried by
 * every driver on every render. When there is no route the app shows the pins and no line: it does
 * not invent a straight line and present it as a road.
 */

export type LatLng = { latitude: number; longitude: number };

export type RoadRoute = {
  /** [latitude, longitude] pairs along the road, start to end. */
  points: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
};

export const defaultRoutingBaseUrl = "https://router.project-osrm.org";
const maxPoints = 1_500;
const routeTtlMs = 24 * 60 * 60 * 1_000;
const failureTtlMs = 60 * 1_000;
const maxCacheEntries = 500;

type CacheEntry = { route: RoadRoute | null; expiresAt: number };

@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<RoadRoute | null>>();

  constructor(@Optional() private readonly config?: ConfigService) {}

  get enabled(): boolean {
    return this.config?.get<boolean>("ROUTING_ENABLED", true) ?? true;
  }

  /** The driving route between two points, or null when none can be had right now. */
  async route(from: LatLng, to: LatLng): Promise<RoadRoute | null> {
    if (!this.enabled) return null;
    const key = cacheKey(from, to);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.route;

    // One request per route even if several screens ask at once.
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const request = this.fetchRoute(from, to)
      .then((route) => {
        this.remember(key, route);
        return route;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);
    return request;
  }

  private remember(key: string, route: RoadRoute | null): void {
    if (this.cache.size >= maxCacheEntries) {
      // Oldest first: a Map iterates in insertion order.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { route, expiresAt: Date.now() + (route ? routeTtlMs : failureTtlMs) });
  }

  private async fetchRoute(from: LatLng, to: LatLng): Promise<RoadRoute | null> {
    const baseUrl = (this.config?.get<string>("ROUTING_BASE_URL") || defaultRoutingBaseUrl).replace(/\/+$/, "");
    const url =
      `${baseUrl}/route/v1/driving/${from.longitude.toFixed(6)},${from.latitude.toFixed(6)};` +
      `${to.longitude.toFixed(6)},${to.latitude.toFixed(6)}?overview=full&geometries=geojson&alternatives=false&steps=false`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config?.get<number>("ROUTING_TIMEOUT_MS", 4_000) ?? 4_000);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          // The public OSRM demo asks callers to identify themselves.
          "User-Agent": "JOVO-API/1.0 (delivery routing)"
        },
        signal: controller.signal
      });
      if (!response.ok) {
        this.logger.warn(JSON.stringify({ event: "routing_http_error", status: response.status }));
        return null;
      }
      return parseOsrmRoute(await response.json());
    } catch (error) {
      this.logger.warn(
        JSON.stringify({ event: "routing_failed", reason: error instanceof Error ? error.name : "unknown" })
      );
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function cacheKey(from: LatLng, to: LatLng): string {
  // Five decimals is about a metre: two orders to the same doorstep share one route.
  const round = (value: number) => value.toFixed(5);
  return `${round(from.latitude)},${round(from.longitude)}>${round(to.latitude)},${round(to.longitude)}`;
}

/** Reads an OSRM route response defensively: it is data from outside, and a bad one must not crash a request. */
export function parseOsrmRoute(body: unknown): RoadRoute | null {
  if (typeof body !== "object" || body === null) return null;
  const payload = body as { code?: unknown; routes?: unknown };
  if (payload.code !== "Ok" || !Array.isArray(payload.routes) || payload.routes.length === 0) return null;
  const first = payload.routes[0] as { distance?: unknown; duration?: unknown; geometry?: { coordinates?: unknown } };
  const coordinates = first?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  if (typeof first.distance !== "number" || typeof first.duration !== "number") return null;

  const points: [number, number][] = [];
  for (const pair of coordinates) {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const [longitude, latitude] = pair as [unknown, unknown];
    if (
      typeof longitude !== "number" ||
      typeof latitude !== "number" ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      return null;
    }
    points.push([Number(latitude.toFixed(6)), Number(longitude.toFixed(6))]);
  }
  return {
    points: decimate(points, maxPoints),
    distanceMeters: Math.round(first.distance),
    durationSeconds: Math.round(first.duration)
  };
}

/** Keep the first and last points and an even spread between, so a very long route stays a sane size. */
export function decimate(points: [number, number][], limit: number): [number, number][] {
  if (points.length <= limit) return points;
  const step = (points.length - 1) / (limit - 1);
  const kept: [number, number][] = [];
  for (let index = 0; index < limit - 1; index += 1) kept.push(points[Math.round(index * step)]!);
  kept.push(points[points.length - 1]!);
  return kept;
}
