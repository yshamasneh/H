import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { getDeliveryRoute, type DeliveryRoute, type DeliveryView } from "../../core/api";
import { getAccessToken } from "../../core/session";
import { LocationMap } from "../../components/location-map";
import type { LocationMapCamera, LocationMapMarker, MapCoordinate } from "../../components/location-map.types";
import { colors, radius, spacing } from "../../theme/tokens";
import { text } from "../../theme/typography";
import {
  deliveryPins,
  externalNavigationUrl,
  formatDistance,
  formatDuration,
  haversineMeters,
  navigationTarget,
  routeCoordinates
} from "./navigation-target";

// Shown until the first GPS fix: the Biddu-enclave service area, the same default the driver's home
// map uses.
const fallbackCoordinate: MapCoordinate = { latitude: 31.83804, longitude: 35.14047 };

type DeliveryNavigationMapProps = {
  /** Runs before the trip is handed to another app: the moment to explain and ask for background location. */
  onBeforeHandOff?: (options?: { auto?: boolean }) => Promise<unknown>;
  delivery: DeliveryView;
  /** The driver's live position, or null before the first fix (or when location is denied). */
  coordinate: MapCoordinate | null;
  locationDenied: boolean;
  landmarks: LocationMapMarker[];
};

/**
 * The driver's map for one active delivery: their own position, the pickup store and the
 * customer's destination, kept in view while they drive.
 *
 * Follow mode keeps the driver's dot centred as fixes arrive; dragging the map by hand releases it
 * (so the driver can look ahead without being snapped back) and "Follow me" takes it up again.
 * "Whole trip" frames all three points. Turn-by-turn directions are handed to the phone's own
 * navigation app, because the maps used across JOVO show position but do not route.
 */
export function DeliveryNavigationMap({ delivery, coordinate, locationDenied, landmarks, onBeforeHandOff }: DeliveryNavigationMapProps) {
  const { t, i18n } = useTranslation(["driver"]);
  const [following, setFollowing] = useState(true);
  const [fitTick, setFitTick] = useState(0);
  // The road route store -> customer. It never changes for a delivery, so it is fetched once per
  // delivery, not on every position update; the server caches it as well.
  const [routeState, setRouteState] = useState<{ deliveryId: string; result: DeliveryRoute | "failed" } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getAccessToken()
      .then((accessToken) => (accessToken ? getDeliveryRoute(accessToken, delivery.id) : Promise.reject(new Error("no session"))))
      .then((result) => !cancelled && setRouteState({ deliveryId: delivery.id, result }))
      .catch(() => !cancelled && setRouteState({ deliveryId: delivery.id, result: "failed" }));
    return () => {
      cancelled = true;
    };
  }, [delivery.id]);
  const road = routeState?.deliveryId === delivery.id && routeState.result !== "failed" ? routeState.result.route : null;
  const roadLine = useMemo(() => routeCoordinates(road?.points), [road]);
  const routeSettled = routeState?.deliveryId === delivery.id;

  const pins = useMemo(
    () =>
      deliveryPins(delivery, coordinate, { driver: t("map.you") }, {
        driver: colors.info,
        store: colors.success,
        destination: colors.primary
      }),
    [delivery, coordinate, t]
  );
  const target = useMemo(() => navigationTarget(delivery), [delivery]);

  const camera: LocationMapCamera =
    following && coordinate
      ? { mode: "follow", coordinate }
      : { mode: "fit", coordinates: pins.map(({ latitude, longitude }) => ({ latitude, longitude })), key: `fit-${fitTick}-${delivery.status}` };

  const distanceMeters = target && coordinate ? haversineMeters(coordinate, target.coordinate) : null;

  async function openNavigationApp() {
    if (!target) return;
    // Handing off backgrounds JOVO. Before that, make sure the driver has been told what background
    // location is and has decided, so their position keeps reaching dispatch while they navigate.
    await onBeforeHandOff?.().catch(() => undefined);
    const url = externalNavigationUrl(Platform.OS, target.coordinate);
    try {
      await Linking.openURL(url);
    } catch {
      // No handler for the native scheme (e.g. Google Maps missing): the web directions page works everywhere.
      try {
        await Linking.openURL(externalNavigationUrl("web", target.coordinate));
      } catch {
        Alert.alert(t("map.navigate"), t("map.navigateFailed"));
      }
    }
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.mapFrame}>
        <LocationMap
          camera={camera}
          coordinate={coordinate ?? target?.coordinate ?? fallbackCoordinate}
          height={320}
          markers={landmarks}
          onUserPan={() => setFollowing(false)}
          pins={pins}
          route={roadLine}
        />
      </View>

      {target ? (
        <View style={styles.targetRow}>
          <View style={[styles.targetDot, { backgroundColor: target.kind === "pickup" ? colors.success : colors.primary }]} />
          <View style={styles.targetCopy}>
            <Text style={styles.targetLabel}>
              {target.kind === "pickup" ? t("map.headingToPickup") : t("map.headingToCustomer")}
            </Text>
            <Text numberOfLines={1} style={styles.targetName}>{target.label}</Text>
          </View>
          {distanceMeters !== null ? (
            <Text style={styles.distance}>{t("map.distanceAway", { distance: formatDistance(distanceMeters, i18n.language) })}</Text>
          ) : null}
        </View>
      ) : (
        <Text style={styles.notice}>{t("map.noCoordinates")}</Text>
      )}

      {road ? (
        <Text style={styles.routeSummary}>
          {t("map.routeSummary", {
            distance: formatDistance(road.distanceMeters, i18n.language),
            duration: formatDuration(road.durationSeconds, i18n.language)
          })}
        </Text>
      ) : routeSettled ? (
        <Text style={styles.notice}>{t("map.routeUnavailable")}</Text>
      ) : null}

      {locationDenied ? <Text style={styles.warning}>{t("map.locationDenied")}</Text> : null}

      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: following }}
          disabled={!coordinate}
          onPress={() => setFollowing(true)}
          style={[styles.chip, following && coordinate ? styles.chipOn : null, !coordinate && styles.chipDisabled]}
        >
          <Text style={[styles.chipText, following && coordinate ? styles.chipTextOn : null]}>
            {following ? t("map.following") : t("map.followMe")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setFollowing(false);
            setFitTick((tick) => tick + 1);
          }}
          style={styles.chip}
        >
          <Text style={styles.chipText}>{t("map.wholeTrip")}</Text>
        </Pressable>
      </View>

      {target ? (
        <Pressable accessibilityRole="button" onPress={() => void openNavigationApp()} style={styles.navigateButton}>
          <Text style={styles.navigateText}>
            {target.kind === "pickup" ? t("map.navigateToPickup") : t("map.navigateToCustomer")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: spacing[4] },
  mapFrame: { marginVertical: -spacing[3] },
  targetRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing[3],
    marginTop: spacing[3],
    padding: spacing[3]
  },
  targetDot: { borderRadius: radius.pill, height: 12, width: 12 },
  targetCopy: { flex: 1 },
  targetLabel: { ...text("caption", "bold"), color: colors.textMuted },
  targetName: { ...text("bodySm", "bold"), color: colors.text, marginTop: spacing[1] },
  distance: { ...text("bodySm", "bold"), color: colors.primary },
  routeSummary: { ...text("caption", "bold"), color: colors.info, marginTop: spacing[2], textAlign: "center" },
  notice: { ...text("caption"), color: colors.textMuted, marginTop: spacing[3], textAlign: "center" },
  warning: { ...text("caption"), color: colors.error, marginTop: spacing[2], textAlign: "center" },
  controls: { flexDirection: "row", gap: spacing[2], marginTop: spacing[3] },
  chip: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing[3]
  },
  chipOn: { backgroundColor: colors.info, borderColor: colors.info },
  chipDisabled: { opacity: 0.5 },
  chipText: { ...text("bodySm", "bold"), color: colors.text },
  chipTextOn: { color: colors.textInverse },
  navigateButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    marginTop: spacing[3],
    minHeight: 52,
    justifyContent: "center",
    paddingVertical: spacing[3]
  },
  navigateText: { ...text("body", "bold"), color: colors.textInverse }
});
