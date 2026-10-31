import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultMapTileSources, resolveMapTileSources } from "./map-tiles";

test("with nothing configured the app keeps today's tiles", () => {
  assert.deepEqual(resolveMapTileSources({}), defaultMapTileSources);
});

test("a configured HTTPS template replaces the base layer and its attribution", () => {
  const sources = resolveMapTileSources({
    EXPO_PUBLIC_MAP_TILE_URL: "https://tiles.example.test/{z}/{x}/{y}.png",
    EXPO_PUBLIC_MAP_LABELS_TILE_URL: "none",
    EXPO_PUBLIC_MAP_TILE_ATTRIBUTION: "© Example"
  });
  assert.deepEqual(sources, { baseUrl: "https://tiles.example.test/{z}/{x}/{y}.png", labelsUrl: null, attribution: "© Example" });
});

test("plain HTTP or a URL without a tile template is ignored", () => {
  assert.deepEqual(resolveMapTileSources({ EXPO_PUBLIC_MAP_TILE_URL: "http://tiles.example.test/{z}/{x}/{y}.png" }), defaultMapTileSources);
  assert.deepEqual(resolveMapTileSources({ EXPO_PUBLIC_MAP_TILE_URL: "https://tiles.example.test/" }), defaultMapTileSources);
});
