import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { formatNominatimAddress, geocodeCacheKey, resetGeocoderForTests, reverseGeocodeOnline, type FetchLike } from "./geocode";

beforeEach(() => resetGeocoderForTests());

test("formats a Nominatim result as a short readable line, not the full display name", () => {
  const line = formatNominatimAddress({
    display_name: "12, Main Street, Al-Masyoun, Ramallah, Ramallah and Al-Bireh Governorate, 00000, Palestine",
    address: { house_number: "12", road: "Main Street", neighbourhood: "Al-Masyoun", city: "Ramallah", postcode: "00000", country: "Palestine" }
  });
  assert.equal(line, "Main Street 12, Al-Masyoun, Ramallah");
});

test("falls back to the village when there is no city, and drops duplicate parts", () => {
  const line = formatNominatimAddress({ address: { road: "Olive Rd", village: "Biddu", suburb: "Biddu" } });
  assert.equal(line, "Olive Rd, Biddu");
});

test("uses the head of the display name when no structured address is present", () => {
  assert.equal(formatNominatimAddress({ display_name: "Some Place, Ramallah, Palestine, Extra" }), "Some Place, Ramallah, Palestine");
});

test("an error result or an empty result yields null", () => {
  assert.equal(formatNominatimAddress({ error: "Unable to geocode" }), null);
  assert.equal(formatNominatimAddress({ address: {} }), null);
});

test("cache key ignores sub-metre noise but separates languages", () => {
  const a = geocodeCacheKey({ latitude: 31.838041, longitude: 35.140471 }, "ar");
  assert.equal(a, geocodeCacheKey({ latitude: 31.8380412, longitude: 35.1404714 }, "ar"));
  assert.notEqual(a, geocodeCacheKey({ latitude: 31.838041, longitude: 35.140471 }, "en"));
});

const access = (token: string | null = "token") => ({ apiBaseUrl: "https://api.example.test", getAccessToken: async () => token });

const okFetch = (body: unknown, seen: Array<{ url: string; headers?: Record<string, string> }> = []): FetchLike => async (url, init) => {
  seen.push({ url, headers: init?.headers });
  return { ok: true, json: async () => body };
};

test("asks the JOVO API (never the map provider) with the point, language and token, then serves repeats from cache", async () => {
  const seen: Array<{ url: string; headers?: Record<string, string> }> = [];
  const fetchImpl = okFetch({ address: "Main Street, Ramallah" }, seen);
  const point = { latitude: 31.9, longitude: 35.2 };
  assert.equal(await reverseGeocodeOnline(point, "en", access(), fetchImpl), "Main Street, Ramallah");
  assert.equal(await reverseGeocodeOnline(point, "en", access(), fetchImpl), "Main Street, Ramallah");
  assert.equal(seen.length, 1);
  const url = new URL(seen[0].url);
  assert.equal(url.origin + url.pathname, "https://api.example.test/api/v1/geocode/reverse");
  assert.equal(url.searchParams.get("lat"), "31.900000");
  assert.equal(url.searchParams.get("lon"), "35.200000");
  assert.equal(url.searchParams.get("lang"), "en");
  assert.equal(seen[0].headers?.Authorization, "Bearer token");
  assert.ok(!seen[0].url.includes("nominatim"));
});

test("without a session no request is made and the result is null", async () => {
  const seen: Array<{ url: string }> = [];
  assert.equal(await reverseGeocodeOnline({ latitude: 31.4, longitude: 35.4 }, "ar", access(null), okFetch({ address: "x" }, seen)), null);
  assert.equal(seen.length, 0);
});

test("a network failure, bad status or empty answer resolves to null instead of throwing", async () => {
  const point = { latitude: 31.1, longitude: 35.1 };
  const failing: FetchLike = async () => { throw new Error("offline"); };
  assert.equal(await reverseGeocodeOnline(point, "ar", access(), failing), null);
  const notOk: FetchLike = async () => ({ ok: false, json: async () => ({}) });
  assert.equal(await reverseGeocodeOnline({ latitude: 31.2, longitude: 35.1 }, "ar", access(), notOk), null);
  assert.equal(await reverseGeocodeOnline({ latitude: 31.25, longitude: 35.1 }, "ar", access(), okFetch({ address: null })), null);
});

test("a failed lookup is not cached, so a later retry can succeed", async () => {
  const point = { latitude: 31.3, longitude: 35.3 };
  const failing: FetchLike = async () => { throw new Error("offline"); };
  assert.equal(await reverseGeocodeOnline(point, "en", access(), failing), null);
  assert.equal(await reverseGeocodeOnline(point, "en", access(), okFetch({ address: "Retry Rd" })), "Retry Rd");
});
