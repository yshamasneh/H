/**
 * Store audit M3: where map tiles come from, in one place.
 *
 * The defaults are the Esri layers the app has always used, so nothing changes until the owner
 * chooses a licensed source (options in docs/release-readiness/technical-analyses.md#m3-run2). A
 * build can point at another raster source without a code change through the EAS environment:
 *
 *   EXPO_PUBLIC_MAP_TILE_URL           base layer, {z}/{x}/{y} or {z}/{y}/{x} template
 *   EXPO_PUBLIC_MAP_LABELS_TILE_URL    optional overlay; "none" turns the overlay off
 *   EXPO_PUBLIC_MAP_TILE_ATTRIBUTION   attribution shown on the map (required by every provider)
 *
 * No key is embedded here. A provider that needs a key in the URL must be given one by the owner
 * as an EAS variable; it then ships inside the app, so use a key restricted to the app.
 */
export type MapTileSources = { baseUrl: string; labelsUrl: string | null; attribution: string };

export const defaultMapTileSources: MapTileSources = {
  baseUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  labelsUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  attribution: "Tiles © Esri"
};

function httpsTemplate(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !trimmed.startsWith("https://") || !trimmed.includes("{z}")) return null;
  return trimmed;
}

export function resolveMapTileSources(env: Record<string, string | undefined>): MapTileSources {
  const baseUrl = httpsTemplate(env.EXPO_PUBLIC_MAP_TILE_URL);
  if (!baseUrl) return defaultMapTileSources;
  const labelsRaw = env.EXPO_PUBLIC_MAP_LABELS_TILE_URL?.trim();
  return {
    baseUrl,
    labelsUrl: labelsRaw === "none" ? null : httpsTemplate(labelsRaw),
    attribution: env.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION?.trim() || "Map data © its provider"
  };
}

// Expo inlines EXPO_PUBLIC_* only when each is read by its literal name.
export const mapTileSources: MapTileSources = resolveMapTileSources({
  EXPO_PUBLIC_MAP_TILE_URL: process.env.EXPO_PUBLIC_MAP_TILE_URL,
  EXPO_PUBLIC_MAP_LABELS_TILE_URL: process.env.EXPO_PUBLIC_MAP_LABELS_TILE_URL,
  EXPO_PUBLIC_MAP_TILE_ATTRIBUTION: process.env.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION
});
