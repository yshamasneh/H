import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Camera, Map, ViewAnnotation, type StyleSpecification } from "@maplibre/maplibre-react-native";
import i18n from "../i18n";
import { LandmarkFlag } from "./landmark-flag";
import { MapDot } from "./map-pin";
import { landmarkMarkerColor, landmarkVisibilityMinZoom, type LocationMapProps } from "./location-map.types";
import { radius, spacing, type ThemeColors } from "../theme/tokens";
import { useTheme } from "../theme/theme-context";

// Initial camera zoom; also the starting value for zoom-based landmark gating.
const initialZoom = 14;

/**
 * Android renders the map with MapLibre Native. Unlike Google Maps (the default
 * `react-native-maps` provider on Android) it needs no Google Cloud account or
 * `com.google.android.geo.API_KEY`, so the interactive map is always available —
 * matching web (Leaflet) and iOS (Apple Maps, see location-map.ios.tsx).
 *
 * MapLibre is a native module and is not present in Expo Go: run a dev-client
 * build (`npx expo prebuild --platform android` then `npx expo run:android`) to
 * see it.
 */
export const isInteractiveMapAvailable = true;

// The same Esri layers the web map (location-map.web.tsx) and the admin
// LandmarksPage use: World Imagery satellite base plus the Boundaries & Places
// label overlay. Keeping the identical tile URLs means Android looks the same as
// web/iOS instead of introducing a fourth visual style. The `{z}/{y}/{x}` token
// order is Esri's (level/row/col); MapLibre substitutes the named tokens.
const esriImageryTiles =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const esriLabelsTiles =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

const esriRasterStyle: StyleSpecification = {
  version: 8,
  sources: {
    "esri-imagery": { type: "raster", tiles: [esriImageryTiles], tileSize: 256, attribution: "Tiles © Esri" },
    "esri-labels": { type: "raster", tiles: [esriLabelsTiles], tileSize: 256 }
  },
  layers: [
    { id: "esri-imagery", type: "raster", source: "esri-imagery" },
    { id: "esri-labels", type: "raster", source: "esri-labels" }
  ]
};

export function LocationMap(props: LocationMapProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Read-only mode (e.g. the driver dashboard) simply omits `onCoordinateChange`,
  // exactly like the iOS/web variants; then the pin isn't draggable and taps are
  // ignored.
  const editable = Boolean(props.onCoordinateChange);
  // Only landmark markers are gated on zoom; the draggable delivery pin always
  // renders. MapLibre reports the live zoom on every camera change.
  const [zoom, setZoom] = useState(initialZoom);
  const showLandmarks = zoom >= landmarkVisibilityMinZoom;

  // MapLibre coordinates are [longitude, latitude]; our contract is {latitude, longitude}.
  function emit(lngLat: [number, number]) {
    props.onCoordinateChange?.({ latitude: lngLat[1], longitude: lngLat[0] });
  }

  return (
    <View style={[styles.frame, { height: props.height ?? 300 }]}>
      <Map
        attribution
        compass={false}
        logo={false}
        mapStyle={esriRasterStyle}
        onPress={editable ? (event) => emit(event.nativeEvent.lngLat) : undefined}
        onRegionDidChange={(event) => setZoom(event.nativeEvent.zoom)}
        style={StyleSheet.absoluteFillObject}
      >
        <Camera
          initialViewState={{ center: [props.coordinate.longitude, props.coordinate.latitude], zoom: initialZoom }}
        />
        {editable ? (
          <ViewAnnotation
            draggable
            id="delivery"
            lngLat={[props.coordinate.longitude, props.coordinate.latitude]}
            onDragEnd={(event) => emit(event.nativeEvent.lngLat)}
            title={i18n.t("common:map.deliveryPinTitle")}
          >
            <View style={[styles.pin, { backgroundColor: colors.primary }]} />
          </ViewAnnotation>
        ) : null}
        {showLandmarks
          ? props.markers?.map((marker) => (
              <ViewAnnotation
                anchor="bottom-left"
                id={marker.id}
                key={marker.id}
                lngLat={[marker.longitude, marker.latitude]}
                title={marker.title}
              >
                <LandmarkFlag color={marker.color ?? landmarkMarkerColor} name={marker.title} />
              </ViewAnnotation>
            ))
          : null}
        {/* Always-visible point markers (driver, store, destination) — never zoom-gated. */}
        {props.pins?.map((pin) => (
          <ViewAnnotation
            anchor="center"
            id={pin.id}
            key={pin.id}
            lngLat={[pin.longitude, pin.latitude]}
            title={pin.title}
          >
            <MapDot color={pin.color ?? colors.primary} />
          </ViewAnnotation>
        ))}
      </Map>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    frame: {
      borderColor: colors.border,
      borderRadius: radius.lg,
      borderWidth: 1,
      marginVertical: spacing[3],
      overflow: "hidden",
      width: "100%"
    },
    pin: {
      borderColor: "#FFFFFF",
      borderRadius: 11,
      borderWidth: 3,
      height: 22,
      width: 22
    }
  });
