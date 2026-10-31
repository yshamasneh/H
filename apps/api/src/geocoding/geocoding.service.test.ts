import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { defaultReverseGeocoderUrl, formatNominatimAddress, GeocodingService, type GeocodeFetch } from "./geocoding.service";

function fakeFetch(body: unknown, ok = true) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl: GeocodeFetch = async (url, init) => {
    calls.push({ url, headers: init.headers });
    return { ok, status: ok ? 200 : 503, json: async () => body };
  };
  return { calls, fetchImpl };
}

let clock = 0;
const now = () => (clock += 2_000);

test("calls the configured provider with an identifying User-Agent and caches the answer", async () => {
  const { calls, fetchImpl } = fakeFetch({ address: { road: "Main Street", city: "Ramallah" } });
  const service = new GeocodingService(
    new ConfigService({ GEOCODER_USER_AGENT: "JOVO/1.0 (ops@example.test)", GEOCODER_REVERSE_URL: "https://geo.example.test/reverse" }),
    fetchImpl,
    now
  );
  assert.deepEqual(await service.reverse(31.90381, 35.20341, "en"), { address: "Main Street, Ramallah" });
  assert.deepEqual(await service.reverse(31.903811, 35.203411, "en"), { address: "Main Street, Ramallah" });
  assert.equal(calls.length, 1, "the second, sub-metre-identical point is served from cache");
  assert.ok(calls[0].url.startsWith("https://geo.example.test/reverse?"));
  assert.match(calls[0].url, /accept-language=en/);
  assert.equal(calls[0].headers["User-Agent"], "JOVO/1.0 (ops@example.test)");
});

test("without a User-Agent or when disabled, no request leaves the server", async () => {
  const { calls, fetchImpl } = fakeFetch({});
  assert.deepEqual(await new GeocodingService(new ConfigService({}), fetchImpl, now).reverse(31.9, 35.2, "ar"), { address: null });
  assert.deepEqual(
    await new GeocodingService(new ConfigService({ GEOCODER_USER_AGENT: "JOVO", GEOCODER_ENABLED: "false" }), fetchImpl, now).reverse(31.9, 35.2, "ar"),
    { address: null }
  );
  assert.equal(calls.length, 0);
});

test("a provider failure answers null and is not cached, so a retry can succeed", async () => {
  const failing = fakeFetch({}, false);
  const config = new ConfigService({ GEOCODER_USER_AGENT: "JOVO" });
  const service = new GeocodingService(config, failing.fetchImpl, now);
  assert.deepEqual(await service.reverse(31.8, 35.1, "ar"), { address: null });
  const working = fakeFetch({ address: { village: "Beitunia" } });
  const retry = new GeocodingService(config, working.fetchImpl, now);
  assert.deepEqual(await retry.reverse(31.8, 35.1, "ar"), { address: "Beitunia" });
});

test("the default provider is the public Nominatim reverse endpoint", async () => {
  const { calls, fetchImpl } = fakeFetch({ display_name: "A, B, C, D" });
  await new GeocodingService(new ConfigService({ GEOCODER_USER_AGENT: "JOVO" }), fetchImpl, now).reverse(31.7, 35.0, "ar");
  assert.ok(calls[0].url.startsWith(`${defaultReverseGeocoderUrl}?`));
});

test("formatting keeps the short readable line", () => {
  assert.equal(formatNominatimAddress({ address: { road: "Main St", house_number: "12", suburb: "Al-Masyoun", city: "Ramallah" } }), "Main St 12, Al-Masyoun, Ramallah");
  assert.equal(formatNominatimAddress({ error: "Unable to geocode" }), null);
});
