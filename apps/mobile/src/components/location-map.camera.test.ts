import assert from "node:assert/strict";
import { test } from "node:test";
import { boundsForCoordinates, regionForCoordinates, sameSpot } from "./location-map.camera";

test("bounds enclose every point, in west-south-east-north order", () => {
  const bounds = boundsForCoordinates([
    { latitude: 31.84, longitude: 35.15 },
    { latitude: 31.86, longitude: 35.1 },
    { latitude: 31.8, longitude: 35.17 }
  ]);
  assert.deepEqual(bounds, [35.1, 31.8, 35.17, 31.86]);
});

test("no points means no camera move", () => {
  assert.equal(boundsForCoordinates([]), null);
  assert.equal(regionForCoordinates([]), null);
});

test("a region is centred on the points with room around them", () => {
  const region = regionForCoordinates(
    [
      { latitude: 31.8, longitude: 35.1 },
      { latitude: 31.9, longitude: 35.3 }
    ],
    { padding: 1.5 }
  )!;
  assert.ok(Math.abs(region.latitude - 31.85) < 1e-9 && Math.abs(region.longitude - 35.2) < 1e-9);
  assert.ok(Math.abs(region.latitudeDelta - 0.15) < 1e-9);
  assert.ok(Math.abs(region.longitudeDelta - 0.3) < 1e-9);
});

test("a single point, or points a few metres apart, never zoom to street-corner level", () => {
  const single = regionForCoordinates([{ latitude: 31.85, longitude: 35.2 }])!;
  assert.equal(single.latitudeDelta, 0.006);
  assert.equal(single.longitudeDelta, 0.006);
  const close = regionForCoordinates([
    { latitude: 31.85, longitude: 35.2 },
    { latitude: 31.8501, longitude: 35.2001 }
  ])!;
  assert.equal(close.latitudeDelta, 0.006);
});

test("sameSpot treats sub-centimetre differences as the same place but not a real move", () => {
  assert.equal(sameSpot({ latitude: 31.9, longitude: 35.2 }, { latitude: 31.90000001, longitude: 35.2 }), true);
  assert.equal(sameSpot({ latitude: 31.9, longitude: 35.2 }, { latitude: 31.9001, longitude: 35.2 }), false);
});
