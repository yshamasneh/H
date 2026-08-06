import { useEffect, useState } from "react";
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
  ApiError,
  acceptDelivery,
  listAvailableDeliveries,
  listMyDeliveries,
  setDriverOnlineStatus,
  updateDeliveryStatus,
  type DeliveryStatusValue,
  type DeliveryView,
  type DriverDeliveryStatusAction
} from "./api";
import { getAccessToken } from "./session";

const currencyCode = "ILS";

const activeDeliveryStatuses: DeliveryStatusValue[] = ["ASSIGNED", "PICKED_UP", "ON_THE_WAY"];

const nextActionByStatus: Partial<Record<DeliveryStatusValue, { action: DriverDeliveryStatusAction; label: string }>> = {
  ASSIGNED: { action: "PICKED_UP", label: "Mark Picked Up" },
  PICKED_UP: { action: "ON_THE_WAY", label: "Start Delivery" },
  ON_THE_WAY: { action: "DELIVERED", label: "Mark Delivered" }
};

type DriverHomeScreenProps = {
  onBack: () => void;
  onOpenDelivery: (deliveryId: string) => void;
};

export function DriverHomeScreen(props: DriverHomeScreenProps) {
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
        setError("Your session has expired. Please log in again.");
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
        setError("Your session has expired. Please log in again.");
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
        setError("Your session has expired. Please log in again.");
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
      <StatusBar backgroundColor="#F5FAFC" barStyle="dark-content" />
      <Header onBack={props.onBack} subtitle="Toggle online to see deliveries" title="Delivery Dashboard" />
      <View style={styles.onlineRow}>
        <Text style={styles.onlineLabel}>{isOnline ? "You are online" : "You are offline"}</Text>
        {togglingOnline ? (
          <ActivityIndicator color="#0F766E" />
        ) : (
          <Switch onValueChange={toggleOnline} thumbColor="#FFFFFF" trackColor={{ true: "#0F766E" }} value={isOnline} />
        )}
      </View>
      {error ? <ErrorText message={error} /> : null}
      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl onRefresh={refresh} refreshing={refreshing} tintColor="#0F766E" />}
      >
        {mine === null || available === null ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#0F766E" size="large" />
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Your active deliveries</Text>
            {mine.length === 0 ? (
              <Text style={styles.emptyText}>You have no active deliveries.</Text>
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
                  <Text style={styles.cardSubtitle}>Deliver to: {delivery.order.deliveryAddressLine}</Text>
                </Pressable>
              ))
            )}

            <Text style={styles.sectionTitle}>Available deliveries</Text>
            {!isOnline ? (
              <Text style={styles.emptyText}>Go online to see and accept deliveries.</Text>
            ) : available.length === 0 ? (
              <Text style={styles.emptyText}>No deliveries are waiting for a driver right now.</Text>
            ) : (
              available.map((delivery) => (
                <View key={delivery.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{delivery.restaurant.name}</Text>
                  <Text style={styles.cardSubtitle}>Pickup: {delivery.restaurant.addressLine}</Text>
                  <Text style={styles.cardSubtitle}>Deliver to: {delivery.order.deliveryAddressLine}</Text>
                  <Text style={styles.cardTotal}>{formatPrice(delivery.order.totalMinor)}</Text>
                  <ActionButton
                    label="Accept Delivery"
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

type DeliveryDetailScreenProps = {
  deliveryId: string;
  onBack: () => void;
};

export function DeliveryDetailScreen(props: DeliveryDetailScreenProps) {
  const [delivery, setDelivery] = useState<DeliveryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  async function load() {
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError("Your session has expired. Please log in again.");
        return;
      }
      const page = await listMyDeliveries(accessToken, 1, 50);
      const found = page.items.find((item) => item.id === props.deliveryId) ?? null;
      if (!found) {
        setError("This delivery could not be found.");
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
    const next = nextActionByStatus[delivery.status];
    if (!next) return;
    setActing(true);
    setActionError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setActionError("Your session has expired. Please log in again.");
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
      <StatusBar backgroundColor="#F5FAFC" barStyle="dark-content" />
      <Header onBack={props.onBack} subtitle={delivery?.restaurant.name ?? "Delivery"} title="Delivery Details" />
      {error ? (
        <View style={styles.centered}>
          <ErrorState message={error} onRetry={load} />
        </View>
      ) : delivery === null ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#0F766E" size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.formContent}>
          <View style={styles.summaryCard}>
            <View style={styles.orderRowHeader}>
              <Text style={styles.sectionTitle}>Status</Text>
              <StatusBadge status={delivery.status} />
            </View>
            <Text style={styles.label}>Pickup from</Text>
            <Text style={styles.addressText}>
              {delivery.restaurant.name} - {delivery.restaurant.addressLine}
            </Text>
            <Text style={styles.label}>Deliver to</Text>
            <Text style={styles.addressText}>
              {delivery.order.deliveryLabel} - {delivery.order.deliveryAddressLine}
            </Text>
            <Text style={styles.label}>Order total</Text>
            <Text style={styles.addressText}>
              {formatPrice(delivery.order.totalMinor)} ({paymentMethodLabel(delivery.order.paymentMethod)})
            </Text>
          </View>

          {nextActionByStatus[delivery.status] ? (
            <ActionButton
              label={nextActionByStatus[delivery.status]!.label}
              loading={acting}
              onPress={advance}
            />
          ) : (
            <Text style={styles.footerNote}>This delivery is complete.</Text>
          )}
          <ErrorText message={actionError} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

export function StatusBadge(props: { status: DeliveryStatusValue }) {
  const palette = statusPalette(props.status);
  return (
    <View style={[styles.statusBadge, { backgroundColor: palette.background }]}>
      <Text style={[styles.statusBadgeText, { color: palette.text }]}>{props.status.replace(/_/g, " ")}</Text>
    </View>
  );
}

function statusPalette(status: DeliveryStatusValue): { background: string; text: string } {
  switch (status) {
    case "PENDING_ASSIGNMENT":
      return { background: "#FEF9C3", text: "#854D0E" };
    case "ASSIGNED":
    case "PICKED_UP":
    case "ON_THE_WAY":
      return { background: "#DBEAFE", text: "#1E40AF" };
    case "DELIVERED":
      return { background: "#DCFCE7", text: "#166534" };
    case "CANCELLED":
      return { background: "#FEE2E2", text: "#B91C1C" };
  }
}

function Header(props: { title: string; subtitle: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" onPress={props.onBack} style={styles.backButton}>
        <Text style={styles.backButtonText}>Back</Text>
      </Pressable>
      <Text style={styles.headerTitle}>{props.title}</Text>
      <Text style={styles.headerSubtitle}>{props.subtitle}</Text>
    </View>
  );
}

function ErrorState(props: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{props.message}</Text>
      {props.onRetry ? (
        <Pressable onPress={props.onRetry} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Try Again</Text>
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
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <Text style={styles.actionButtonText}>{props.label}</Text>
      )}
    </Pressable>
  );
}

function paymentMethodLabel(method: string): string {
  switch (method) {
    case "CASH":
      return "Cash on Delivery";
    default:
      return method;
  }
}

function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ${currencyCode}`;
}

function readError(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message;
  }
  return "The request could not be completed. Please try again.";
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#F5FAFC", flex: 1 },
  header: {
    backgroundColor: "#FFFFFF",
    borderBottomColor: "#D9E2EC",
    borderBottomWidth: 1,
    padding: 20,
    paddingTop: 12
  },
  backButton: { alignSelf: "flex-start", marginBottom: 10, paddingVertical: 4 },
  backButtonText: { color: "#0369A1", fontSize: 14, fontWeight: "700" },
  headerTitle: { color: "#0F172A", fontSize: 24, fontWeight: "800" },
  headerSubtitle: { color: "#64748B", fontSize: 14, marginTop: 4 },
  onlineRow: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderBottomColor: "#D9E2EC",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14
  },
  onlineLabel: { color: "#0F172A", fontSize: 15, fontWeight: "700" },
  centered: { alignItems: "center", flex: 1, justifyContent: "center", padding: 24 },
  emptyText: { color: "#64748B", fontSize: 14, marginBottom: 16 },
  listContent: { padding: 16, paddingBottom: 40 },
  formContent: { padding: 16, paddingBottom: 40 },
  sectionTitle: { color: "#0F172A", fontSize: 16, fontWeight: "800", marginBottom: 10, marginTop: 6 },
  card: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D9E2EC",
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    padding: 16
  },
  cardPressed: { backgroundColor: "#F0FDFA", borderColor: "#0F766E" },
  cardTitle: { color: "#0F172A", fontSize: 15, fontWeight: "800" },
  cardSubtitle: { color: "#64748B", fontSize: 13, marginTop: 4 },
  cardTotal: { color: "#0F766E", fontSize: 15, fontWeight: "800", marginTop: 8 },
  orderRowHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusBadgeText: { fontSize: 11, fontWeight: "800" },
  summaryCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D9E2EC",
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
    padding: 16
  },
  label: { color: "#334155", fontSize: 13, fontWeight: "700", marginBottom: 6, marginTop: 10 },
  addressText: { color: "#0F172A", fontSize: 14 },
  actionButton: {
    alignItems: "center",
    backgroundColor: "#0F766E",
    borderRadius: 12,
    marginTop: 10,
    paddingVertical: 14
  },
  actionButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  buttonPressed: { opacity: 0.85 },
  footerNote: { color: "#64748B", fontSize: 13, marginTop: 6, textAlign: "center" },
  errorBox: { alignItems: "center" },
  errorText: { color: "#B91C1C", fontSize: 14, lineHeight: 20, textAlign: "center" },
  inlineErrorText: { color: "#B91C1C", fontSize: 13, marginTop: 10, textAlign: "center" },
  retryButton: {
    borderColor: "#0F766E",
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10
  },
  retryButtonText: { color: "#0F766E", fontSize: 14, fontWeight: "800" }
});
