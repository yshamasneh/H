import Constants from "expo-constants";
import MapView, { Marker, type MapPressEvent, type Region } from "react-native-maps";
import { Platform, StyleSheet, Text, View } from "react-native";
import i18n from "../i18n";
import type { LocationMapProps, MapCoordinate } from "./location-map.types";
import { colors, radius, spacing } from "../theme/tokens";
import { text } from "../theme/typography";

const latitudeDelta = 0.025;
const longitudeDelta = 0.025;

/**
 * `react-native-maps` renders Google Maps on Android and (by default) Apple
 * Maps on iOS. Android's Google Maps SDK refuses to initialise without a
 * `com.google.android.geo.API_KEY` meta-data entry, which Expo only emits when
 * `android.config.googleMaps.apiKey` is set in app.json. No key is configured
 * in this project, and `react-native-maps` ships no manifest entry of its own,
 * so on a real Android build the SDK fails authorisation: the map area comes
 * up blank, and the half-initialised native view is then torn down through
 * `MapManager.onDropViewInstance -> MapView.doDestroy() -> onPause()/onDestroy()`
 * the moment the screen unmounts. That teardown runs against a GoogleMap
 * delegate that was never created.
 *
 * The checkout screen is the one place a customer reliably unmounts a map:
 * placing an order navigates straight from checkout to the confirmation
 * screen. A native crash there cannot be caught by the JS ErrorBoundary, which
 * matches the reported "confirming the order closes the app" symptom exactly.
 *
 * So the map is mounted only when a key is actually configured. Without one we
 * render the coordinate panel below instead: nothing in the address step
 * depends on the map, since the address is typed and "use my current location"
 * goes through `expo-location`, which needs no Maps SDK. Set
 * `android.config.googleMaps.apiKey` (and `ios.config.googleMapsApiKey` if iOS
 * should use Google rather than Apple maps) and the map returns on its own.
 */
function resolveMapsApiKey(): string | null {
  const config = Constants.expoConfig;
  const key =
    Platform.OS === "android"
      ? config?.android?.config?.googleMaps?.apiKey
      : config?.ios?.config?.googleMapsApiKey;
  return typeof key === "string" && key.trim().length > 0 ? key : null;
}

// Resolved once: the app config cannot change while the process is running,
// and re-reading it per render would only add noise to every map mount.
const mapsApiKey = resolveMapsApiKey();

// iOS falls back to Apple Maps, which needs no key at all, so only Android is
// actually gated on one.
export const isInteractiveMapAvailable = Platform.OS !== "android" || mapsApiKey !== null;

export function LocationMap(props: LocationMapProps) {
  const region: Region = {
    ...props.coordinate,
    latitudeDelta,
    longitudeDelta
  };

  function select(event: MapPressEvent) {
    props.onCoordinateChange?.(event.nativeEvent.coordinate);
  }

  function drag(coordinate: MapCoordinate) {
    props.onCoordinateChange?.(coordinate);
  }

  if (!isInteractiveMapAvailable) {
    return <CoordinatePanel coordinate={props.coordinate} />;
  }

  return (
    <View style={[styles.frame, { height: props.height ?? 300 }]}>
      <MapView initialRegion={region} onPress={select} style={StyleSheet.absoluteFillObject}>
        {props.onCoordinateChange ? (
          <Marker
            coordinate={props.coordinate}
            draggable
            onDragEnd={(event) => drag(event.nativeEvent.coordinate)}
            pinColor={colors.primary}
            title={i18n.t("common:map.deliveryPinTitle")}
          />
        ) : null}
        {props.markers?.map((marker) => (
          <Marker
            coordinate={marker}
            key={marker.id}
            pinColor={marker.color}
            title={marker.title}
          />
        ))}
      </MapView>
    </View>
  );
}

function CoordinatePanel(props: { coordinate: MapCoordinate }) {
  return (
    <View style={styles.fallback}>
      <Text style={styles.fallbackIcon}>⌖</Text>
      <Text style={styles.fallbackTitle}>{i18n.t("common:map.unavailableTitle")}</Text>
      <Text style={styles.fallbackBody}>{i18n.t("common:map.unavailableBody")}</Text>
      <Text style={styles.fallbackCoordinate}>
        {props.coordinate.latitude.toFixed(5)}, {props.coordinate.longitude.toFixed(5)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginVertical: spacing[3],
    overflow: "hidden",
    width: "100%"
  },
  fallback: {
    alignItems: "center",
    backgroundColor: colors.surfaceSunk,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing[1],
    marginVertical: spacing[3],
    padding: spacing[5],
    width: "100%"
  },
  fallbackIcon: { color: colors.textMuted, fontSize: 28 },
  fallbackTitle: { ...text("body", "bold"), color: colors.text, textAlign: "center" },
  fallbackBody: { ...text("caption"), color: colors.textMuted, textAlign: "center" },
  fallbackCoordinate: { ...text("caption", "bold"), color: colors.text, marginTop: spacing[1] }
});
