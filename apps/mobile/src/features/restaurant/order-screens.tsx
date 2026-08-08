import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useOrderRealtime, useRealtimeEvent } from "../../core/socket";
import {
  ApiError,
  getRestaurantOrder,
  listRestaurantMenuItems,
  listRestaurantOrders,
  proposeOrderItemFulfillment,
  updateOrderStatus,
  type MenuItemOwner,
  type OrderDetail,
  type OrderItemView,
  type OrderStatusValue,
  type RestaurantOrderStatusAction
} from "../../core/api";
import { getAccessToken } from "../../core/session";
import { nextRestaurantActionsByStatus } from "./order.rules";

const currencyCode = "ILS";

type RestaurantOrdersScreenProps = {
  onBack: () => void;
  onOpenOrder: (orderId: string) => void;
};

export function RestaurantOrdersScreen(props: RestaurantOrdersScreenProps) {
  const [orders, setOrders] = useState<OrderDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError("Your session has expired. Please log in again.");
        return;
      }
      const page = await listRestaurantOrders(accessToken, 1, 20);
      setOrders(page.items);
    } catch (requestError) {
      setError(readError(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useRealtimeEvent("order.created", () => void load());
  useRealtimeEvent("order.status.changed", () => void load());
  useRealtimeEvent("order.fulfillment.changed", () => void load());

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor="#F5FAFC" barStyle="dark-content" />
      <Header onBack={props.onBack} subtitle="Most recent first" title="Incoming Orders" />
      {orders === null ? (
        <View style={styles.centered}>
          {error ? <ErrorState message={error} onRetry={load} /> : <ActivityIndicator color="#0F766E" size="large" />}
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No orders yet.</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={orders}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl onRefresh={refresh} refreshing={refreshing} tintColor="#0F766E" />}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => props.onOpenOrder(item.id)}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            >
              <View style={styles.orderRowHeader}>
                <Text style={styles.cardTitle}>{formatDate(item.createdAt)}</Text>
                <StatusBadge status={item.status} />
              </View>
              <Text style={styles.cardSubtitle}>
                {item.items.reduce((sum, line) => sum + line.quantity, 0)} item(s)
              </Text>
              <Text style={styles.orderRowTotal}>{formatPrice(item.totalMinor)}</Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

type RestaurantOrderDetailScreenProps = {
  orderId: string;
  onBack: () => void;
};

export function RestaurantOrderDetailScreen(props: RestaurantOrderDetailScreenProps) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItemOwner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<RestaurantOrderStatusAction | null>(null);
  const [proposingFor, setProposingFor] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError("Your session has expired. Please log in again.");
        return;
      }
      const [nextOrder, nextMenuItems] = await Promise.all([
        getRestaurantOrder(accessToken, props.orderId),
        listRestaurantMenuItems(accessToken)
      ]);
      setOrder(nextOrder);
      setMenuItems(nextMenuItems);
    } catch (requestError) {
      setError(readError(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, [props.orderId]);

  useOrderRealtime(props.orderId, () => void load());

  async function performAction(action: RestaurantOrderStatusAction) {
    setActionError(null);
    setActingOn(action);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setActionError("Your session has expired. Please log in again.");
        return;
      }
      const updated = await updateOrderStatus(accessToken, props.orderId, action);
      setOrder(updated);
    } catch (requestError) {
      setActionError(readError(requestError));
    } finally {
      setActingOn(null);
    }
  }

  async function proposeFulfillment(
    orderItemId: string,
    input: { replacementMenuItemId?: string; actualQuantityMilli?: number; note?: string }
  ) {
    setActionError(null);
    setProposingFor(orderItemId);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setActionError("Your session has expired. Please log in again.");
        return;
      }
      setOrder(await proposeOrderItemFulfillment(accessToken, props.orderId, orderItemId, input));
    } catch (requestError) {
      setActionError(readError(requestError));
    } finally {
      setProposingFor(null);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor="#F5FAFC" barStyle="dark-content" />
      <Header onBack={props.onBack} subtitle={order ? formatDate(order.createdAt) : "Order"} title="Order Details" />
      {error ? (
        <View style={styles.centered}>
          <ErrorState message={error} onRetry={load} />
        </View>
      ) : order === null ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#0F766E" size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.formContent}>
          <View style={styles.summaryCard}>
            <View style={styles.orderRowHeader}>
              <Text style={styles.sectionTitle}>Status</Text>
              <StatusBadge status={order.status} />
            </View>
            {order.items.map((item) => (
              <View key={item.id} style={styles.orderItemBlock}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryRowLabel}>
                    {item.quantity} x {item.nameSnapshot} / {item.unitLabelSnapshot}
                    {item.allowSubstitution ? " / replacement allowed" : ""}
                  </Text>
                  <Text style={styles.summaryRowValue}>{formatPrice(item.lineTotalMinor)}</Text>
                </View>
                {item.fulfillmentAdjustment ? <FulfillmentSummary item={item} /> : null}
                {order.status === "PLACED" && item.fulfillmentAdjustment?.status !== "APPROVED" &&
                (item.allowSubstitution || item.isVariableWeightSnapshot) ? (
                  <FulfillmentEditor
                    busy={proposingFor === item.id}
                    item={item}
                    menuItems={menuItems}
                    onSubmit={(input) => proposeFulfillment(item.id, input)}
                  />
                ) : null}
              </View>
            ))}
            <View style={styles.summaryDivider} />
            <View style={styles.summaryRow}>
              <Text style={styles.summaryRowLabelBold}>Total</Text>
              <Text style={styles.summaryRowValueBold}>{formatPrice(order.totalMinor)}</Text>
            </View>
            <View style={styles.summaryDivider} />
            <Text style={styles.label}>Delivery address</Text>
            <Text style={styles.addressText}>
              {order.deliveryLabel} - {order.deliveryAddressLine}
            </Text>
          </View>

          <StatusTimeline history={order.statusHistory} />

          {nextRestaurantActionsByStatus[order.status].length > 0 ? (
            <View style={styles.actionRow}>
              {nextRestaurantActionsByStatus[order.status].map(({ action, label }) => (
                <ActionButton
                  destructive={action === "REJECTED"}
                  key={action}
                  label={label}
                  loading={actingOn === action}
                  onPress={() => performAction(action)}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.footerNote}>No further action is needed from your restaurant for this order.</Text>
          )}
          <ErrorText message={actionError} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function FulfillmentSummary(props: { item: OrderItemView }) {
  const adjustment = props.item.fulfillmentAdjustment!;
  const proposedName = adjustment.replacementNameSnapshot ?? props.item.nameSnapshot;
  return (
    <View style={styles.fulfillmentSummary}>
      <Text style={styles.fulfillmentTitle}>Fulfillment proposal: {adjustment.status}</Text>
      <Text style={styles.fulfillmentText}>
        {proposedName} / {(adjustment.actualQuantityMilli / 1_000).toFixed(3)} {adjustment.replacementUnitLabelSnapshot ?? props.item.unitLabelSnapshot}
      </Text>
      <Text style={styles.fulfillmentText}>Proposed line total: {formatPrice(adjustment.lineTotalMinor)}</Text>
      {adjustment.note ? <Text style={styles.fulfillmentNote}>{adjustment.note}</Text> : null}
    </View>
  );
}

function FulfillmentEditor(props: {
  item: OrderItemView;
  menuItems: MenuItemOwner[];
  busy: boolean;
  onSubmit: (input: { replacementMenuItemId?: string; actualQuantityMilli?: number; note?: string }) => Promise<void>;
}) {
  const [replacementMenuItemId, setReplacementMenuItemId] = useState("");
  const [packedQuantity, setPackedQuantity] = useState(String(props.item.quantity));
  const [note, setNote] = useState("");
  const alternatives = props.menuItems.filter(
    (candidate) => candidate.id !== props.item.menuItemId && candidate.isAvailable &&
      (candidate.stockQuantity === null || candidate.stockQuantity > 0)
  );
  const replacement = alternatives.find((candidate) => candidate.id === replacementMenuItemId);
  const supportsVariableQuantity = replacement?.isVariableWeight ?? props.item.isVariableWeightSnapshot;
  const packedQuantityNumber = Number(packedQuantity.replace(",", "."));
  const quantityIsValid = Number.isFinite(packedQuantityNumber) &&
    packedQuantityNumber >= props.item.quantity * 0.5 && packedQuantityNumber <= props.item.quantity * 1.5;
  const canPropose = Boolean(replacementMenuItemId || props.item.isVariableWeightSnapshot) &&
    (!supportsVariableQuantity || quantityIsValid);

  return (
    <View style={styles.fulfillmentEditor}>
      <Text style={styles.fulfillmentTitle}>
        {props.item.fulfillmentAdjustment?.status === "REJECTED" ? "Revise fulfillment" : "Need a customer decision?"}
      </Text>
      {props.item.allowSubstitution ? (
        <>
          <Text style={styles.editorLabel}>Replacement product (optional)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.replacementPicker}>
            <Pressable
              onPress={() => setReplacementMenuItemId("")}
              style={[styles.replacementChip, !replacementMenuItemId && styles.replacementChipActive]}
            >
              <Text style={[styles.replacementChipText, !replacementMenuItemId && styles.replacementChipTextActive]}>Original product</Text>
            </Pressable>
            {alternatives.map((candidate) => (
              <Pressable
                key={candidate.id}
                onPress={() => setReplacementMenuItemId(candidate.id)}
                style={[styles.replacementChip, replacementMenuItemId === candidate.id && styles.replacementChipActive]}
              >
                <Text style={[styles.replacementChipText, replacementMenuItemId === candidate.id && styles.replacementChipTextActive]}>
                  {candidate.name} / {formatPrice(candidate.priceMinor)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      ) : null}
      {supportsVariableQuantity ? (
        <>
          <Text style={styles.editorLabel}>Actual packed quantity (50%-150% of requested)</Text>
          <TextInput
            keyboardType="decimal-pad"
            onChangeText={setPackedQuantity}
            style={styles.editorInput}
            value={packedQuantity}
          />
        </>
      ) : null}
      <Text style={styles.editorLabel}>Note for the customer (optional)</Text>
      <TextInput onChangeText={setNote} style={styles.editorInput} value={note} />
      <ActionButton
        disabled={!canPropose}
        label={props.item.fulfillmentAdjustment?.status === "PENDING" ? "Replace pending proposal" : "Send for customer review"}
        loading={props.busy}
        onPress={() => void props.onSubmit({
          replacementMenuItemId: replacementMenuItemId || undefined,
          actualQuantityMilli: supportsVariableQuantity ? Math.round(packedQuantityNumber * 1_000) : undefined,
          note: note.trim() || undefined
        })}
      />
    </View>
  );
}

function StatusTimeline(props: { history: OrderDetail["statusHistory"] }) {
  if (props.history.length === 0) return null;
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.sectionTitle}>Status history</Text>
      {props.history.map((entry) => (
        <View key={entry.id} style={styles.timelineRow}>
          <Text style={styles.timelineStatus}>{entry.toStatus}</Text>
          <Text style={styles.timelineDate}>{formatDate(entry.createdAt)}</Text>
          {entry.note ? <Text style={styles.timelineNote}>{entry.note}</Text> : null}
        </View>
      ))}
    </View>
  );
}

export function StatusBadge(props: { status: OrderStatusValue }) {
  const palette = statusPalette(props.status);
  return (
    <View style={[styles.statusBadge, { backgroundColor: palette.background }]}>
      <Text style={[styles.statusBadgeText, { color: palette.text }]}>{props.status.replace(/_/g, " ")}</Text>
    </View>
  );
}

function statusPalette(status: OrderStatusValue): { background: string; text: string } {
  switch (status) {
    case "PLACED":
      return { background: "#FEF9C3", text: "#854D0E" };
    case "ACCEPTED":
    case "PREPARING":
      return { background: "#DBEAFE", text: "#1E40AF" };
    case "READY_FOR_PICKUP":
      return { background: "#E0E7FF", text: "#3730A3" };
    case "DELIVERED":
      return { background: "#DCFCE7", text: "#166534" };
    case "REJECTED":
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

function ActionButton(props: { label: string; loading?: boolean; disabled?: boolean; destructive?: boolean; onPress: () => void }) {
  return (
    <Pressable
      disabled={props.loading || props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.actionButton,
        props.destructive && styles.actionButtonDestructive,
        (pressed || props.loading) && styles.buttonPressed,
        props.disabled && styles.buttonDisabled
      ]}
    >
      {props.loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <Text style={styles.actionButtonText}>{props.label}</Text>
      )}
    </Pressable>
  );
}

function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ${currencyCode}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
  centered: { alignItems: "center", flex: 1, justifyContent: "center", padding: 24 },
  emptyText: { color: "#64748B", fontSize: 15, textAlign: "center" },
  listContent: { padding: 16, paddingBottom: 40 },
  formContent: { padding: 16, paddingBottom: 40 },
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
  orderRowHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  orderRowTotal: { color: "#0F766E", fontSize: 16, fontWeight: "800", marginTop: 8 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusBadgeText: { fontSize: 11, fontWeight: "800" },
  sectionTitle: { color: "#0F172A", fontSize: 16, fontWeight: "800", marginBottom: 10, marginTop: 6 },
  summaryCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D9E2EC",
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
    padding: 16
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  orderItemBlock: { borderBottomColor: "#E2E8F0", borderBottomWidth: 1, paddingBottom: 10, paddingTop: 6 },
  summaryRowLabel: { color: "#475569", flex: 1, fontSize: 14, paddingRight: 8 },
  summaryRowValue: { color: "#0F172A", fontSize: 14, fontWeight: "600" },
  summaryRowLabelBold: { color: "#0F172A", fontSize: 15, fontWeight: "800" },
  summaryRowValueBold: { color: "#0F766E", fontSize: 15, fontWeight: "800" },
  summaryDivider: { backgroundColor: "#E2E8F0", height: 1, marginVertical: 8 },
  label: { color: "#334155", fontSize: 13, fontWeight: "700", marginBottom: 6, marginTop: 10 },
  addressText: { color: "#0F172A", fontSize: 14 },
  timelineRow: { borderColor: "#E2E8F0", borderTopWidth: 1, paddingVertical: 8 },
  timelineStatus: { color: "#0F172A", fontSize: 14, fontWeight: "700" },
  timelineDate: { color: "#64748B", fontSize: 12, marginTop: 2 },
  timelineNote: { color: "#475569", fontSize: 13, fontStyle: "italic", marginTop: 4 },
  actionRow: { gap: 10, marginTop: 6 },
  actionButton: {
    alignItems: "center",
    backgroundColor: "#0F766E",
    borderRadius: 12,
    paddingVertical: 14
  },
  actionButtonDestructive: { backgroundColor: "#B91C1C" },
  actionButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  buttonPressed: { opacity: 0.85 },
  buttonDisabled: { opacity: 0.45 },
  fulfillmentSummary: { backgroundColor: "#F8FAFC", borderRadius: 10, marginTop: 6, padding: 10 },
  fulfillmentEditor: { backgroundColor: "#F0FDFA", borderRadius: 12, marginTop: 10, padding: 12 },
  fulfillmentTitle: { color: "#0F766E", fontSize: 12, fontWeight: "900", marginBottom: 5 },
  fulfillmentText: { color: "#334155", fontSize: 11, lineHeight: 17 },
  fulfillmentNote: { color: "#475569", fontSize: 11, fontStyle: "italic", marginTop: 4 },
  editorLabel: { color: "#334155", fontSize: 11, fontWeight: "800", marginBottom: 5, marginTop: 7 },
  editorInput: { backgroundColor: "#FFFFFF", borderColor: "#CCFBF1", borderRadius: 10, borderWidth: 1, color: "#0F172A", marginBottom: 5, minHeight: 42, paddingHorizontal: 11 },
  replacementPicker: { marginBottom: 4 },
  replacementChip: { backgroundColor: "#FFFFFF", borderColor: "#CCFBF1", borderRadius: 999, borderWidth: 1, marginRight: 7, paddingHorizontal: 10, paddingVertical: 8 },
  replacementChipActive: { backgroundColor: "#0F766E", borderColor: "#0F766E" },
  replacementChipText: { color: "#475569", fontSize: 10, fontWeight: "800" },
  replacementChipTextActive: { color: "#FFFFFF" },
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
