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

const okFetch = (body: unknown, seen: string[] = []): FetchLike => async (url) => {
  seen.push(url);
  return { ok: true, json: async () => body };
};

test("requests the reverse endpoint with the point and language, then serves repeats from cache", async () => {
  const seen: string[] = [];
  const fetchImpl = okFetch({ address: { road: "Main Street", city: "Ramallah" } }, seen);
  const point = { latitude: 31.9, longitude: 35.2 };
  assert.equal(await reverseGeocodeOnline(point, "en", fetchImpl), "Main Street, Ramallah");
  assert.equal(await reverseGeocodeOnline(point, "en", fetchImpl), "Main Street, Ramallah");
  assert.equal(seen.length, 1);
  const url = new URL(seen[0]);
  assert.equal(url.searchParams.get("lat"), "31.9");
  assert.equal(url.searchParams.get("lon"), "35.2");
  assert.equal(url.searchParams.get("accept-language"), "en");
  assert.equal(url.searchParams.get("format"), "jsonv2");
});

test("a network failure or bad status resolves to null instead of throwing", async () => {
  const point = { latitude: 31.1, longitude: 35.1 };
  const failing: FetchLike = async () => { throw new Error("offline"); };
  assert.equal(await reverseGeocodeOnline(point, "ar", failing), null);
  const notOk: FetchLike = async () => ({ ok: false, json: async () => ({}) });
  assert.equal(await reverseGeocodeOnline({ latitude: 31.2, longitude: 35.1 }, "ar", notOk), null);
});

test("a failed lookup is not cached, so a later retry can succeed", async () => {
  const point = { latitude: 31.3, longitude: 35.3 };
  const failing: FetchLike = async () => { throw new Error("offline"); };
  assert.equal(await reverseGeocodeOnline(point, "en", failing), null);
  assert.equal(await reverseGeocodeOnline(point, "en", okFetch({ address: { road: "Retry Rd" } })), "Retry Rd");
});
