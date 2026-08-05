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
  createOrder,
  getMyOrder,
  listMyOrders,
  orderPaymentMethods,
  type CreateOrderInput,
  type OrderDetail,
  type OrderPaymentMethod
} from "./api";
import {
  cartItemCount,
  cartSubtotalMinor,
  type Cart
} from "./cart";
import { getAccessToken } from "./session";

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
      <StatusBar backgroundColor="#F5FAFC" barStyle="dark-content" />
      <Header onBack={props.onBack} subtitle={props.cart?.restaurantName ?? "Your cart is empty"} title="Your Cart" />
      {isEmpty ? (
        <View style={styles.centered}>
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
                <View style={styles.cartRowInfo}>
                  <Text style={styles.cartRowName}>{item.name}</Text>
                  <Text style={styles.cartRowUnitPrice}>{formatPrice(item.priceMinor)} each</Text>
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
                <Text style={styles.cartRowLineTotal}>{formatPrice(item.priceMinor * item.quantity)}</Text>
                <Pressable
                  accessibilityLabel={`Remove ${item.name} from cart`}
                  onPress={() => props.onRemove(item.menuItemId)}
                  style={styles.removeButton}
                >
                  <Text style={styles.removeButtonText}>Remove</Text>
                </Pressable>
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
      <StatusBar backgroundColor="#F5FAFC" barStyle="dark-content" />
      <Header onBack={props.onBack} subtitle={props.cart?.restaurantName ?? "Checkout"} title="Checkout" />
      <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
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
      <StatusBar backgroundColor="#F5FAFC" barStyle="dark-content" />
      <Header onBack={props.onDone} subtitle={props.order.restaurant.name} title="Order Placed" />
      <ScrollView contentContainerStyle={styles.formContent}>
        <View style={styles.successBanner}>
          <Text style={styles.successBannerText}>
            Your order was placed successfully. These are the official totals confirmed by the server.
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
      <StatusBar backgroundColor="#F5FAFC" barStyle="dark-content" />
      <Header onBack={props.onBack} subtitle="Most recent first" title="My Orders" />
      {orders === null ? (
        <View style={styles.centered}>
          {error ? <ErrorState message={error} onRetry={load} /> : <ActivityIndicator color="#0F766E" size="large" />}
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>You have not placed any orders yet.</Text>
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

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor="#F5FAFC" barStyle="dark-content" />
      <Header onBack={props.onBack} subtitle={order?.restaurant.name ?? "Order"} title="Order Details" />
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
          <OrderSummaryCard order={order} />
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
  const isPlaced = props.status === "PLACED";
  return (
    <View style={[styles.statusBadge, isPlaced ? styles.statusBadgePlaced : styles.statusBadgeCancelled]}>
      <Text style={[styles.statusBadgeText, isPlaced ? styles.statusBadgeTextPlaced : styles.statusBadgeTextCancelled]}>
        {props.status}
      </Text>
    </View>
  );
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

function PrimaryButton(props: { label: string; loading?: boolean; onPress: () => void }) {
  return (
    <Pressable
      disabled={props.loading}
      onPress={props.onPress}
      style={({ pressed }) => [styles.primaryButton, (pressed || props.loading) && styles.buttonPressed]}
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
  cardTitle: { color: "#0F172A", fontSize: 17, fontWeight: "800" },
  cardSubtitle: { color: "#64748B", fontSize: 13, marginTop: 4 },
  orderRowHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  orderRowTotal: { color: "#0F766E", fontSize: 16, fontWeight: "800", marginTop: 8 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusBadgePlaced: { backgroundColor: "#DCFCE7" },
  statusBadgeCancelled: { backgroundColor: "#FEE2E2" },
  statusBadgeText: { fontSize: 11, fontWeight: "800" },
  statusBadgeTextPlaced: { color: "#166534" },
  statusBadgeTextCancelled: { color: "#B91C1C" },
  cartRow: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    padding: 14
  },
  cartRowInfo: { marginBottom: 8 },
  cartRowName: { color: "#0F172A", fontSize: 15, fontWeight: "700" },
  cartRowUnitPrice: { color: "#64748B", fontSize: 13, marginTop: 2 },
  quantityStepper: { alignItems: "center", flexDirection: "row", gap: 12, marginBottom: 8 },
  stepperButton: {
    alignItems: "center",
    backgroundColor: "#F0FDFA",
    borderColor: "#0F766E",
    borderRadius: 8,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    width: 32
  },
  stepperButtonText: { color: "#0F766E", fontSize: 18, fontWeight: "800" },
  stepperValue: { color: "#0F172A", fontSize: 15, fontWeight: "700", minWidth: 24, textAlign: "center" },
  cartRowLineTotal: { color: "#0F766E", fontSize: 15, fontWeight: "800", marginBottom: 8 },
  removeButton: { alignSelf: "flex-start" },
  removeButtonText: { color: "#B91C1C", fontSize: 13, fontWeight: "700" },
  footer: {
    backgroundColor: "#FFFFFF",
    borderTopColor: "#D9E2EC",
    borderTopWidth: 1,
    padding: 16
  },
  footerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  footerLabel: { color: "#0F172A", fontSize: 16, fontWeight: "700" },
  footerValue: { color: "#0F766E", fontSize: 16, fontWeight: "800" },
  footerNote: { color: "#64748B", fontSize: 12, marginBottom: 12, marginTop: 4 },
  sectionTitle: { color: "#0F172A", fontSize: 16, fontWeight: "800", marginBottom: 10, marginTop: 6 },
  summaryCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D9E2EC",
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 20,
    padding: 16
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  summaryRowLabel: { color: "#475569", flex: 1, fontSize: 14, paddingRight: 8 },
  summaryRowValue: { color: "#0F172A", fontSize: 14, fontWeight: "600" },
  summaryRowLabelBold: { color: "#0F172A", fontSize: 15, fontWeight: "800" },
  summaryRowValueBold: { color: "#0F766E", fontSize: 15, fontWeight: "800" },
  summaryDivider: { backgroundColor: "#E2E8F0", height: 1, marginVertical: 8 },
  label: { color: "#334155", fontSize: 13, fontWeight: "700", marginBottom: 6, marginTop: 10 },
  addressText: { color: "#0F172A", fontSize: 14 },
  input: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D9E2EC",
    borderRadius: 10,
    borderWidth: 1,
    color: "#0F172A",
    fontSize: 15,
    marginBottom: 6,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  multilineInput: { minHeight: 70, textAlignVertical: "top" },
  paymentOption: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D9E2EC",
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
    padding: 14
  },
  paymentOptionSelected: { backgroundColor: "#F0FDFA", borderColor: "#0F766E" },
  paymentOptionText: { color: "#0F172A", fontSize: 15, fontWeight: "600" },
  paymentOptionTextSelected: { color: "#0F766E", fontWeight: "800" },
  successBanner: { backgroundColor: "#DCFCE7", borderRadius: 12, marginBottom: 16, padding: 14 },
  successBannerText: { color: "#166534", fontSize: 14, lineHeight: 20 },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#0F766E",
    borderRadius: 12,
    marginTop: 14,
    paddingVertical: 14
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#0F766E",
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
    paddingVertical: 14
  },
  secondaryButtonText: { color: "#0F766E", fontSize: 15, fontWeight: "800" },
  buttonPressed: { opacity: 0.85 },
  errorBox: { alignItems: "center" },
  errorText: { color: "#B91C1C", fontSize: 14, lineHeight: 20, textAlign: "center" },
  inlineErrorText: { color: "#B91C1C", fontSize: 13, marginTop: 8 },
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
