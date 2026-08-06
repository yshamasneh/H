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
import {
  ApiError,
  cancelMyOrder,
  createOrder,
  getMyOrder,
  listMyOrders,
  orderPaymentMethods,
  type CreateOrderInput,
  type OrderDetail,
  type OrderPaymentMethod
} from "../../core/api";
import {
  cartItemCount,
  cartSubtotalMinor,
  type Cart
} from "./cart";
import { getAccessToken } from "../../core/session";
import { useRealtimeEvent } from "../../core/socket";
import { customerTheme } from "./theme";

const currencyCode = "ILS";

type CartScreenProps = {
  cart: Cart | null;
  onBack: () => void;
  onIncrement: (menuItemId: string) => void;
  onDecrement: (menuItemId: string) => void;
  onRemove: (menuItemId: string) => void;
  onCheckout: () => void;
};

export function CartScreen(props: CartScreenProps) {
  const isEmpty = !props.cart || props.cart.items.length === 0;
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.background} barStyle="dark-content" />
      <Header onBack={props.onBack} subtitle={props.cart?.restaurantName ?? "Your cart is empty"} title="Your Cart" />
      {isEmpty ? (
        <View style={styles.centered}>
          <View style={styles.emptyIcon}><Text style={styles.emptyIconText}>🛒</Text></View>
          <Text style={styles.emptyTitle}>Your basket is waiting</Text>
          <Text style={styles.emptyText}>Add items from a restaurant menu to start an order.</Text>
        </View>
      ) : (
        <>
          <FlatList
            contentContainerStyle={styles.listContent}
            data={props.cart!.items}
            keyExtractor={(item) => item.menuItemId}
            renderItem={({ item }) => (
              <View style={styles.cartRow}>
                <View style={styles.cartItemTop}>
                  <View style={styles.cartItemVisual}><Text style={styles.cartItemEmoji}>🍽️</Text></View>
                  <View style={styles.cartRowInfo}>
                    <Text style={styles.cartRowName}>{item.name}</Text>
                    <Text style={styles.cartRowUnitPrice}>{formatPrice(item.priceMinor)} each</Text>
                    <Text style={styles.cartRowLineTotal}>{formatPrice(item.priceMinor * item.quantity)}</Text>
                  </View>
                  <Pressable
                    accessibilityLabel={`Remove ${item.name} from cart`}
                    onPress={() => props.onRemove(item.menuItemId)}
                    style={styles.removeButton}
                  >
                    <Text style={styles.removeButtonText}>×</Text>
                  </Pressable>
                </View>
                <View style={styles.quantityStepper}>
                  <Pressable
                    accessibilityLabel={`Decrease quantity of ${item.name}`}
                    onPress={() => props.onDecrement(item.menuItemId)}
                    style={styles.stepperButton}
                  >
                    <Text style={styles.stepperButtonText}>-</Text>
                  </Pressable>
                  <Text style={styles.stepperValue}>{item.quantity}</Text>
                  <Pressable
                    accessibilityLabel={`Increase quantity of ${item.name}`}
                    onPress={() => props.onIncrement(item.menuItemId)}
                    style={styles.stepperButton}
                  >
                    <Text style={styles.stepperButtonText}>+</Text>
                  </Pressable>
                </View>
              </View>
            )}
          />
          <View style={styles.footer}>
            <View style={styles.footerRow}>
              <Text style={styles.footerLabel}>Estimated subtotal</Text>
              <Text style={styles.footerValue}>{formatPrice(cartSubtotalMinor(props.cart!))}</Text>
            </View>
            <Text style={styles.footerNote}>
              Delivery and service fees are calculated at checkout. This subtotal is an estimate only.
            </Text>
            <PrimaryButton label="Proceed to Checkout" onPress={props.onCheckout} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

type CheckoutScreenProps = {
  cart: Cart | null;
  onBack: () => void;
  onPlaced: (order: OrderDetail) => void;
};

export function CheckoutScreen(props: CheckoutScreenProps) {
  const [deliveryLabel, setDeliveryLabel] = useState("Home");
  const [deliveryAddressLine, setDeliveryAddressLine] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<OrderPaymentMethod>("CASH");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(null);
    if (!props.cart || props.cart.items.length === 0) {
      setError("Your cart is empty.");
      return;
    }
    if (deliveryLabel.trim().length < 1) {
      setError("Please enter a label for this address, like Home or Work.");
      return;
    }
    if (deliveryAddressLine.trim().length < 3) {
      setError("Please enter your full delivery address.");
      return;
    }
    setLoading(true);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError("Your session has expired. Please log in again.");
        return;
      }
      const input: CreateOrderInput = {
        restaurantId: props.cart.restaurantId,
        items: props.cart.items.map((line) => ({ menuItemId: line.menuItemId, quantity: line.quantity })),
        deliveryLabel: deliveryLabel.trim(),
        deliveryAddressLine: deliveryAddressLine.trim(),
        paymentMethod
      };
      const order = await createOrder(accessToken, input);
      props.onPlaced(order);
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.background} barStyle="dark-content" />
      <Header onBack={props.onBack} subtitle={props.cart?.restaurantName ?? "Checkout"} title="Checkout" />
      <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
        <View style={styles.checkoutSteps}>
          <View style={styles.stepComplete}><Text style={styles.stepCompleteText}>✓</Text></View>
          <View style={styles.stepLine} />
          <View style={styles.stepActive}><Text style={styles.stepActiveText}>2</Text></View>
          <View style={styles.stepLineMuted} />
          <View style={styles.stepMuted}><Text style={styles.stepMutedText}>3</Text></View>
        </View>
        <View style={styles.stepLabels}><Text style={styles.stepLabel}>Basket</Text><Text style={styles.stepLabel}>Details</Text><Text style={styles.stepLabel}>Done</Text></View>
        {props.cart ? (
          <View style={styles.summaryCard}>
            <Text style={styles.sectionTitle}>Order summary (estimate)</Text>
            {props.cart.items.map((item) => (
              <View key={item.menuItemId} style={styles.summaryRow}>
                <Text style={styles.summaryRowLabel}>
                  {item.quantity} x {item.name}
                </Text>
                <Text style={styles.summaryRowValue}>{formatPrice(item.priceMinor * item.quantity)}</Text>
              </View>
            ))}
            <View style={styles.summaryDivider} />
            <View style={styles.summaryRow}>
              <Text style={styles.summaryRowLabelBold}>Estimated subtotal</Text>
              <Text style={styles.summaryRowValueBold}>{formatPrice(cartSubtotalMinor(props.cart))}</Text>
            </View>
            <Text style={styles.footerNote}>
              The final total, including delivery and service fees, is confirmed by the server after you place
              the order.
            </Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Delivery address</Text>
        <Text style={styles.label}>Label</Text>
        <TextInput
          onChangeText={setDeliveryLabel}
          placeholder="Home"
          placeholderTextColor="#94A3B8"
          style={styles.input}
          value={deliveryLabel}
        />
        <Text style={styles.label}>Full address</Text>
        <TextInput
          multiline
          onChangeText={setDeliveryAddressLine}
          placeholder="Street, building, city"
          placeholderTextColor="#94A3B8"
          style={[styles.input, styles.multilineInput]}
          value={deliveryAddressLine}
        />

        <Text style={styles.sectionTitle}>Payment method</Text>
        {orderPaymentMethods.map((method) => (
          <Pressable
            accessibilityRole="button"
            key={method}
            onPress={() => setPaymentMethod(method)}
            style={[styles.paymentOption, paymentMethod === method && styles.paymentOptionSelected]}
          >
            <Text style={[styles.paymentOptionText, paymentMethod === method && styles.paymentOptionTextSelected]}>
              {paymentMethodLabel(method)}
            </Text>
          </Pressable>
        ))}

        <ErrorText message={error} />
        <PrimaryButton label="Place Order" loading={loading} onPress={submit} />
      </ScrollView>
    </SafeAreaView>
  );
}

type OrderConfirmationScreenProps = {
  order: OrderDetail;
  onViewOrders: () => void;
  onDone: () => void;
};

export function OrderConfirmationScreen(props: OrderConfirmationScreenProps) {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.background} barStyle="dark-content" />
      <Header onBack={props.onDone} subtitle={props.order.restaurant.name} title="Order Placed" />
      <ScrollView contentContainerStyle={styles.formContent}>
        <View style={styles.successBanner}>
          <View style={styles.successIcon}><Text style={styles.successIconText}>✓</Text></View>
          <Text style={styles.successTitle}>Your order is confirmed!</Text>
          <Text style={styles.successBannerText}>
            The restaurant has received your order. We’ll keep you updated at every step.
          </Text>
        </View>
        <OrderSummaryCard order={props.order} />
        <PrimaryButton label="View My Orders" onPress={props.onViewOrders} />
        <SecondaryButton label="Back to Home" onPress={props.onDone} />
      </ScrollView>
    </SafeAreaView>
  );
}

type OrderHistoryScreenProps = {
  onBack: () => void;
  onOpenOrder: (orderId: string) => void;
};

export function OrderHistoryScreen(props: OrderHistoryScreenProps) {
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
      const page = await listMyOrders(accessToken, 1, 20);
      setOrders(page.items);
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

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.background} barStyle="dark-content" />
      <Header onBack={props.onBack} subtitle="Most recent first" title="My Orders" />
      {orders === null ? (
        <View style={styles.centered}>
          {error ? <ErrorState message={error} onRetry={load} /> : <ActivityIndicator color={customerTheme.colors.primary} size="large" />}
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.centered}>
          <View style={styles.emptyIcon}><Text style={styles.emptyIconText}>🧾</Text></View>
          <Text style={styles.emptyTitle}>No orders yet</Text>
          <Text style={styles.emptyText}>You have not placed any orders yet.</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={orders}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl onRefresh={refresh} refreshing={refreshing} tintColor={customerTheme.colors.primary} />}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => props.onOpenOrder(item.id)}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            >
              <View style={styles.orderIcon}><Text style={styles.orderIconText}>▤</Text></View>
              <View style={styles.orderRowHeader}>
                <Text style={styles.cardTitle}>{item.restaurant.name}</Text>
                <StatusBadge status={item.status} />
              </View>
              <Text style={styles.cardSubtitle}>{formatDate(item.createdAt)}</Text>
              <Text style={styles.orderRowTotal}>{formatPrice(item.totalMinor)}</Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

type OrderDetailScreenProps = {
  orderId: string;
  onBack: () => void;
};

export function OrderDetailScreen(props: OrderDetailScreenProps) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  async function load() {
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError("Your session has expired. Please log in again.");
        return;
      }
      setOrder(await getMyOrder(accessToken, props.orderId));
    } catch (requestError) {
      setError(readError(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, [props.orderId]);

  useRealtimeEvent("order.status.changed", (payload: any) => {
    if (payload?.orderId === props.orderId) void load();
  });
  useRealtimeEvent("delivery.status.changed", () => void load());

  async function cancelOrder() {
    setCancelling(true);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError("Your session has expired. Please log in again.");
        return;
      }
      setOrder(await cancelMyOrder(accessToken, props.orderId));
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.background} barStyle="dark-content" />
      <Header onBack={props.onBack} subtitle={order?.restaurant.name ?? "Order"} title="Order Details" />
      {error ? (
        <View style={styles.centered}>
          <ErrorState message={error} onRetry={load} />
        </View>
      ) : order === null ? (
        <View style={styles.centered}>
          <ActivityIndicator color={customerTheme.colors.primary} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.formContent}>
          <OrderSummaryCard order={order} />
          {order.delivery ? <DeliveryProgressCard delivery={order.delivery} /> : null}
          <StatusTimeline history={order.statusHistory} />
          {order.status === "PLACED" ? (
            <PrimaryButton destructive label="Cancel Order" loading={cancelling} onPress={cancelOrder} />
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function OrderSummaryCard(props: { order: OrderDetail }) {
  const { order } = props;
  return (
    <View style={styles.summaryCard}>
      <View style={styles.orderRowHeader}>
        <Text style={styles.sectionTitle}>{formatDate(order.createdAt)}</Text>
        <StatusBadge status={order.status} />
      </View>
      {order.items.map((item) => (
        <View key={item.id} style={styles.summaryRow}>
          <Text style={styles.summaryRowLabel}>
            {item.quantity} x {item.nameSnapshot}
          </Text>
          <Text style={styles.summaryRowValue}>{formatPrice(item.lineTotalMinor)}</Text>
        </View>
      ))}
      <View style={styles.summaryDivider} />
      <View style={styles.summaryRow}>
        <Text style={styles.summaryRowLabel}>Subtotal</Text>
        <Text style={styles.summaryRowValue}>{formatPrice(order.subtotalMinor)}</Text>
      </View>
      <View style={styles.summaryRow}>
        <Text style={styles.summaryRowLabel}>Delivery fee</Text>
        <Text style={styles.summaryRowValue}>{formatPrice(order.deliveryFeeMinor)}</Text>
      </View>
      <View style={styles.summaryRow}>
        <Text style={styles.summaryRowLabel}>Service fee</Text>
        <Text style={styles.summaryRowValue}>{formatPrice(order.serviceFeeMinor)}</Text>
      </View>
      {order.discountMinor > 0 ? (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryRowLabel}>Discount</Text>
          <Text style={styles.summaryRowValue}>-{formatPrice(order.discountMinor)}</Text>
        </View>
      ) : null}
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
      <Text style={styles.label}>Payment method</Text>
      <Text style={styles.addressText}>{paymentMethodLabel(order.paymentMethod)}</Text>
    </View>
  );
}

function StatusBadge(props: { status: OrderDetail["status"] }) {
  const palette = statusPalette(props.status);
  return (
    <View style={[styles.statusBadge, { backgroundColor: palette.background }]}>
      <Text style={[styles.statusBadgeText, { color: palette.text }]}>{props.status.replace(/_/g, " ")}</Text>
    </View>
  );
}

function statusPalette(status: OrderDetail["status"]): { background: string; text: string } {
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

function StatusTimeline(props: { history: OrderDetail["statusHistory"] }) {
  if (props.history.length === 0) return null;
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.sectionTitle}>Status history</Text>
      {props.history.map((entry, index) => (
        <View key={entry.id} style={styles.timelineRow}>
          <View style={styles.timelineMarker}>
            <View style={styles.timelineDot} />
            {index < props.history.length - 1 ? <View style={styles.timelineLine} /> : null}
          </View>
          <View style={styles.timelineCopy}>
            <Text style={styles.timelineStatus}>{entry.toStatus.replace(/_/g, " ")}</Text>
            <Text style={styles.timelineDate}>{formatDate(entry.createdAt)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function DeliveryProgressCard(props: { delivery: NonNullable<OrderDetail["delivery"]> }) {
  const { delivery } = props;
  return (
    <View style={styles.summaryCard}>
      <View style={styles.deliveryHeading}>
        <View style={styles.deliveryIcon}><Text style={styles.deliveryIconText}>⌖</Text></View>
        <View><Text style={styles.sectionTitle}>Delivery progress</Text><Text style={styles.footerNote}>Live updates from your driver</Text></View>
      </View>
      <Text style={styles.addressText}>{delivery.status.replace(/_/g, " ")}</Text>
      {delivery.pickedUpAt ? (
        <Text style={styles.footerNote}>Picked up: {formatDate(delivery.pickedUpAt)}</Text>
      ) : null}
      {delivery.onTheWayAt ? (
        <Text style={styles.footerNote}>On the way: {formatDate(delivery.onTheWayAt)}</Text>
      ) : null}
      {delivery.deliveredAt ? (
        <Text style={styles.footerNote}>Delivered: {formatDate(delivery.deliveredAt)}</Text>
      ) : null}
    </View>
  );
}

function Header(props: { title: string; subtitle: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" onPress={props.onBack} style={styles.backButton}>
        <Text style={styles.backButtonText}>‹</Text>
      </Pressable>
      <View style={styles.headerCopy}>
        <Text style={styles.headerTitle}>{props.title}</Text>
        <Text numberOfLines={1} style={styles.headerSubtitle}>{props.subtitle}</Text>
      </View>
      <View style={styles.headerSpacer} />
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

function PrimaryButton(props: { label: string; loading?: boolean; destructive?: boolean; onPress: () => void }) {
  return (
    <Pressable
      disabled={props.loading}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        props.destructive && styles.destructiveButton,
        (pressed || props.loading) && styles.buttonPressed
      ]}
    >
      {props.loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>{props.label}</Text>}
    </Pressable>
  );
}

function SecondaryButton(props: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}>
      <Text style={styles.secondaryButtonText}>{props.label}</Text>
    </Pressable>
  );
}

export function paymentMethodLabel(method: OrderPaymentMethod): string {
  switch (method) {
    case "CASH":
      return "Cash on Delivery";
  }
}

export function cartSummaryLabel(cart: Cart): string {
  const count = cartItemCount(cart);
  return `View Cart (${count}) - ${formatPrice(cartSubtotalMinor(cart))}`;
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
  screen: { backgroundColor: customerTheme.colors.background, flex: 1 },
  header: {
    alignItems: "center",
    backgroundColor: customerTheme.colors.background,
    borderBottomColor: customerTheme.colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14
  },
  backButton: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderRadius: 15, height: 44, justifyContent: "center", width: 44, ...customerTheme.shadow },
  backButtonText: { color: customerTheme.colors.text, fontSize: 29, fontWeight: "500", marginTop: -3 },
  headerCopy: { alignItems: "center", flex: 1 },
  headerSpacer: { width: 44 },
  headerTitle: { color: customerTheme.colors.text, fontSize: 20, fontWeight: "900" },
  headerSubtitle: { color: customerTheme.colors.textMuted, fontSize: 12, marginTop: 3, maxWidth: 250 },
  centered: { alignItems: "center", flex: 1, justifyContent: "center", padding: 24 },
  emptyIcon: { alignItems: "center", backgroundColor: customerTheme.colors.primarySoft, borderRadius: 42, height: 84, justifyContent: "center", marginBottom: 18, width: 84 },
  emptyIconText: { fontSize: 38 },
  emptyTitle: { color: customerTheme.colors.text, fontSize: 21, fontWeight: "900", marginBottom: 7 },
  emptyText: { color: customerTheme.colors.textMuted, fontSize: 14, lineHeight: 20, maxWidth: 310, textAlign: "center" },
  listContent: { alignSelf: "center", maxWidth: 900, padding: 18, paddingBottom: 40, width: "100%" },
  formContent: { alignSelf: "center", maxWidth: 900, padding: 18, paddingBottom: 50, width: "100%" },
  card: {
    backgroundColor: customerTheme.colors.surface,
    borderColor: customerTheme.colors.border,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 15,
    padding: 17,
    ...customerTheme.shadow
  },
  cardPressed: { opacity: 0.72, transform: [{ scale: 0.995 }] },
  cardTitle: { color: customerTheme.colors.text, fontSize: 17, fontWeight: "900" },
  cardSubtitle: { color: customerTheme.colors.textMuted, fontSize: 12, marginTop: 4 },
  orderIcon: { alignItems: "center", backgroundColor: customerTheme.colors.primarySoft, borderRadius: 13, height: 42, justifyContent: "center", marginBottom: 12, width: 42 },
  orderIconText: { color: customerTheme.colors.primary, fontSize: 20, fontWeight: "900" },
  orderRowHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  orderRowTotal: { color: customerTheme.colors.primary, fontSize: 16, fontWeight: "900", marginTop: 9 },
  statusBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  statusBadgeText: { fontSize: 10, fontWeight: "900" },
  timelineRow: { flexDirection: "row", minHeight: 58 },
  timelineMarker: { alignItems: "center", marginRight: 12, width: 16 },
  timelineDot: { backgroundColor: customerTheme.colors.primary, borderColor: customerTheme.colors.primarySoft, borderRadius: 8, borderWidth: 4, height: 16, width: 16 },
  timelineLine: { backgroundColor: customerTheme.colors.primarySoft, flex: 1, width: 3 },
  timelineCopy: { flex: 1, paddingBottom: 13 },
  timelineStatus: { color: customerTheme.colors.text, fontSize: 14, fontWeight: "800" },
  timelineDate: { color: customerTheme.colors.textMuted, fontSize: 11, marginTop: 3 },
  deliveryHeading: { alignItems: "center", flexDirection: "row", gap: 12, marginBottom: 12 },
  deliveryIcon: { alignItems: "center", backgroundColor: customerTheme.colors.primarySoft, borderRadius: 15, height: 48, justifyContent: "center", width: 48 },
  deliveryIconText: { color: customerTheme.colors.primary, fontSize: 23, fontWeight: "900" },
  cartRow: {
    backgroundColor: customerTheme.colors.surface,
    borderColor: customerTheme.colors.border,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 13,
    padding: 14,
    ...customerTheme.shadow
  },
  cartItemTop: { alignItems: "center", flexDirection: "row" },
  cartItemVisual: { alignItems: "center", backgroundColor: customerTheme.colors.surfaceMuted, borderRadius: 15, height: 72, justifyContent: "center", marginRight: 13, width: 72 },
  cartItemEmoji: { fontSize: 34 },
  cartRowInfo: { flex: 1 },
  cartRowName: { color: customerTheme.colors.text, fontSize: 15, fontWeight: "900" },
  cartRowUnitPrice: { color: customerTheme.colors.textMuted, fontSize: 12, marginTop: 3 },
  quantityStepper: { alignItems: "center", alignSelf: "flex-end", backgroundColor: customerTheme.colors.surfaceMuted, borderRadius: 12, flexDirection: "row", gap: 13, marginTop: 12, padding: 4 },
  stepperButton: {
    alignItems: "center",
    backgroundColor: customerTheme.colors.surface,
    borderRadius: 9,
    height: 32,
    justifyContent: "center",
    width: 32
  },
  stepperButtonText: { color: customerTheme.colors.primary, fontSize: 18, fontWeight: "900" },
  stepperValue: { color: customerTheme.colors.text, fontSize: 14, fontWeight: "900", minWidth: 20, textAlign: "center" },
  cartRowLineTotal: { color: customerTheme.colors.primary, fontSize: 14, fontWeight: "900", marginTop: 8 },
  removeButton: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "#FDE8E5", borderRadius: 12, height: 32, justifyContent: "center", width: 32 },
  removeButtonText: { color: customerTheme.colors.danger, fontSize: 21, fontWeight: "500", marginTop: -2 },
  footer: {
    alignSelf: "center",
    backgroundColor: customerTheme.colors.surface,
    borderTopColor: customerTheme.colors.border,
    borderTopWidth: 1,
    maxWidth: 900,
    padding: 18,
    width: "100%"
  },
  footerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  footerLabel: { color: customerTheme.colors.text, fontSize: 16, fontWeight: "800" },
  footerValue: { color: customerTheme.colors.primary, fontSize: 18, fontWeight: "900" },
  footerNote: { color: customerTheme.colors.textMuted, fontSize: 11, lineHeight: 16, marginBottom: 12, marginTop: 5 },
  sectionTitle: { color: customerTheme.colors.text, fontSize: 17, fontWeight: "900", marginBottom: 12, marginTop: 7 },
  summaryCard: {
    backgroundColor: customerTheme.colors.surface,
    borderColor: customerTheme.colors.border,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 18,
    padding: 18,
    ...customerTheme.shadow
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  summaryRowLabel: { color: customerTheme.colors.textMuted, flex: 1, fontSize: 13, paddingRight: 8 },
  summaryRowValue: { color: customerTheme.colors.text, fontSize: 13, fontWeight: "700" },
  summaryRowLabelBold: { color: customerTheme.colors.text, fontSize: 15, fontWeight: "900" },
  summaryRowValueBold: { color: customerTheme.colors.primary, fontSize: 17, fontWeight: "900" },
  summaryDivider: { backgroundColor: customerTheme.colors.border, height: 1, marginVertical: 10 },
  label: { color: customerTheme.colors.text, fontSize: 12, fontWeight: "900", marginBottom: 7, marginTop: 12 },
  addressText: { color: customerTheme.colors.text, fontSize: 13, lineHeight: 19 },
  input: {
    backgroundColor: customerTheme.colors.surface,
    borderColor: customerTheme.colors.border,
    borderRadius: 14,
    borderWidth: 1,
    color: customerTheme.colors.text,
    fontSize: 14,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 13
  },
  multilineInput: { minHeight: 86, textAlignVertical: "top" },
  paymentOption: {
    backgroundColor: customerTheme.colors.surface,
    borderColor: customerTheme.colors.border,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 9,
    padding: 16
  },
  paymentOptionSelected: { backgroundColor: customerTheme.colors.primarySoft, borderColor: customerTheme.colors.primary },
  paymentOptionText: { color: customerTheme.colors.text, fontSize: 14, fontWeight: "700" },
  paymentOptionTextSelected: { color: customerTheme.colors.primaryDark, fontWeight: "900" },
  checkoutSteps: { alignItems: "center", flexDirection: "row", justifyContent: "center", marginTop: 2 },
  stepComplete: { alignItems: "center", backgroundColor: customerTheme.colors.success, borderRadius: 17, height: 34, justifyContent: "center", width: 34 },
  stepCompleteText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  stepActive: { alignItems: "center", backgroundColor: customerTheme.colors.primary, borderRadius: 17, height: 34, justifyContent: "center", width: 34 },
  stepActiveText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  stepMuted: { alignItems: "center", backgroundColor: "#E5E7E6", borderRadius: 17, height: 34, justifyContent: "center", width: 34 },
  stepMutedText: { color: customerTheme.colors.textMuted, fontSize: 13, fontWeight: "800" },
  stepLine: { backgroundColor: customerTheme.colors.success, height: 3, width: 70 },
  stepLineMuted: { backgroundColor: "#E5E7E6", height: 3, width: 70 },
  stepLabels: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18, marginHorizontal: 35, marginTop: 7 },
  stepLabel: { color: customerTheme.colors.textMuted, fontSize: 10, fontWeight: "800" },
  successBanner: { alignItems: "center", backgroundColor: customerTheme.colors.successSoft, borderRadius: 22, marginBottom: 18, padding: 24 },
  successIcon: { alignItems: "center", backgroundColor: customerTheme.colors.success, borderRadius: 35, height: 70, justifyContent: "center", width: 70 },
  successIconText: { color: "#FFFFFF", fontSize: 34, fontWeight: "900" },
  successTitle: { color: customerTheme.colors.text, fontSize: 22, fontWeight: "900", marginTop: 16 },
  successBannerText: { color: customerTheme.colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 8, textAlign: "center" },
  primaryButton: {
    alignItems: "center",
    backgroundColor: customerTheme.colors.primary,
    borderRadius: 15,
    marginTop: 14,
    minHeight: 54,
    justifyContent: "center",
    paddingVertical: 14,
    ...customerTheme.shadow
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  destructiveButton: { backgroundColor: customerTheme.colors.danger },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: customerTheme.colors.surface,
    borderColor: customerTheme.colors.primarySoft,
    borderRadius: 15,
    borderWidth: 1,
    marginTop: 10,
    minHeight: 52,
    justifyContent: "center",
    paddingVertical: 14
  },
  secondaryButtonText: { color: customerTheme.colors.primary, fontSize: 14, fontWeight: "900" },
  buttonPressed: { opacity: 0.7, transform: [{ scale: 0.995 }] },
  errorBox: { alignItems: "center" },
  errorText: { color: customerTheme.colors.danger, fontSize: 14, lineHeight: 20, textAlign: "center" },
  inlineErrorText: { backgroundColor: "#FDE8E5", borderRadius: 10, color: customerTheme.colors.danger, fontSize: 13, marginTop: 8, padding: 11 },
  retryButton: {
    backgroundColor: customerTheme.colors.primary,
    borderRadius: 12,
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10
  },
  retryButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" }
});
