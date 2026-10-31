import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Store audit M4: reverse geocoding through the API instead of every phone calling Nominatim.
 *
 * - The provider is configuration, so it can change without an app release:
 *   GEOCODER_ENABLED (default true), GEOCODER_REVERSE_URL (default the public Nominatim reverse
 *   endpoint), GEOCODER_USER_AGENT (an identifying agent with a contact address, as the Nominatim
 *   usage policy requires; requests are not sent at all without it).
 * - Results are cached in memory (rounded to ~1 m, per language) and upstream calls are paced to at
 *   most one per second for the whole API, which is the public Nominatim limit.
 * - Never throws: no address is a normal answer and the app keeps the pin and lets the person type.
 */
export type GeocodeFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

type NominatimAddress = Record<string, string | undefined>;
type NominatimReverseResponse = { display_name?: string; name?: string; address?: NominatimAddress; error?: string };

export const defaultReverseGeocoderUrl = "https://nominatim.openstreetmap.org/reverse";
const cacheLimit = 5_000;
const cacheTtlMs = 7 * 24 * 60 * 60 * 1000;
const minimumGapMs = 1_100;
const timeoutMs = 6_000;

export function reverseGeocodeCacheKey(latitude: number, longitude: number, language: string): string {
  return `${language}:${latitude.toFixed(5)},${longitude.toFixed(5)}`;
}

function firstOf(address: NominatimAddress, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = address[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** The short line a customer recognises ("Al-Masyoun, 12 Main St, Ramallah"), same rules as the app had. */
export function formatNominatimAddress(result: NominatimReverseResponse | null | undefined): string | null {
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

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly cache = new Map<string, { address: string | null; at: number }>();
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  private warnedMissingAgent = false;

  constructor(
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly fetchImpl: GeocodeFetch = (url, init) => fetch(url, init) as ReturnType<GeocodeFetch>,
    @Optional() private readonly now: () => number = Date.now
  ) {}

  private enabled(): boolean {
    const value = this.config?.get<string | boolean>("GEOCODER_ENABLED");
    return !(value === false || value === "false");
  }

  private endpoint(): string {
    return this.config?.get<string>("GEOCODER_REVERSE_URL")?.trim() || defaultReverseGeocoderUrl;
  }

  private userAgent(): string | null {
    return this.config?.get<string>("GEOCODER_USER_AGENT")?.trim() || null;
  }

  async reverse(latitude: number, longitude: number, language: "ar" | "en"): Promise<{ address: string | null }> {
    if (!this.enabled()) return { address: null };
    const userAgent = this.userAgent();
    if (!userAgent) {
      if (!this.warnedMissingAgent) {
        this.warnedMissingAgent = true;
        this.logger.warn("GEOCODER_USER_AGENT is not set: reverse geocoding is disabled (provider policy requires an identifying agent).");
      }
      return { address: null };
    }
    const key = reverseGeocodeCacheKey(latitude, longitude, language);
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.at < cacheTtlMs) return { address: cached.address };

    const run = this.queue.then(() => this.request(latitude, longitude, language, userAgent)).catch(() => undefined);
    this.queue = run;
    const address = await run;
    if (address === undefined) return { address: null };
    if (this.cache.size >= cacheLimit) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, { address, at: this.now() });
    return { address };
  }

  /** undefined = the provider failed (not cached, so a retry can succeed); null = no address there. */
  private async request(latitude: number, longitude: number, language: string, userAgent: string): Promise<string | null | undefined> {
    const wait = this.lastRequestAt + minimumGapMs - this.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = this.now();
    const query = new URLSearchParams({
      format: "jsonv2",
      lat: latitude.toFixed(6),
      lon: longitude.toFixed(6),
      zoom: "18",
      addressdetails: "1",
      "accept-language": language
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.endpoint()}?${query.toString()}`, {
        headers: { Accept: "application/json", "User-Agent": userAgent },
        signal: controller.signal
      });
      if (!response.ok) {
        this.logger.warn(`Reverse geocoder answered HTTP ${response.status}`);
        return undefined;
      }
      return formatNominatimAddress((await response.json()) as NominatimReverseResponse);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
}
