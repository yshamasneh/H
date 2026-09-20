import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { decimate, parseOsrmRoute, RoutingService } from "./routing.service";

const store = { latitude: 31.83804, longitude: 35.14047 };
const home = { latitude: 31.9038, longitude: 35.2034 };

const osrmBody = {
  code: "Ok",
  routes: [
    {
      distance: 13_617.7,
      duration: 1_348.9,
      geometry: {
        coordinates: [
          [35.140481, 31.838062],
          [35.15, 31.85],
          [35.203417, 31.903789]
        ]
      }
    }
  ]
};

async function withFetch(handler: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("an OSRM response becomes [lat, lng] points along the road, with real distance and time", () => {
  const route = parseOsrmRoute(osrmBody)!;
  assert.deepEqual(route.points[0], [31.838062, 35.140481], "OSRM sends [lng, lat]; the app wants [lat, lng]");
  assert.deepEqual(route.points.at(-1), [31.903789, 35.203417]);
  assert.equal(route.distanceMeters, 13_618);
  assert.equal(route.durationSeconds, 1_349);
});

test("anything that is not a clean route is refused rather than drawn", () => {
  assert.equal(parseOsrmRoute(null), null);
  assert.equal(parseOsrmRoute({ code: "NoRoute", routes: [] }), null);
  assert.equal(parseOsrmRoute({ code: "Ok", routes: [] }), null);
  assert.equal(parseOsrmRoute({ code: "Ok", routes: [{ distance: 1, duration: 1, geometry: { coordinates: [[35, 31]] } }] }), null, "a single point is not a route");
  assert.equal(parseOsrmRoute({ code: "Ok", routes: [{ distance: 1, duration: 1, geometry: { coordinates: [[35, 31], ["x", 31]] } }] }), null);
  assert.equal(parseOsrmRoute({ code: "Ok", routes: [{ distance: 1, duration: 1, geometry: { coordinates: [[35, 31], [35, 95]] } }] }), null, "latitude out of range");
  assert.equal(parseOsrmRoute({ code: "Ok", routes: [{ duration: 1, geometry: { coordinates: [[35, 31], [35.1, 31.1]] } }] }), null);
});

test("a very long route is thinned to a sane size and keeps both ends", () => {
  const points: [number, number][] = Array.from({ length: 10_000 }, (_, index) => [31 + index / 100_000, 35 + index / 100_000]);
  const thinned = decimate(points, 1_500);
  assert.equal(thinned.length, 1_500);
  assert.deepEqual(thinned[0], points[0]);
  assert.deepEqual(thinned.at(-1), points.at(-1));
  assert.equal(decimate(points.slice(0, 10), 1_500).length, 10, "a short route is left alone");
});

test("the request is a plain OSRM call to the configured host, lng before lat", async () => {
  const urls: string[] = [];
  const service = new RoutingService(new ConfigService({ ROUTING_BASE_URL: "https://routing.example.test/" }));
  await withFetch((async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify(osrmBody), { status: 200 });
  }) as never, async () => {
    const route = await service.route(store, home);
    assert.ok(route);
  });
  assert.equal(urls.length, 1);
  assert.ok(
    urls[0].startsWith("https://routing.example.test/route/v1/driving/35.140470,31.838040;35.203400,31.903800?"),
    urls[0]
  );
  assert.match(urls[0], /geometries=geojson/);
});

test("the same trip is fetched once: a delivery costs about one routing request", async () => {
  let calls = 0;
  const service = new RoutingService();
  await withFetch((async () => {
    calls += 1;
    return new Response(JSON.stringify(osrmBody), { status: 200 });
  }) as never, async () => {
    await Promise.all([service.route(store, home), service.route(store, home), service.route(store, home)]);
    await service.route(store, home);
    await service.route(store, home);
  });
  assert.equal(calls, 1, "concurrent and repeated requests share one call");
});

test("an outage is remembered briefly instead of being retried on every render, and never throws", async () => {
  let calls = 0;
  const service = new RoutingService();
  await withFetch((async () => {
    calls += 1;
    throw new TypeError("network down");
  }) as never, async () => {
    assert.equal(await service.route(store, home), null);
    assert.equal(await service.route(store, home), null);
  });
  assert.equal(calls, 1);
});

test("a non-200 or garbage reply is treated as no route", async () => {
  await withFetch((async () => new Response("bad gateway", { status: 502 })) as never, async () => {
    assert.equal(await new RoutingService().route(store, home), null);
  });
  await withFetch((async () => new Response("not json", { status: 200 })) as never, async () => {
    assert.equal(await new RoutingService().route(store, { latitude: 31.5, longitude: 35.5 }), null);
  });
});

test("routing can be switched off", async () => {
  let calls = 0;
  const service = new RoutingService(new ConfigService({ ROUTING_ENABLED: false }));
  await withFetch((async () => {
    calls += 1;
    return new Response(JSON.stringify(osrmBody), { status: 200 });
  }) as never, async () => {
    assert.equal(await service.route(store, home), null);
  });
  assert.equal(calls, 0);
});
