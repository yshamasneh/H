import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  acceptDelivery,
  listAvailableDeliveries,
  listLandmarks,
  listMyDeliveries,
  listMyNotifications,
  setDriverOnlineStatus,
  updateDeliveryStatus,
  updateDriverLocation,
  type DeliveryStatusValue,
  type DeliveryView,
  type DriverDeliveryStatusAction,
  type Landmark,
  type PublicUser
} from "../../core/api";
import { LocationMap } from "../../components/location-map";
import { toLandmarkMarkers, type LocationMapMarker, type LocationMapPin, type MapCoordinate } from "../../components/location-map.types";
import { Skeleton } from "../../components/skeleton";
import { readError } from "../../core/errors";
import { getCurrentCoordinates } from "../../core/location";
import { getAccessToken } from "../../core/session";
import { Icon, disclosureIconName } from "../../theme/icon";
import { colors, radius, spacing, statusFamily, statusPalette as tokenStatusPalette } from "../../theme/tokens";
import { text } from "../../theme/typography";
import { activeDeliveryStatuses, nextDriverActionByStatus } from "./delivery.rules";

const currencyCode = "ILS";
// Default map center: the Biddu-enclave service area (Qatanna, Al-Qubeiba, Biddu,
// Beit Anan, Beit Surik, Beit Ijza), used only until the driver's real GPS
// coordinate is available.
const defaultCoordinate: MapCoordinate = { latitude: 31.83804, longitude: 35.14047 };

type DriverHomeScreenProps = {
  user: PublicUser;
  onOpenDelivery: (deliveryId: string) => void;
  onOpenEarnings: () => void;
  onOpenNotifications: () => void;
  onOpenSettings: () => void;
};

export function DriverHomeScreen(props: DriverHomeScreenProps) {
  const { t } = useTranslation(["driver", "common"]);
  const [isOnline, setIsOnline] = useState(false);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [available, setAvailable] = useState<DeliveryView[] | null>(null);
  const [mine, setMine] = useState<DeliveryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [coordinate, setCoordinate] = useState<MapCoordinate | null>(null);
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const hasActiveDelivery = (mine?.length ?? 0) > 0;

  // The same public landmarks the customer sees on their maps, rendered here as static
  // orientation flags (brand-orange flag+label, zoom-gated by LocationMap) so a driver can
  // navigate by the same reference points. They are separate from the always-visible delivery
  // pins below and reuse the exact customer-side marker shape.
  const landmarkMarkers = useMemo<LocationMapMarker[]>(() => toLandmarkMarkers(landmarks), [landmarks]);

  // The active-delivery map shows three distinct, always-visible markers: the driver's
  // own live position (blue dot), the pickup store (green dot), and the customer's
  // destination (orange delivery pin). Store/destination only appear once an accepted
  // delivery carries valid coordinates; older orders without them are skipped, not crashed.
  const deliveryPins = useMemo<LocationMapPin[]>(() => {
    const pins: LocationMapPin[] = [];
    if (coordinate) {
      pins.push({ id: "driver", latitude: coordinate.latitude, longitude: coordinate.longitude, title: t("home.youAreHere"), color: colors.info, shape: "dot" });
    }
    const active = mine && mine.length > 0 ? mine[0] : null;
    if (active) {
      const store = active.restaurant;
      if (typeof store.latitude === "number" && typeof store.longitude === "number") {
        pins.push({ id: "store", latitude: store.latitude, longitude: store.longitude, title: store.name, color: colors.success, shape: "dot" });
      }
      const destination = active.order;
      if (typeof destination.latitude === "number" && typeof destination.longitude === "number") {
        pins.push({ id: "destination", latitude: destination.latitude, longitude: destination.longitude, title: destination.deliveryAddressLine, color: colors.primary, shape: "pin" });
      }
    }
    return pins;
  }, [coordinate, mine, t]);

  // Centre on the average of whatever markers we have so the driver, store and
  // destination are framed together; fall back to the service-area default.
  const mapCenter: MapCoordinate = deliveryPins.length
    ? {
        latitude: deliveryPins.reduce((sum, pin) => sum + pin.latitude, 0) / deliveryPins.length,
        longitude: deliveryPins.reduce((sum, pin) => sum + pin.longitude, 0) / deliveryPins.length
      }
    : coordinate ?? defaultCoordinate;

  // Read the device location, show it on the map, and report it to the server so dispatch/admin can
  // see where the driver is. Location failures are non-fatal — the map falls back to a default pin.
  async function refreshLocation() {
    try {
      const next = await getCurrentCoordinates();
      setCoordinate(next);
      const accessToken = await getAccessToken();
      if (accessToken) await updateDriverLocation(accessToken, next.latitude, next.longitude);
    } catch {
      setCoordinate((current) => current ?? defaultCoordinate);
    }
  }

  async function load() {
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError(t("common:sessionExpired"));
        return;
      }
      const [availableDeliveries, ownDeliveries, landmarkList] = await Promise.all([
        listAvailableDeliveries(accessToken),
        listMyDeliveries(accessToken, 1, 20),
        // Landmarks are orientation-only; a failed fetch just leaves the map without reference
        // flags, exactly as on the customer side, and must never block the delivery lists.
        listLandmarks(accessToken).catch(() => [] as Landmark[])
      ]);
      setAvailable(availableDeliveries);
      setMine(ownDeliveries.items.filter((delivery) => activeDeliveryStatuses.includes(delivery.status)));
      setLandmarks(landmarkList);
      try {
        const notifications = await listMyNotifications(accessToken, 1, 1);
        setUnreadCount(notifications.unreadCount);
      } catch {
        // A failed unread-count lookup just leaves the badge hidden — not worth surfacing.
      }
    } catch (requestError) {
      setError(readError(requestError));
    }
  }

  useEffect(() => {
    void load();
    void refreshLocation();
  }, []);

  async function refresh() {
    setRefreshing(true);
    await Promise.all([load(), refreshLocation()]);
    setRefreshing(false);
  }

  async function toggleOnline(next: boolean) {
    setTogglingOnline(true);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError(t("common:sessionExpired"));
        return;
      }
      const profile = await setDriverOnlineStatus(accessToken, next);
      setIsOnline(profile.isOnline);
      await load();
      if (profile.isOnline) void refreshLocation();
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setTogglingOnline(false);
    }
  }

  async function accept(delivery: DeliveryView) {
    setAcceptingId(delivery.id);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError(t("common:sessionExpired"));
        return;
      }
      await acceptDelivery(accessToken, delivery.id);
      await load();
      props.onOpenDelivery(delivery.id);
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setAcceptingId(null);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={colors.background} barStyle="dark-content" />
      <View style={styles.topBar}>
        <View style={styles.topBarCopy}>
          <Text style={styles.eyebrow}>JOVO</Text>
          <Text numberOfLines={1} style={styles.greeting}>{t("home.greeting", { name: firstName(props.user.fullName) })}</Text>
        </View>
        <View style={styles.topBarActions}>
          <Pressable accessibilityLabel={t("common:notifications")} onPress={props.onOpenNotifications} style={styles.iconButton}>
            <Icon color={colors.text} name="notifications" size="md" />
            {unreadCount > 0 ? <View style={styles.notificationDot} /> : null}
          </Pressable>
          <Pressable accessibilityLabel={t("common:settings")} onPress={props.onOpenSettings} style={styles.iconButton}>
            <Icon color={colors.text} name="settings" size="md" />
          </Pressable>
        </View>
      </View>
      {error ? <ErrorText message={error} /> : null}
      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl onRefresh={refresh} refreshing={refreshing} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.dashboardHeading}>{t("home.dashboardTitle")}</Text>
        <View style={styles.mapCard}>
          <LocationMap coordinate={mapCenter} height={190} markers={landmarkMarkers} pins={deliveryPins} />
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={togglingOnline}
          onPress={() => toggleOnline(!isOnline)}
          style={[styles.onlineButton, isOnline ? styles.onlineButtonOn : styles.onlineButtonOff]}
        >
          {togglingOnline ? (
            <ActivityIndicator color={isOnline ? colors.textInverse : colors.primary} />
          ) : (
            <>
              <View style={[styles.onlineDot, isOnline ? styles.onlineDotOn : styles.onlineDotOff]} />
              <Text style={[styles.onlineButtonText, isOnline ? styles.onlineButtonTextOn : styles.onlineButtonTextOff]}>
                {isOnline ? t("home.goOfflineButton") : t("home.goOnlineButton")}
              </Text>
            </>
          )}
        </Pressable>

        <Pressable accessibilityRole="button" onPress={props.onOpenEarnings} style={styles.earningsLink}>
          <View style={styles.earningsIcon}><Icon color={colors.primary} name="orders" size="sm" /></View>
          <Text style={styles.earningsLinkText}>{t("home.viewEarnings")}</Text>
          <Icon color={colors.textMuted} name={disclosureIconName()} size="sm" />
        </Pressable>

        {mine === null || available === null ? (
          <>
            <Text style={styles.sectionTitle}>{t("home.yourActiveDeliveries")}</Text>
            <DeliveryCardSkeleton />
            <Text style={styles.sectionTitle}>{t("home.availableDeliveries")}</Text>
            <DeliveryCardSkeleton />
            <DeliveryCardSkeleton />
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>{t("home.yourActiveDeliveries")}</Text>
            {mine.length === 0 ? (
              <View style={styles.emptyCard}><Text style={styles.emptyText}>{t("home.noActiveDeliveries")}</Text></View>
            ) : (
              mine.map((delivery) => (
                <Pressable
                  accessibilityRole="button"
                  key={delivery.id}
                  onPress={() => props.onOpenDelivery(delivery.id)}
                  style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                >
                  <View style={styles.orderRowHeader}>
                    <Text style={styles.cardTitle}>{delivery.restaurant.name}</Text>
                    <StatusBadge status={delivery.status} />
                  </View>
                  <Text style={styles.cardSubtitle}>{t("home.deliverToLabel", { address: delivery.order.deliveryAddressLine })}</Text>
                </Pressable>
              ))
            )}

            <Text style={styles.sectionTitle}>{t("home.availableDeliveries")}</Text>
            {!isOnline ? (
              <View style={styles.emptyCard}><Text style={styles.emptyText}>{t("home.goOnlineToSee")}</Text></View>
            ) : hasActiveDelivery ? (
              <View style={styles.emptyCard}><Text style={styles.emptyText}>{t("home.finishCurrentFirst")}</Text></View>
            ) : available.length === 0 ? (
              <View style={styles.emptyCard}><Text style={styles.emptyText}>{t("home.noDeliveriesWaiting")}</Text></View>
            ) : (
              available.map((delivery) => (
                <View key={delivery.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{delivery.restaurant.name}</Text>
                  <Text style={styles.cardSubtitle}>{t("home.pickupLabel", { address: delivery.restaurant.addressLine })}</Text>
                  <Text style={styles.cardSubtitle}>{t("home.deliverToLabel", { address: delivery.order.deliveryAddressLine })}</Text>
                  <Text style={styles.cardTotal}>{formatPrice(delivery.order.totalMinor)}</Text>
                  <ActionButton
                    label={t("home.acceptDeliveryButton")}
                    loading={acceptingId === delivery.id}
                    onPress={() => accept(delivery)}
                  />
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DeliveryCardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.orderRowHeader}>
        <Skeleton height={14} width="45%" />
        <Skeleton height={20} radius={radius.sm} width={64} />
      </View>
      <Skeleton height={11} style={styles.skeletonLine} width="70%" />
    </View>
  );
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

type DeliveryDetailScreenProps = {
  deliveryId: string;
  onBack: () => void;
};

export function DeliveryDetailScreen(props: DeliveryDetailScreenProps) {
  const { t } = useTranslation(["driver", "common"]);
  const [delivery, setDelivery] = useState<DeliveryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  async function load() {
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError(t("common:sessionExpired"));
        return;
      }
      const page = await listMyDeliveries(accessToken, 1, 50);
      const found = page.items.find((item) => item.id === props.deliveryId) ?? null;
      if (!found) {
        setError(t("detail.notFoundError"));
        return;
      }
      setDelivery(found);
    } catch (requestError) {
      setError(readError(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, [props.deliveryId]);

  async function advance() {
    if (!delivery) return;
    const next = nextDriverActionByStatus[delivery.status];
    if (!next) return;
    setActing(true);
    setActionError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setActionError(t("common:sessionExpired"));
        return;
      }
      const updated = await updateDeliveryStatus(accessToken, delivery.id, next.action);
      setDelivery(updated);
    } catch (requestError) {
      setActionError(readError(requestError));
    } finally {
      setActing(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={colors.surfaceSunk} barStyle="dark-content" />
      <Header onBack={props.onBack} subtitle={delivery?.restaurant.name ?? t("detail.defaultSubtitle")} title={t("detail.detailsTitle")} />
      {error ? (
        <View style={styles.centered}>
          <ErrorState message={error} onRetry={load} />
        </View>
      ) : delivery === null ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.formContent}>
          <View style={styles.summaryCard}>
            <View style={styles.orderRowHeader}>
              <Text style={styles.sectionTitle}>{t("detail.statusLabel")}</Text>
              <StatusBadge status={delivery.status} />
            </View>
            <Text style={styles.label}>{t("detail.pickupFromLabel")}</Text>
            <Text style={styles.addressText}>
              {t("detail.addressLine", { name: delivery.restaurant.name, address: delivery.restaurant.addressLine })}
            </Text>
            <Text style={styles.label}>{t("detail.deliverToLabel")}</Text>
            <Text style={styles.addressText}>
              {t("detail.deliverAddressLine", { label: delivery.order.deliveryLabel, address: delivery.order.deliveryAddressLine })}
            </Text>
            <Text style={styles.label}>{t("detail.orderTotalLabel")}</Text>
            <Text style={styles.addressText}>
              {t("detail.totalWithPayment", { amount: formatPrice(delivery.order.totalMinor), method: paymentMethodLabel(delivery.order.paymentMethod, t) })}
            </Text>
          </View>

          {nextDriverActionByStatus[delivery.status] ? (
            <ActionButton
              label={t(nextDriverActionByStatus[delivery.status]!.labelKey)}
              loading={acting}
              onPress={advance}
            />
          ) : (
            <Text style={styles.footerNote}>{t("detail.deliveryComplete")}</Text>
          )}
          <ErrorText message={actionError} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

export function StatusBadge(props: { status: DeliveryStatusValue }) {
  const { t } = useTranslation(["common"]);
  const palette = tokenStatusPalette[statusFamily(props.status)];
  return (
    <View style={[styles.statusBadge, { backgroundColor: palette.background }]}>
      <Text style={[styles.statusBadgeText, { color: palette.foreground }]}>{t(`status.${props.status}`, props.status.replace(/_/g, " "))}</Text>
    </View>
  );
}

function Header(props: { title: string; subtitle: string; onBack: () => void }) {
  const { t } = useTranslation(["common"]);
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" onPress={props.onBack} style={styles.backButton}>
        <Text style={styles.backButtonText}>{t("back")}</Text>
      </Pressable>
      <Text style={styles.headerTitle}>{props.title}</Text>
      <Text style={styles.headerSubtitle}>{props.subtitle}</Text>
    </View>
  );
}

function ErrorState(props: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation(["driver"]);
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{props.message}</Text>
      {props.onRetry ? (
        <Pressable onPress={props.onRetry} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>{t("detail.tryAgain")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text style={styles.inlineErrorText}>{message}</Text>;
}

function ActionButton(props: { label: string; loading?: boolean; onPress: () => void }) {
  return (
    <Pressable
      disabled={props.loading}
      onPress={props.onPress}
      style={({ pressed }) => [styles.actionButton, (pressed || props.loading) && styles.buttonPressed]}
    >
      {props.loading ? (
        <ActivityIndicator color={colors.textInverse} />
      ) : (
        <Text style={styles.actionButtonText}>{props.label}</Text>
      )}
    </Pressable>
  );
}

function paymentMethodLabel(method: string, t: (key: string) => string): string {
  switch (method) {
    case "CASH":
      return t("detail.cashOnDelivery");
    default:
      return method;
  }
}

function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ${currencyCode}`;
}


const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  topBar: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4]
  },
  topBarCopy: { flex: 1, paddingEnd: spacing[3] },
  eyebrow: { ...text("caption", "bold"), color: colors.primary },
  greeting: { ...text("h2", "bold"), color: colors.text, marginTop: spacing[1] },
  topBarActions: { flexDirection: "row", gap: spacing[2] },
  iconButton: { alignItems: "center", backgroundColor: colors.surfaceSunk, borderRadius: radius.lg, height: 44, justifyContent: "center", position: "relative", width: 44 },
  notificationDot: { backgroundColor: colors.primary, borderRadius: radius.pill, height: 10, position: "absolute", right: 10, top: 10, width: 10 },
  earningsIcon: { alignItems: "center", backgroundColor: colors.primarySubtle, borderRadius: radius.md, height: 36, justifyContent: "center", width: 36 },
  emptyCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing[3], padding: spacing[5] },
  skeletonLine: { marginTop: spacing[3] },
  dashboardHeading: { ...text("h2", "bold"), color: colors.text, marginBottom: spacing[3] },
  header: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    padding: spacing[5],
    paddingTop: spacing[3]
  },
  backButton: { alignSelf: "flex-start", marginBottom: spacing[2], paddingVertical: spacing[1] },
  backButtonText: { ...text("bodySm", "bold"), color: colors.textMuted },
  headerTitle: { ...text("h1", "bold"), color: colors.text },
  headerSubtitle: { ...text("bodySm"), color: colors.textMuted, marginTop: spacing[1] },
  onlineRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4]
  },
  onlineLabel: { ...text("body", "bold"), color: colors.text },
  mapCard: { borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing[4], overflow: "hidden" },
  onlineButton: { alignItems: "center", borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: spacing[2], justifyContent: "center", marginBottom: spacing[3], minHeight: 54 },
  onlineButtonOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  onlineButtonOff: { backgroundColor: colors.surface, borderColor: colors.primary },
  onlineDot: { borderRadius: radius.pill, height: 10, width: 10 },
  onlineDotOn: { backgroundColor: colors.textInverse },
  onlineDotOff: { backgroundColor: colors.primary },
  onlineButtonText: { ...text("body", "bold") },
  onlineButtonTextOn: { color: colors.textInverse },
  onlineButtonTextOff: { color: colors.primary },
  earningsLink: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: spacing[3], marginBottom: spacing[5], paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  earningsLinkText: { ...text("bodySm", "bold"), color: colors.text, flex: 1 },
  centered: { alignItems: "center", flex: 1, justifyContent: "center", padding: spacing[6] },
  emptyText: { ...text("bodySm"), color: colors.textMuted, textAlign: "center" },
  settingsLink: { alignItems: "center", flexDirection: "row", gap: spacing[2], justifyContent: "center", marginTop: spacing[6], paddingVertical: spacing[3] },
  settingsLinkText: { ...text("bodySm", "medium"), color: colors.textMuted },
  listContent: { padding: spacing[4], paddingBottom: spacing[8] },
  formContent: { padding: spacing[4], paddingBottom: spacing[8] },
  sectionTitle: { ...text("h3", "bold"), color: colors.text, marginBottom: spacing[2], marginTop: spacing[1] },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing[3],
    padding: spacing[4]
  },
  cardPressed: { backgroundColor: colors.primarySubtle, borderColor: colors.primary },
  cardTitle: { ...text("bodySm", "bold"), color: colors.text },
  cardSubtitle: { ...text("caption"), color: colors.textMuted, marginTop: spacing[1] },
  cardTotal: { ...text("bodySm", "bold"), color: colors.primary, marginTop: spacing[2] },
  orderRowHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  statusBadge: { borderRadius: radius.sm, paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
  statusBadgeText: { ...text("label", "bold") },
  summaryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing[4],
    padding: spacing[4]
  },
  label: { ...text("caption", "bold"), color: colors.text, marginBottom: spacing[2], marginTop: spacing[3] },
  addressText: { ...text("bodySm"), color: colors.text },
  actionButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    marginTop: spacing[3],
    paddingVertical: spacing[4]
  },
  actionButtonText: { ...text("bodySm", "bold"), color: colors.textInverse },
  buttonPressed: { opacity: 0.85 },
  footerNote: { ...text("caption"), color: colors.textMuted, marginTop: spacing[2], textAlign: "center" },
  errorBox: { alignItems: "center" },
  errorText: { ...text("bodySm"), color: colors.error, textAlign: "center" },
  inlineErrorText: { ...text("caption"), color: colors.error, marginTop: spacing[3], textAlign: "center" },
  retryButton: {
    borderColor: colors.primary,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing[4],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3]
  },
  retryButtonText: { ...text("bodySm", "bold"), color: colors.primary }
});
