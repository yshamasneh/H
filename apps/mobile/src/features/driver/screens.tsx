import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  acceptDelivery,
  listAvailableDeliveries,
  listMyDeliveries,
  setDriverOnlineStatus,
  updateDeliveryStatus,
  type DeliveryStatusValue,
  type DeliveryView,
  type DriverDeliveryStatusAction
} from "../../core/api";
import { readError } from "../../core/errors";
import { getAccessToken } from "../../core/session";
import { Icon } from "../../theme/icon";
import { colors, radius, spacing, statusFamily, statusPalette as tokenStatusPalette } from "../../theme/tokens";
import { text } from "../../theme/typography";
import { activeDeliveryStatuses, nextDriverActionByStatus } from "./delivery.rules";

const currencyCode = "ILS";

type DriverHomeScreenProps = {
  onBack: () => void;
  onOpenDelivery: (deliveryId: string) => void;
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

  async function load() {
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError(t("common:sessionExpired"));
        return;
      }
      const [availableDeliveries, ownDeliveries] = await Promise.all([
        listAvailableDeliveries(accessToken),
        listMyDeliveries(accessToken, 1, 20)
      ]);
      setAvailable(availableDeliveries);
      setMine(ownDeliveries.items.filter((delivery) => activeDeliveryStatuses.includes(delivery.status)));
    } catch (requestError) {
      setError(readError(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function refresh() {
    setRefreshing(true);
    await load();
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
      <StatusBar backgroundColor={colors.surfaceSunk} barStyle="dark-content" />
      <Header onBack={props.onBack} subtitle={t("home.dashboardSubtitle")} title={t("home.dashboardTitle")} />
      <View style={styles.onlineRow}>
        <Text style={styles.onlineLabel}>{isOnline ? t("home.onlineStatus") : t("home.offlineStatus")}</Text>
        {togglingOnline ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Switch onValueChange={toggleOnline} thumbColor={colors.textInverse} trackColor={{ true: colors.primary }} value={isOnline} />
        )}
      </View>
      {error ? <ErrorText message={error} /> : null}
      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl onRefresh={refresh} refreshing={refreshing} tintColor={colors.primary} />}
      >
        {mine === null || available === null ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>{t("home.yourActiveDeliveries")}</Text>
            {mine.length === 0 ? (
              <Text style={styles.emptyText}>{t("home.noActiveDeliveries")}</Text>
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
              <Text style={styles.emptyText}>{t("home.goOnlineToSee")}</Text>
            ) : available.length === 0 ? (
              <Text style={styles.emptyText}>{t("home.noDeliveriesWaiting")}</Text>
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
        <Pressable onPress={props.onOpenSettings} style={styles.settingsLink}>
          <Icon color={colors.textMuted} name="settings" size="sm" />
          <Text style={styles.settingsLinkText}>{t("common:settings")}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
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
  screen: { backgroundColor: colors.surfaceSunk, flex: 1 },
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
  centered: { alignItems: "center", flex: 1, justifyContent: "center", padding: spacing[6] },
  emptyText: { ...text("bodySm"), color: colors.textMuted, marginBottom: spacing[4] },
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
