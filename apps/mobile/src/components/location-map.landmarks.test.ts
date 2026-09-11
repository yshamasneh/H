import assert from "node:assert/strict";
import { test } from "node:test";
import { landmarkMarkerColor, toLandmarkMarkers } from "./location-map.types";

/**
 * P4 — the driver's active-delivery map renders the same public landmarks the customer maps show.
 * Both build their markers from this shared helper, so this pins the shape the driver map depends
 * on: brand-orange flag markers carrying the landmark's name as the label.
 */

test("landmarks become brand-orange flag markers keyed by id with the name as the label", () => {
  const markers = toLandmarkMarkers([
    { id: "a", name: "Manara Roundabout", latitude: 31.9, longitude: 35.2 },
    { id: "b", name: "Clock Tower", latitude: 31.8, longitude: 35.1 }
  ]);

  assert.deepEqual(markers, [
    { id: "a", title: "Manara Roundabout", latitude: 31.9, longitude: 35.2, color: landmarkMarkerColor },
    { id: "b", title: "Clock Tower", latitude: 31.8, longitude: 35.1, color: landmarkMarkerColor }
  ]);
});

test("an empty landmark list yields no markers, so a fetch failure leaves the map with only its delivery pins", () => {
  assert.deepEqual(toLandmarkMarkers([]), []);
});
