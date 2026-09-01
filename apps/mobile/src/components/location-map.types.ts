export type MapCoordinate = {
  latitude: number;
  longitude: number;
};

export type LocationMapMarker = MapCoordinate & {
  id: string;
  title: string;
  color?: string;
};

// The app's brand orange (matches colors.primary / #F45A00). Landmarks share the
// user pin's colour, so they are told apart by ICON SHAPE — a compact flag with a
// name label — rather than by colour. Shared so native and web stay in sync.
export const landmarkMarkerColor = "#F45A00";

// Landmark markers are hidden when the map is zoomed out past this level so a
// wide-area view isn't cluttered; they reappear at neighbourhood/street zoom. The
// value is a Web-Mercator zoom level, applied consistently by web (Leaflet's
// getZoom), iOS (approximated from region deltas) and Android (MapLibre camera
// zoom). The user's own draggable location pin ignores this and always shows.
export const landmarkVisibilityMinZoom = 15;

// A plain, always-visible point marker — used for roles like the driver's own
// live position, a pickup store, or a delivery destination. Unlike landmark
// `markers` these are NOT zoom-gated and NOT flag+label styled; they are simple
// coloured markers distinguished by colour and shape. "dot" is a filled circle;
// "pin" is a teardrop matching the customer address screen's delivery pin (a
// circle on Android, whose native delivery marker is itself a dot).
export type LocationMapPin = MapCoordinate & {
  id: string;
  title?: string;
  color?: string;
  shape?: "dot" | "pin";
};

export type LocationMapProps = {
  coordinate: MapCoordinate;
  onCoordinateChange?: (coordinate: MapCoordinate) => void;
  markers?: LocationMapMarker[];
  pins?: LocationMapPin[];
  height?: number;
};
