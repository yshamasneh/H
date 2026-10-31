// Reverse geocoding that works on every platform. expo-location's own reverseGeocodeAsync is not
// implemented on web, and on Android it depends on Google Play services, so this module is the
// fallback when the platform geocoder yields nothing.
//
// Store audit M4 (run 2): the app no longer calls Nominatim itself. It asks the JOVO API
// (GET /api/v1/geocode/reverse), which sends the identifying User-Agent, caches, paces to the
// provider's limit, and reads the provider from server configuration, so the provider can change
// without an app release. Signed-in users only: with no token the result is null and the person
// types the address.
//
// The pure pieces (formatting, cache key) live here with no native imports so they run under the
// plain node test runner.

export type GeocodePoint = { latitude: number; longitude: number };

type NominatimAddress = Record<string, string | undefined>;
export type NominatimReverseResponse = {
  display_name?: string;
  name?: string;
  address?: NominatimAddress;
  error?: string;
};

/** The API's reverse-geocoding endpoint for a given API base URL. */
export function geocoderEndpoint(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}/api/v1/geocode/reverse`;
}

export type GeocoderAccess = { apiBaseUrl: string; getAccessToken: () => Promise<string | null> };

/** Two points that round to the same key are the same door for delivery purposes (~1 m). */
export function geocodeCacheKey(point: GeocodePoint, language: string): string {
  return `${language}:${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`;
}

function firstOf(address: NominatimAddress, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = address[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Builds the short readable line a customer recognises ("Al-Masyoun, 12 Main St, Ramallah") rather
 * than Nominatim's full comma-separated display_name (which runs to postcode and country).
 */
export function formatNominatimAddress(result: NominatimReverseResponse): string | null {
  if (!result || result.error) return null;
  const address = result.address;
  if (!address) return result.display_name?.split(",").slice(0, 3).join(",").trim() || null;

  const road = firstOf(address, ["road", "pedestrian", "footway", "path", "residential"]);
  const street = road ? [road, address.house_number?.trim()].filter(Boolean).join(" ") : undefined;
  const area = firstOf(address, ["neighbourhood", "quarter", "suburb", "city_district"]);
  const town = firstOf(address, ["city", "town", "village", "municipality", "county"]);
  const named = result.name?.trim() && result.name.trim() !== road ? result.name.trim() : undefined;

  const parts = [named, street, area, town].filter((part, index, all): part is string => Boolean(part) && all.indexOf(part) === index);
  if (parts.length > 0) return parts.join(", ");
  return result.display_name?.split(",").slice(0, 3).join(",").trim() || null;
}

const cache = new Map<string, string>();
const cacheLimit = 200;
// The server paces the provider; the app only spaces its own requests so a dragged pin does not
// flood the API.
const minimumGapMs = 300;
let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

async function request(
  point: GeocodePoint,
  language: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  access: GeocoderAccess
): Promise<string | null> {
  const accessToken = await access.getAccessToken();
  if (!accessToken) return null;
  const wait = lastRequestAt + minimumGapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const query = new URLSearchParams({
      lat: point.latitude.toFixed(6),
      lon: point.longitude.toFixed(6),
      lang: language === "en" ? "en" : "ar"
    });
    const response = await fetchImpl(`${geocoderEndpoint(access.apiBaseUrl)}?${query.toString()}`, {
      signal: controller.signal,
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { address?: unknown };
    return typeof body?.address === "string" && body.address.trim() ? body.address.trim() : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolves a readable address for a point, or null when none can be found. Never throws: an
 * unreachable geocoder must leave the pin usable, so callers keep the coordinates and let the
 * customer type the address.
 */
export async function reverseGeocodeOnline(
  point: GeocodePoint,
  language: string,
  access: GeocoderAccess,
  fetchImpl: FetchLike = (url, init) => fetch(url, init) as ReturnType<FetchLike>,
  timeoutMs = 7_000
): Promise<string | null> {
  const key = geocodeCacheKey(point, language);
  const cached = cache.get(key);
  if (cached) return cached;
  const run = queue.then(() => request(point, language, fetchImpl, timeoutMs, access)).catch(() => null);
  queue = run;
  const address = await run;
  if (address) {
    if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value as string);
    cache.set(key, address);
  }
  return address;
}

/** Test seam: forget cached results and pacing state. */
export function resetGeocoderForTests(): void {
  cache.clear();
  lastRequestAt = 0;
  queue = Promise.resolve();
}
