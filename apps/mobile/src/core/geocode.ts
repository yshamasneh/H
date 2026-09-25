// Reverse geocoding that works on every platform. expo-location's own reverseGeocodeAsync is not
// implemented on web (it throws "Geocoder service is not available"), and on Android it depends on
// Google Play services being present, so the app used to show a pin with no readable address on the
// web build and on some devices. This module asks an OpenStreetMap Nominatim endpoint instead, and
// is the fallback the native path uses when the platform geocoder yields nothing.
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

const defaultEndpoint = "https://nominatim.openstreetmap.org/reverse";

/** The endpoint can be pointed at a self-hosted Nominatim without a code change. */
export function geocoderEndpoint(): string {
  return process.env.EXPO_PUBLIC_GEOCODER_URL?.trim() || defaultEndpoint;
}

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
// Nominatim's usage policy allows about one request per second per client. A pin that is dragged
// repeatedly must queue behind that rather than get the client blocked.
const minimumGapMs = 1100;
let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

async function request(point: GeocodePoint, language: string, fetchImpl: FetchLike, timeoutMs: number): Promise<string | null> {
  const wait = lastRequestAt + minimumGapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const query = new URLSearchParams({
      format: "jsonv2",
      lat: String(point.latitude),
      lon: String(point.longitude),
      zoom: "18",
      addressdetails: "1",
      "accept-language": language
    });
    const response = await fetchImpl(`${geocoderEndpoint()}?${query.toString()}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return null;
    return formatNominatimAddress((await response.json()) as NominatimReverseResponse);
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
  fetchImpl: FetchLike = (url, init) => fetch(url, init) as ReturnType<FetchLike>,
  timeoutMs = 7_000
): Promise<string | null> {
  const key = geocodeCacheKey(point, language);
  const cached = cache.get(key);
  if (cached) return cached;
  const run = queue.then(() => request(point, language, fetchImpl, timeoutMs)).catch(() => null);
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
