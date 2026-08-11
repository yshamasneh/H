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
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ApiError,
  cancelMyOrder,
  createOrder,
  decideOrderFulfillment,
  getOrderQuote,
  getMyOrder,
  listMyAddresses,
  listMyOrders,
  orderPaymentMethods,
  type CreateOrderInput,
  type OrderDetail,
  type OrderQuote,
  type OrderPaymentMethod,
  type SavedAddress
} from "../../core/api";
import {
  cartItemCount,
  cartSubtotalMinor,
  type Cart
} from "./cart";
import { getAccessToken } from "../../core/session";
import { getCurrentCoordinates, reverseGeocode, type CurrentCoordinates } from "../../core/location";
import { useOrderRealtime } from "../../core/socket";
import { customerTheme } from "./theme";
import i18n from "../../i18n";
import { LocationMap } from "../../components/location-map";
import type { MapCoordinate } from "../../components/location-map.types";

const currencyCode = "ILS";
const defaultMapCoordinate: MapCoordinate = { latitude: 31.9038, longitude: 35.2034 };

type CartScreenProps = {
  cart: Cart | null;
  onBack: () => void;
  onIncrement: (menuItemId: string) => void;
  onDecrement: (menuItemId: string) => void;
  onRemove: (menuItemId: string) => void;
  onToggleSubstitution: (menuItemId: string, allowSubstitution: boolean) => void;
  onCheckout: () => void;
};

export function CartScreen(props: CartScreenProps) {
  const { t } = useTranslation(["cart"]);
  const isEmpty = !props.cart || props.cart.items.length === 0;
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.background} barStyle="dark-content" />
      <Header onBack={props.onBack} subtitle={props.cart?.restaurantName ?? t("cart.emptySubtitle")} title={t("cart.title")} />
      {isEmpty ? (
        <View style={styles.centered}>
          <View style={styles.emptyIcon}><Text style={styles.emptyIconText}>🛒</Text></View>
          <Text style={styles.emptyTitle}>{t("cart.emptyTitle")}</Text>
          <Text style={styles.emptyText}>{t("cart.emptyText")}</Text>
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
                    <Text style={styles.cartRowUnitPrice}>{t("cart.unitPriceLabel", { price: formatPrice(item.priceMinor), unit: item.unitLabel })}</Text>
                    <Text style={styles.cartRowLineTotal}>{formatPrice(item.priceMinor * item.quantity)}</Text>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: item.allowSubstitution }}
                      onPress={() => props.onToggleSubstitution(item.menuItemId, !item.allowSubstitution)}
                    >
                      <Text style={styles.substitutionText}>
                        {item.allowSubstitution ? t("cart.substitutionAllowed") : t("cart.substitutionNotAllowed")}
                      </Text>
                    </Pressable>
                  </View>
                  <Pressable
                    accessibilityLabel={t("cart.removeItemAccessibility", { name: item.name })}
                    onPress={() => props.onRemove(item.menuItemId)}
                    style={styles.removeButton}
                  >
                    <Text style={styles.removeButtonText}>×</Text>
                  </Pressable>
                </View>
                <View style={styles.quantityStepper}>
                  <Pressable
                    accessibilityLabel={t("cart.decreaseQuantityAccessibility", { name: item.name })}
                    onPress={() => props.onDecrement(item.menuItemId)}
                    style={styles.stepperButton}
                  >
                    <Text style={styles.stepperButtonText}>-</Text>
                  </Pressable>
                  <Text style={styles.stepperValue}>{item.quantity}</Text>
                  <Pressable
                    accessibilityLabel={t("cart.increaseQuantityAccessibility", { name: item.name })}
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
              <Text style={styles.footerLabel}>{t("cart.estimatedSubtotal")}</Text>
              <Text style={styles.footerValue}>{formatPrice(cartSubtotalMinor(props.cart!))}</Text>
            </View>
            <Text style={styles.footerNote}>{t("cart.feesNote")}</Text>
            <PrimaryButton label={t("cart.proceedToCheckout")} onPress={props.onCheckout} />
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
  const { t } = useTranslation(["cart", "common"]);
  const [deliveryLabel, setDeliveryLabel] = useState(() => t("checkout.labelPlaceholder"));
  const [deliveryAddressLine, setDeliveryAddressLine] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<OrderPaymentMethod>("CASH");
  const [customerNote, setCustomerNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [coordinates, setCoordinates] = useState<CurrentCoordinates>(defaultMapCoordinate);
  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);

  useEffect(() => {
    getAccessToken()
      .then((accessToken) => accessToken ? listMyAddresses(accessToken) : [])
      .then((items) => {
        setSavedAddresses(items);
        const preferred = items.find((item) => item.isDefault);
        if (preferred) selectSavedAddress(preferred);
      })
      .catch(() => setSavedAddresses([]));
  }, []);

  function selectSavedAddress(address: SavedAddress) {
    setDeliveryLabel(address.label);
    setDeliveryAddressLine(address.addressLine);
    setCoordinates({ latitude: address.latitude, longitude: address.longitude });
    setQuote(null);
  }

  async function chooseCurrentLocation() {
    setLocating(true);
    setError(null);
    try {
      const nextCoordinates = await getCurrentCoordinates();
      setCoordinates(nextCoordinates);
      const address = await reverseGeocode(nextCoordinates);
      if (address) setDeliveryAddressLine(address);
      if (!props.cart) throw new Error(t("checkout.emptyCartError"));
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error(t("common:sessionExpired"));
      setQuote(await getOrderQuote(accessToken, {
        restaurantId: props.cart.restaurantId,
        items: props.cart.items.map((line) => ({
          menuItemId: line.menuItemId,
          quantity: line.quantity,
          allowSubstitution: line.allowSubstitution
        })),
        deliveryLabel: deliveryLabel.trim() || t("checkout.labelPlaceholder"),
        deliveryAddressLine: deliveryAddressLine.trim().length >= 3 ? deliveryAddressLine.trim() : t("checkout.selectedDeliveryLocationFallback"),
        deliveryLatitude: nextCoordinates.latitude,
        deliveryLongitude: nextCoordinates.longitude,
        paymentMethod
      }));
    } catch (requestError) {
      setQuote(null);
      setError(readError(requestError));
    } finally {
      setLocating(false);
    }
  }

  async function chooseMapLocation(nextCoordinates: MapCoordinate) {
    setCoordinates(nextCoordinates);
    setQuote(null);
    try {
      const address = await reverseGeocode(nextCoordinates);
      if (address) setDeliveryAddressLine(address);
    } catch {
      // The coordinates remain valid if the platform geocoder is temporarily unavailable.
    }
  }

  async function calculateQuote() {
    if (!props.cart) {
      setError(t("checkout.emptyCartError"));
      return;
    }
    if (deliveryAddressLine.trim().length < 3) {
      setError(t("checkout.addressRequiredError"));
      return;
    }
    setLocating(true);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error(t("common:sessionExpired"));
      setQuote(await getOrderQuote(accessToken, {
        restaurantId: props.cart.restaurantId,
        items: props.cart.items.map((line) => ({
          menuItemId: line.menuItemId,
          quantity: line.quantity,
          allowSubstitution: line.allowSubstitution
        })),
        deliveryLabel: deliveryLabel.trim() || t("checkout.labelPlaceholder"),
        deliveryAddressLine: deliveryAddressLine.trim(),
        deliveryLatitude: coordinates.latitude,
        deliveryLongitude: coordinates.longitude,
        paymentMethod
      }));
    } catch (requestError) {
      setQuote(null);
      setError(readError(requestError));
    } finally {
      setLocating(false);
    }
  }

  async function submit() {
    setError(null);
    if (!props.cart || props.cart.items.length === 0) {
      setError(t("checkout.emptyCartError"));
      return;
    }
    if (deliveryLabel.trim().length < 1) {
      setError(t("checkout.labelRequiredError"));
      return;
    }
    if (deliveryAddressLine.trim().length < 3) {
      setError(t("checkout.addressRequiredError"));
      return;
    }
    if (!quote) {
      setError(t("checkout.quoteRequiredError"));
      return;
    }
    setLoading(true);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError(t("common:sessionExpired"));
        return;
      }
      const input: CreateOrderInput = {
        restaurantId: props.cart.restaurantId,
        items: props.cart.items.map((line) => ({
          menuItemId: line.menuItemId,
          quantity: line.quantity,
          allowSubstitution: line.allowSubstitution
        })),
        deliveryLabel: deliveryLabel.trim(),
        deliveryAddressLine: deliveryAddressLine.trim(),
        deliveryLatitude: coordinates.latitude,
        deliveryLongitude: coordinates.longitude,
        paymentMethod,
        customerNote: customerNote.trim() || undefined
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
      <Header onBack={props.onBack} subtitle={props.cart?.restaurantName ?? t("checkout.title")} title={t("checkout.title")} />
      <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
        <View style={styles.checkoutSteps}>
          <View style={styles.stepComplete}><Text style={styles.stepCompleteText}>✓</Text></View>
          <View style={styles.stepLine} />
          <View style={styles.stepActive}><Text style={styles.stepActiveText}>2</Text></View>
          <View style={styles.stepLineMuted} />
          <View style={styles.stepMuted}><Text style={styles.stepMutedText}>3</Text></View>
        </View>
        <View style={styles.stepLabels}>
          <Text style={styles.stepLabel}>{t("checkout.stepBasket")}</Text>
          <Text style={styles.stepLabel}>{t("checkout.stepDetails")}</Text>
          <Text style={styles.stepLabel}>{t("checkout.stepDone")}</Text>
        </View>
        {props.cart ? (
          <View style={styles.summaryCard}>
            <Text style={styles.sectionTitle}>{t("checkout.orderSummaryEstimate")}</Text>
            {props.cart.items.map((item) => (
              <View key={item.menuItemId} style={styles.summaryRow}>
                <Text style={styles.summaryRowLabel}>
                  {t("checkout.quantityTimesName", { quantity: item.quantity, name: item.name })}
                </Text>
                <Text style={styles.summaryRowValue}>{formatPrice(item.priceMinor * item.quantity)}</Text>
              </View>
            ))}
            <View style={styles.summaryDivider} />
            <View style={styles.summaryRow}>
              <Text style={styles.summaryRowLabelBold}>{t("cart.estimatedSubtotal")}</Text>
              <Text style={styles.summaryRowValueBold}>{formatPrice(cartSubtotalMinor(props.cart))}</Text>
            </View>
            <Text style={styles.footerNote}>{t("checkout.finalTotalNote")}</Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>{t("checkout.deliveryAddressTitle")}</Text>
        {savedAddresses.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.savedAddressList}>
            {savedAddresses.map((address) => (
              <Pressable key={address.id} onPress={() => selectSavedAddress(address)} style={styles.savedAddressChip}>
                <Text style={styles.savedAddressChipText}>{address.label}{address.isDefault ? " ★" : ""}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <Text style={styles.label}>{t("checkout.labelField")}</Text>
        <TextInput
          onChangeText={setDeliveryLabel}
          placeholder={t("checkout.labelPlaceholder")}
          placeholderTextColor="#94A3B8"
          style={styles.input}
          value={deliveryLabel}
        />
        <Text style={styles.label}>{t("checkout.fullAddressField")}</Text>
        <TextInput
          multiline
          onChangeText={setDeliveryAddressLine}
          placeholder={t("checkout.addressPlaceholder")}
          placeholderTextColor="#94A3B8"
          style={[styles.input, styles.multilineInput]}
          value={deliveryAddressLine}
        />
        <Text style={styles.locationNote}>{t("checkout.locationNoteMove")}</Text>
        <LocationMap coordinate={coordinates} onCoordinateChange={(value) => void chooseMapLocation(value)} />
        <SecondaryButton
          label={locating ? t("checkout.findingLocation") : t("checkout.useCurrentLocation")}
          onPress={() => void chooseCurrentLocation()}
        />
        <SecondaryButton label={locating ? t("checkout.calculating") : t("checkout.calculateDeliveryPrice")} onPress={() => void calculateQuote()} />
        <Text style={styles.locationNote}>
          {t("checkout.pinSelectedNote", { lat: coordinates.latitude.toFixed(5), lng: coordinates.longitude.toFixed(5) })}
        </Text>
        {quote ? (
          <View style={styles.summaryCard}>
            <Text style={styles.sectionTitle}>{t("checkout.confirmedPriceTitle")}</Text>
            <View style={styles.summaryRow}><Text style={styles.summaryRowLabel}>{t("checkout.itemsLabel")}</Text><Text style={styles.summaryRowValue}>{formatPrice(quote.subtotalMinor)}</Text></View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryRowLabel}>{t("checkout.deliveryWithDistance", { km: (quote.deliveryDistanceMeters / 1000).toFixed(1) })}</Text>
              <Text style={styles.summaryRowValue}>{formatPrice(quote.deliveryFeeMinor)}</Text>
            </View>
            {quote.appliedPromotions.map((promotion) => (
              <View key={promotion.offerId} style={styles.summaryRow}>
                <Text style={styles.summaryRowLabel}>{promotion.title}</Text>
                <Text style={styles.promotionText}>-{formatPrice(promotion.discountMinor)}</Text>
              </View>
            ))}
            <View style={styles.summaryDivider} />
            <View style={styles.summaryRow}><Text style={styles.summaryRowLabelBold}>{t("checkout.cashDueOnDelivery")}</Text><Text style={styles.summaryRowValueBold}>{formatPrice(quote.totalMinor)}</Text></View>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>{t("checkout.paymentMethodTitle")}</Text>
        {orderPaymentMethods.map((method) => (
          <Pressable
            accessibilityRole="button"
            key={method}
            onPress={() => setPaymentMethod(method)}
            style={[styles.paymentOption, paymentMethod === method && styles.paymentOptionSelected]}
          >
            <Text style={[styles.paymentOptionText, paymentMethod === method && styles.paymentOptionTextSelected]}>
              {paymentMethodLabel(method, t)}
            </Text>
          </Pressable>
        ))}

        <Text style={styles.sectionTitle}>{t("checkout.orderNotesTitle")}</Text>
        <TextInput
          maxLength={500}
          multiline
          onChangeText={setCustomerNote}
          placeholder={t("checkout.notesPlaceholder")}
          placeholderTextColor="#94A3B8"
          style={[styles.input, styles.multilineInput]}
          value={customerNote}
        />

        <ErrorText message={error} />
        <PrimaryButton label={t("checkout.placeOrder")} loading={loading} onPress={submit} />
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
  const { t } = useTranslation(["cart"]);
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.background} barStyle="dark-content" />
      <Header onBack={props.onDone} subtitle={props.order.restaurant.name} title={t("confirmation.title")} />
      <ScrollView contentContainerStyle={styles.formContent}>
        <View style={styles.successBanner}>
          <View style={styles.successIcon}><Text style={styles.successIconText}>✓</Text></View>
          <Text style={styles.successTitle}>{t("confirmation.confirmedTitle")}</Text>
          <Text style={styles.successBannerText}>{t("confirmation.confirmedText")}</Text>
        </View>
        <OrderSummaryCard order={props.order} />
        <PrimaryButton label={t("confirmation.viewMyOrders")} onPress={props.onViewOrders} />
        <SecondaryButton label={t("confirmation.backToHome")} onPress={props.onDone} />
      </ScrollView>
    </SafeAreaView>
  );
}

type OrderHistoryScreenProps = {
  onBack: () => void;
  onOpenOrder: (orderId: string) => void;
};

export function OrderHistoryScreen(props: OrderHistoryScreenProps) {
  const { t } = useTranslation(["cart", "common"]);
  const [orders, setOrders] = useState<OrderDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError(t("common:sessionExpired"));
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
      <Header onBack={props.onBack} subtitle={t("history.subtitle")} title={t("history.title")} />
      {orders === null ? (
        <View style={styles.centered}>
          {error ? <ErrorState message={error} onRetry={load} /> : <ActivityIndicator color={customerTheme.colors.primary} size="large" />}
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.centered}>
          <View style={styles.emptyIcon}><Text style={styles.emptyIconText}>🧾</Text></View>
          <Text style={styles.emptyTitle}>{t("history.emptyTitle")}</Text>
          <Text style={styles.emptyText}>{t("history.emptyText")}</Text>
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
  const { t } = useTranslation(["cart", "common"]);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [decidingAdjustmentId, setDecidingAdjustmentId] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError(t("common:sessionExpired"));
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

  useOrderRealtime(props.orderId, () => void load());

  async function cancelOrder() {
    setCancelling(true);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError(t("common:sessionExpired"));
        return;
      }
      setOrder(await cancelMyOrder(accessToken, props.orderId));
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setCancelling(false);
    }
  }

  async function decideFulfillment(adjustmentId: string, decision: "approve" | "reject") {
    setDecidingAdjustmentId(adjustmentId);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError(t("common:sessionExpired"));
        return;
      }
      setOrder(await decideOrderFulfillment(accessToken, props.orderId, adjustmentId, decision));
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setDecidingAdjustmentId(null);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.background} barStyle="dark-content" />
      <Header onBack={props.onBack} subtitle={order?.restaurant.name ?? t("detail.defaultSubtitle")} title={t("detail.title")} />
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
          {order.items.filter((item) => item.fulfillmentAdjustment?.status === "PENDING").map((item) => (
            <FulfillmentReviewCard
              busy={decidingAdjustmentId === item.fulfillmentAdjustment!.id}
              item={item}
              key={item.id}
              onDecision={(decision) => decideFulfillment(item.fulfillmentAdjustment!.id, decision)}
            />
          ))}
          {order.delivery ? <DeliveryProgressCard delivery={order.delivery} /> : null}
          <StatusTimeline history={order.statusHistory} />
          {order.status === "PLACED" ? (
            <PrimaryButton destructive label={t("detail.cancelOrder")} loading={cancelling} onPress={cancelOrder} />
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function FulfillmentReviewCard(props: {
  item: OrderDetail["items"][number];
  busy: boolean;
  onDecision: (decision: "approve" | "reject") => Promise<void>;
}) {
  const { t } = useTranslation(["cart", "common"]);
  const adjustment = props.item.fulfillmentAdjustment!;
  const proposedName = adjustment.replacementNameSnapshot ?? props.item.nameSnapshot;
  return (
    <View style={styles.fulfillmentReviewCard}>
      <Text style={styles.fulfillmentReviewEyebrow}>{t("detail.yourDecisionNeeded")}</Text>
      <Text style={styles.fulfillmentReviewTitle}>{props.item.nameSnapshot}</Text>
      {adjustment.replacementNameSnapshot ? (
        <Text style={styles.fulfillmentReviewText}>{t("detail.replacementLabel", { name: adjustment.replacementNameSnapshot })}</Text>
      ) : (
        <Text style={styles.fulfillmentReviewText}>{t("detail.quantityDiffers")}</Text>
      )}
      <Text style={styles.fulfillmentReviewText}>
        {t("detail.proposedItemLine", {
          name: proposedName,
          quantity: (adjustment.actualQuantityMilli / 1_000).toFixed(3),
          unit: adjustment.replacementUnitLabelSnapshot ?? props.item.unitLabelSnapshot
        })}
      </Text>
      <Text style={styles.fulfillmentReviewPrice}>{t("detail.newLineTotal", { amount: formatPrice(adjustment.lineTotalMinor) })}</Text>
      {adjustment.note ? <Text style={styles.fulfillmentReviewNote}>{t("detail.storeNote", { note: adjustment.note })}</Text> : null}
      <View style={styles.fulfillmentReviewActions}>
        <Pressable
          disabled={props.busy}
          onPress={() => void props.onDecision("approve")}
          style={[styles.fulfillmentApproveButton, props.busy && styles.fulfillmentButtonDisabled]}
        >
          <Text style={styles.fulfillmentApproveText}>{t("common:approve")}</Text>
        </Pressable>
        <Pressable
          disabled={props.busy}
          onPress={() => void props.onDecision("reject")}
          style={[styles.fulfillmentRejectButton, props.busy && styles.fulfillmentButtonDisabled]}
        >
          <Text style={styles.fulfillmentRejectText}>{t("common:reject")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function OrderSummaryCard(props: { order: OrderDetail }) {
  const { t } = useTranslation(["cart"]);
  const { order } = props;
  return (
    <View style={styles.summaryCard}>
      <View style={styles.orderRowHeader}>
        <Text style={styles.sectionTitle}>{formatDate(order.createdAt)}</Text>
        <StatusBadge status={order.status} />
      </View>
      {order.items.map((item) => {
        const approved = item.fulfillmentAdjustment?.status === "APPROVED" ? item.fulfillmentAdjustment : null;
        return (
          <View key={item.id} style={styles.summaryRow}>
            <Text style={styles.summaryRowLabel}>
              {approved
                ? t("checkout.quantityTimesName", {
                    quantity: formatPackedQuantity(approved.actualQuantityMilli),
                    name: `${approved.replacementNameSnapshot ?? item.nameSnapshot} / ${approved.replacementUnitLabelSnapshot ?? item.unitLabelSnapshot}`
                  }) + t("detail.approvedChangeSuffix")
                : t("checkout.quantityTimesName", { quantity: item.quantity, name: item.nameSnapshot })}
            </Text>
            <Text style={styles.summaryRowValue}>{formatPrice(item.lineTotalMinor)}</Text>
          </View>
        );
      })}
      <View style={styles.summaryDivider} />
      <View style={styles.summaryRow}>
        <Text style={styles.summaryRowLabel}>{t("detail.subtotalLabel")}</Text>
        <Text style={styles.summaryRowValue}>{formatPrice(order.subtotalMinor)}</Text>
      </View>
      <View style={styles.summaryRow}>
        <Text style={styles.summaryRowLabel}>{t("detail.deliveryFeeLabel")}</Text>
        <Text style={styles.summaryRowValue}>{formatPrice(order.deliveryFeeMinor)}</Text>
      </View>
      <View style={styles.summaryRow}>
      </View>
      {order.discountMinor > 0 ? (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryRowLabel}>{t("detail.discountLabel")}</Text>
          <Text style={styles.summaryRowValue}>-{formatPrice(order.discountMinor)}</Text>
        </View>
      ) : null}
      {order.appliedPromotions.map((promotion) => (
        <Text key={promotion.offerId} style={styles.promotionText}>
          {promotion.title}: -{formatPrice(promotion.discountMinor)}
        </Text>
      ))}
      <View style={styles.summaryDivider} />
      <View style={styles.summaryRow}>
        <Text style={styles.summaryRowLabelBold}>{t("detail.totalLabel")}</Text>
        <Text style={styles.summaryRowValueBold}>{formatPrice(order.totalMinor)}</Text>
      </View>
      <View style={styles.summaryDivider} />
      <Text style={styles.label}>{t("detail.deliveryAddressLabel")}</Text>
      <Text style={styles.addressText}>
        {t("detail.addressLine", { label: order.deliveryLabel, address: order.deliveryAddressLine })}
      </Text>
      <Text style={styles.label}>{t("detail.paymentMethodLabel")}</Text>
      <Text style={styles.addressText}>{paymentMethodLabel(order.paymentMethod, t)}</Text>
      {order.customerNote ? (
        <>
          <Text style={styles.label}>{t("detail.orderNotesLabel")}</Text>
          <Text style={styles.addressText}>{order.customerNote}</Text>
        </>
      ) : null}
      {order.deliveryDistanceMeters !== null ? (
        <Text style={styles.footerNote}>{t("detail.routeDistance", { km: (order.deliveryDistanceMeters / 1000).toFixed(1) })}</Text>
      ) : null}
    </View>
  );
}

function StatusBadge(props: { status: OrderDetail["status"] }) {
  const { t } = useTranslation(["common"]);
  const palette = statusPalette(props.status);
  return (
    <View style={[styles.statusBadge, { backgroundColor: palette.background }]}>
      <Text style={[styles.statusBadgeText, { color: palette.text }]}>{t(`status.${props.status}`, props.status.replace(/_/g, " "))}</Text>
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
  const { t } = useTranslation(["cart", "common"]);
  if (props.history.length === 0) return null;
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.sectionTitle}>{t("detail.statusHistoryTitle")}</Text>
      {props.history.map((entry, index) => (
        <View key={entry.id} style={styles.timelineRow}>
          <View style={styles.timelineMarker}>
            <View style={styles.timelineDot} />
            {index < props.history.length - 1 ? <View style={styles.timelineLine} /> : null}
          </View>
          <View style={styles.timelineCopy}>
            <Text style={styles.timelineStatus}>{t(`common:status.${entry.toStatus}`, entry.toStatus.replace(/_/g, " "))}</Text>
            <Text style={styles.timelineDate}>{formatDate(entry.createdAt)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function DeliveryProgressCard(props: { delivery: NonNullable<OrderDetail["delivery"]> }) {
  const { t } = useTranslation(["cart", "common"]);
  const { delivery } = props;
  return (
    <View style={styles.summaryCard}>
      <View style={styles.deliveryHeading}>
        <View style={styles.deliveryIcon}><Text style={styles.deliveryIconText}>⌖</Text></View>
        <View><Text style={styles.sectionTitle}>{t("detail.deliveryProgress")}</Text><Text style={styles.footerNote}>{t("detail.liveUpdates")}</Text></View>
      </View>
      <Text style={styles.addressText}>{t(`common:status.${delivery.status}`, delivery.status.replace(/_/g, " "))}</Text>
      {delivery.pickedUpAt ? (
        <Text style={styles.footerNote}>{t("detail.pickedUpAt", { date: formatDate(delivery.pickedUpAt) })}</Text>
      ) : null}
      {delivery.onTheWayAt ? (
        <Text style={styles.footerNote}>{t("detail.onTheWayAt", { date: formatDate(delivery.onTheWayAt) })}</Text>
      ) : null}
      {delivery.deliveredAt ? (
        <Text style={styles.footerNote}>{t("detail.deliveredAt", { date: formatDate(delivery.deliveredAt) })}</Text>
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
  const { t } = useTranslation(["cart"]);
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

export function paymentMethodLabel(method: OrderPaymentMethod, t: (key: string) => string = i18n.t.bind(i18n)): string {
  switch (method) {
    case "CASH":
      return t("cart:checkout.cashOnDelivery");
  }
}

export function cartSummaryLabel(cart: Cart): string {
  const count = cartItemCount(cart);
  return i18n.t("cart:cartSummaryLabel", { count, price: formatPrice(cartSubtotalMinor(cart)) });
}

function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ${currencyCode}`;
}

function formatPackedQuantity(quantityMilli: number): string {
  return (quantityMilli / 1_000).toFixed(3).replace(/\.?0+$/, "");
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
  return i18n.t("common:requestFailed");
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
  timelineMarker: { alignItems: "center", marginEnd: 12, width: 16 },
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
  cartItemVisual: { alignItems: "center", backgroundColor: customerTheme.colors.surfaceMuted, borderRadius: 15, height: 72, justifyContent: "center", marginEnd: 13, width: 72 },
  cartItemEmoji: { fontSize: 34 },
  cartRowInfo: { flex: 1 },
  cartRowName: { color: customerTheme.colors.text, fontSize: 15, fontWeight: "900" },
  cartRowUnitPrice: { color: customerTheme.colors.textMuted, fontSize: 12, marginTop: 3 },
  substitutionText: { color: customerTheme.colors.secondary, fontSize: 12, fontWeight: "700", marginTop: 8 },
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
  summaryRowLabel: { color: customerTheme.colors.textMuted, flex: 1, fontSize: 13, paddingEnd: 8 },
  summaryRowValue: { color: customerTheme.colors.text, fontSize: 13, fontWeight: "700" },
  summaryRowLabelBold: { color: customerTheme.colors.text, fontSize: 15, fontWeight: "900" },
  summaryRowValueBold: { color: customerTheme.colors.primary, fontSize: 17, fontWeight: "900" },
  summaryDivider: { backgroundColor: customerTheme.colors.border, height: 1, marginVertical: 10 },
  label: { color: customerTheme.colors.text, fontSize: 12, fontWeight: "900", marginBottom: 7, marginTop: 12 },
  addressText: { color: customerTheme.colors.text, fontSize: 13, lineHeight: 19 },
  locationNote: { color: customerTheme.colors.textMuted, fontSize: 11, lineHeight: 17, marginBottom: 8, marginTop: 8 },
  promotionText: { color: customerTheme.colors.success, fontSize: 12, fontWeight: "800", marginBottom: 5 },
  fulfillmentReviewCard: { backgroundColor: "#FFFBEB", borderColor: "#F59E0B", borderRadius: 20, borderWidth: 1, marginBottom: 18, padding: 18 },
  fulfillmentReviewEyebrow: { color: "#B45309", fontSize: 10, fontWeight: "900", letterSpacing: 0.8, marginBottom: 7 },
  fulfillmentReviewTitle: { color: customerTheme.colors.text, fontSize: 17, fontWeight: "900", marginBottom: 8 },
  fulfillmentReviewText: { color: "#78350F", fontSize: 13, lineHeight: 19 },
  fulfillmentReviewPrice: { color: "#92400E", fontSize: 14, fontWeight: "900", marginTop: 8 },
  fulfillmentReviewNote: { color: "#78350F", fontSize: 12, fontStyle: "italic", marginTop: 7 },
  fulfillmentReviewActions: { flexDirection: "row", gap: 9, marginTop: 14 },
  fulfillmentApproveButton: { alignItems: "center", backgroundColor: customerTheme.colors.primary, borderRadius: 12, flex: 1, paddingVertical: 12 },
  fulfillmentApproveText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  fulfillmentRejectButton: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: customerTheme.colors.danger, borderRadius: 12, borderWidth: 1, flex: 1, paddingVertical: 12 },
  fulfillmentRejectText: { color: customerTheme.colors.danger, fontSize: 13, fontWeight: "900" },
  fulfillmentButtonDisabled: { opacity: 0.45 },
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
  savedAddressList: { marginBottom: 10 },
  savedAddressChip: { backgroundColor: customerTheme.colors.primarySoft, borderRadius: 999, marginEnd: 8, paddingHorizontal: 14, paddingVertical: 10 },
  savedAddressChipText: { color: customerTheme.colors.primaryDark, fontSize: 12, fontWeight: "900" },
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
