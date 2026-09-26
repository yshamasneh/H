import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useOrderRealtime, useRealtimeEvent } from "../../core/socket";
import {
  getRestaurantOrder,
  listRestaurantMenuItems,
  listRestaurantOrders,
  proposeOrderItemFulfillment,
  setOrderItemPicked,
  updateOrderStatus,
  type MenuItemOwner,
  type OrderDetail,
  type OrderItemView,
  type OrderStatusValue,
  type RestaurantOrderStatusAction
} from "../../core/api";
import { readError } from "../../core/errors";
import i18n from "../../i18n";
import { RemoteImage } from "../../components/remote-image";
import { Icon } from "../../theme/icon";
import { getAccessToken } from "../../core/session";
import { colors, radius, spacing, statusFamily, statusPalette as tokenStatusPalette } from "../../theme/tokens";
import { text } from "../../theme/typography";
import { nextRestaurantActionsByStatus } from "./order.rules";
import {
  isPackingStatus,
  nextPickedValue,
  packLineState,
  packProgress,
  type PackLine,
  type PackLineState
} from "./pack-checklist";

const currencyCode = "ILS";

type RestaurantOrdersScreenProps = {
  onBack: () => void;
  onOpenOrder: (orderId: string) => void;
};

export function RestaurantOrdersScreen(props: RestaurantOrdersScreenProps) {
  const { t } = useTranslation(["restaurantOps", "common"]);
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
      <StatusBar backgroundColor={colors.surfaceSunk} barStyle="dark-content" />
      <Header onBack={props.onBack} subtitle={t("orders.mostRecentFirst")} title={t("orders.incomingOrdersTitle")} />
      {orders === null ? (
        <View style={styles.centered}>
          {error ? <ErrorState message={error} onRetry={load} /> : <ActivityIndicator color={colors.primary} size="large" />}
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>{t("orders.noOrdersYet")}</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={orders}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl onRefresh={refresh} refreshing={refreshing} tintColor={colors.primary} />}
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
                {t("orders.itemCountLabel", { count: item.items.reduce((sum, line) => sum + line.quantity, 0) })}
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
  const { t } = useTranslation(["restaurantOps", "common"]);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItemOwner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<RestaurantOrderStatusAction | null>(null);
  const [proposingFor, setProposingFor] = useState<string | null>(null);

  // Every line's ticked state lives on the server, so it is the same on every device. A tap is
  // applied here at once (the checklist has to feel instant) and sent as an absolute value, so two
  // devices tapping together converge; if the server refuses, the tap is undone and the error shown.
  function toggleLine(lineId: string) {
    if (!order) return;
    const line = order.items.find((item) => item.id === lineId);
    const next = line ? nextPickedValue(asPackLine(line)) : null;
    if (line === undefined || next === null) return;
    const previous = asPackLine(line).isPicked;
    setActionError(null);
    setOrder((current) => (current ? { ...current, items: current.items.map((item) => (item.id === lineId ? { ...item, isPicked: next } : item)) } : current));
    void (async () => {
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) throw new Error(t("common:sessionExpired"));
        await setOrderItemPicked(accessToken, props.orderId, lineId, next);
      } catch (requestError) {
        setOrder((current) => (current ? { ...current, items: current.items.map((item) => (item.id === lineId ? { ...item, isPicked: previous } : item)) } : current));
        setActionError(readError(requestError));
      }
    })();
  }

  // Another device (or the admin console) ticked something: apply it as it happens, without a refetch.
  useRealtimeEvent("order.packing.changed", (payload) => {
    const event = payload as { orderId?: string; orderItemId?: string; isPicked?: boolean } | null;
    if (!event || event.orderId !== props.orderId || typeof event.orderItemId !== "string" || typeof event.isPicked !== "boolean") return;
    const { orderItemId, isPicked } = event;
    setOrder((current) => (current ? { ...current, items: current.items.map((item) => (item.id === orderItemId ? { ...item, isPicked } : item)) } : current));
  });

  async function load() {
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError(t("common:sessionExpired"));
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
        setActionError(t("common:sessionExpired"));
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
        setActionError(t("common:sessionExpired"));
        return;
      }
      setOrder(await proposeOrderItemFulfillment(accessToken, props.orderId, orderItemId, input));
    } catch (requestError) {
      setActionError(readError(requestError));
    } finally {
      setProposingFor(null);
    }
  }

  const isPacking = order !== null && isPackingStatus(order.status);
  const progress = packProgress((order?.items ?? []).map(asPackLine));

  // The escape hatch for an item that genuinely cannot be found at packing time: a substitution can
  // only be proposed before the order is accepted, so the packer must still be able to move on. It
  // names exactly what is unchecked so it is a decision, not a slip.
  async function readyAnyway() {
    if (!order) return;
    const missing = order.items
      .filter((item) => progress.remainingIds.includes(item.id))
      .map((item) => `• ${item.nameSnapshot}`)
      .join("\n");
    const confirmed = await confirmPackedAnyway(
      t("orders.pack.readyAnywayTitle"),
      t("orders.pack.readyAnywayBody", { items: missing }),
      t("orders.pack.readyAnywayConfirm")
    );
    if (confirmed) await performAction("READY_FOR_PICKUP");
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={colors.surfaceSunk} barStyle="dark-content" />
      <Header onBack={props.onBack} subtitle={order ? formatDate(order.createdAt) : t("orders.defaultSubtitle")} title={t("orders.orderDetailsTitle")} />
      {error ? (
        <View style={styles.centered}>
          <ErrorState message={error} onRetry={load} />
        </View>
      ) : order === null ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.formContent}>
          <View style={styles.summaryCard}>
            <View style={styles.orderRowHeader}>
              <Text style={styles.sectionTitle}>{t("orders.statusLabel")}</Text>
              <StatusBadge status={order.status} />
            </View>
            {isPacking ? (
              <View style={styles.packHeader}>
                <View style={styles.packHeaderRow}>
                  <Text style={styles.packTitle}>{t("orders.pack.title")}</Text>
                  <Text style={[styles.packProgressText, progress.complete && styles.packProgressDone]}>
                    {progress.complete ? t("orders.pack.allPacked") : t("orders.pack.progress", { packed: progress.packed, total: progress.total })}
                  </Text>
                </View>
                <View style={styles.packBarTrack}>
                  <View style={[styles.packBarFill, progress.complete && styles.packBarFillDone, { width: `${progress.total ? Math.round((progress.packed / progress.total) * 100) : 0}%` }]} />
                </View>
                {!progress.complete ? <Text style={styles.packHint}>{t("orders.pack.hint")}</Text> : null}
              </View>
            ) : null}
            {order.items.map((item) => (
              <View key={item.id} style={styles.orderItemBlock}>
                {isPacking || item.fulfillmentAdjustment?.status === "PENDING" ? (
                  <PackLineRow
                    item={item}
                    onToggle={() => toggleLine(item.id)}
                    packable={isPacking}
                    state={packLineState(asPackLine(item))}
                  />
                ) : (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryRowLabel}>
                    {t("orders.quantityUnitLine", { quantity: item.quantity, name: item.nameSnapshot, unit: item.unitLabelSnapshot })}
                    {item.allowSubstitution ? t("orders.replacementAllowedSuffix") : ""}
                  </Text>
                  <Text style={styles.summaryRowValue}>{formatPrice(item.lineTotalMinor)}</Text>
                </View>
                )}
                {item.fulfillmentAdjustment && !isPacking ? <FulfillmentSummary item={item} /> : null}
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
              <Text style={styles.summaryRowLabelBold}>{t("orders.totalLabel")}</Text>
              <Text style={styles.summaryRowValueBold}>{formatPrice(order.totalMinor)}</Text>
            </View>
            <View style={styles.summaryDivider} />
            <Text style={styles.label}>{t("orders.deliveryAddressLabel")}</Text>
            <Text style={styles.addressText}>
              {t("orders.addressLine", { label: order.deliveryLabel, address: order.deliveryAddressLine })}
            </Text>
          </View>

          <StatusTimeline history={order.statusHistory} />

          {nextRestaurantActionsByStatus[order.status].length > 0 ? (
            <View style={styles.actionRow}>
              {nextRestaurantActionsByStatus[order.status].map(({ action, labelKey }) => {
                // "Ready" is the one step that hands the order to a driver, so it waits until every
                // item is checked off. Nothing else about the flow is gated.
                const blocked = action === "READY_FOR_PICKUP" && !progress.complete;
                return (
                  <View key={action}>
                    <ActionButton
                      destructive={action === "REJECTED"}
                      disabled={blocked}
                      label={t(labelKey)}
                      loading={actingOn === action}
                      onPress={() => performAction(action)}
                    />
                    {blocked ? (
                      <>
                        <Text style={styles.readyBlockedText}>
                          {t("orders.pack.readyBlocked")} {t("orders.pack.remaining", { count: progress.remainingIds.length })}
                        </Text>
                        <Pressable accessibilityRole="button" onPress={() => void readyAnyway()} style={styles.readyAnywayButton}>
                          <Text style={styles.readyAnywayText}>{t("orders.pack.readyAnyway")}</Text>
                        </Pressable>
                      </>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.footerNote}>{t("orders.noFurtherAction")}</Text>
          )}
          <ErrorText message={actionError} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/** The packing rules read a line as a plain shape; `isPicked` is absent on a server that predates it. */
function asPackLine(item: OrderItemView): PackLine {
  return { id: item.id, isPicked: item.isPicked === true, fulfillmentAdjustment: item.fulfillmentAdjustment };
}

function confirmPackedAnyway(title: string, body: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(typeof globalThis.confirm === "function" ? globalThis.confirm(`${title}\n\n${body}`) : false);
  }
  return new Promise((resolve) => Alert.alert(title, body, [
    { text: i18n.t("common:cancel"), style: "cancel", onPress: () => resolve(false) },
    { text: confirmLabel, onPress: () => resolve(true) }
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}

/**
 * One line of the packing checklist: a big tap target (the whole row), the product photo so the
 * packer can confirm the right item by sight, and a state that is never ambiguous:
 *   empty box            still to pack
 *   green tick           packed as ordered
 *   amber swap           packed, but it is the approved REPLACEMENT
 *   amber clock, no box  waiting for the customer to decide (cannot be ticked)
 */
function PackLineRow(props: { item: OrderItemView; state: PackLineState; packable: boolean; onToggle: () => void }) {
  const { t } = useTranslation(["restaurantOps", "common"]);
  const { item, state } = props;
  const adjustment = item.fulfillmentAdjustment;
  const replacement = adjustment?.status === "APPROVED" && adjustment.replacementMenuItemId ? adjustment : null;
  const awaiting = state === "awaitingCustomer";
  const packed = state === "picked" || state === "pickedReplacement";
  // What the packer actually picks up: the approved replacement and/or the re-weighed quantity.
  const shownName = replacement?.replacementNameSnapshot ?? item.nameSnapshot;
  const shownImage = replacement ? replacement.replacementImageUrl : item.imageUrl;
  const approvedQuantity = adjustment?.status === "APPROVED" ? adjustment.actualQuantityMilli / 1_000 : item.quantity;
  const shownUnit = replacement?.replacementUnitLabelSnapshot ?? item.unitLabelSnapshot;
  const quantityText = t("orders.pack.packQuantity", { quantity: trimQuantity(approvedQuantity), unit: shownUnit });

  return (
    <Pressable
      accessibilityLabel={t("orders.pack.itemLabel", { name: shownName, quantity: quantityText })}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: packed, disabled: awaiting || !props.packable }}
      disabled={awaiting || !props.packable}
      onPress={props.onToggle}
      style={({ pressed }) => [
        styles.packRow,
        state === "picked" && styles.packRowPicked,
        state === "pickedReplacement" && styles.packRowReplacement,
        awaiting && styles.packRowAwaiting,
        pressed && styles.packRowPressed
      ]}
    >
      {props.packable ? (
        <View
          style={[
            styles.packBox,
            state === "picked" && styles.packBoxPicked,
            state === "pickedReplacement" && styles.packBoxReplacement,
            awaiting && styles.packBoxAwaiting
          ]}
        >
          {state === "picked" ? <Icon color={colors.textInverse} name="checkmark" size="md" /> : null}
          {state === "pickedReplacement" ? <Icon color={colors.textInverse} name="swap" size="md" /> : null}
          {awaiting ? <Icon color={colors.warning} name="time" size="md" /> : null}
        </View>
      ) : null}
      <RemoteImage resizeMode="cover" style={styles.packImage} uri={shownImage} />
      <View style={styles.packBody}>
        <Text numberOfLines={2} style={[styles.packName, packed && styles.packNameDone]}>{shownName}</Text>
        <Text style={styles.packQuantity}>{quantityText}</Text>
        {replacement ? (
          <Text style={styles.packReplacementNote}>
            <Text style={styles.packReplacementTag}>{t("orders.pack.replacementTag")} </Text>
            {t("orders.pack.replaces", { name: item.nameSnapshot })}
          </Text>
        ) : null}
        {adjustment?.status === "REJECTED" ? <Text style={styles.packMuted}>{t("orders.pack.declined")}</Text> : null}
        {awaiting ? <Text style={styles.packAwaitingNote}>{t("orders.pack.awaitingCustomer")}</Text> : null}
      </View>
      <Text style={styles.packPrice}>{formatPrice(item.lineTotalMinor)}</Text>
    </Pressable>
  );
}

/** 2 → "2", 1.5 → "1.5", 1.234 → "1.234": no trailing zeros for whole or short quantities. */
function trimQuantity(value: number): string {
  return String(Number(value.toFixed(3)));
}

function FulfillmentSummary(props: { item: OrderItemView }) {
  const { t } = useTranslation(["restaurantOps", "common"]);
  const adjustment = props.item.fulfillmentAdjustment!;
  const proposedName = adjustment.replacementNameSnapshot ?? props.item.nameSnapshot;
  return (
    <View style={styles.fulfillmentSummary}>
      <Text style={styles.fulfillmentTitle}>
        {t("orders.fulfillmentProposalStatus", { status: t(`common:status.${adjustment.status}`, adjustment.status) })}
      </Text>
      <Text style={styles.fulfillmentText}>
        {proposedName} / {(adjustment.actualQuantityMilli / 1_000).toFixed(3)} {adjustment.replacementUnitLabelSnapshot ?? props.item.unitLabelSnapshot}
      </Text>
      <Text style={styles.fulfillmentText}>{t("orders.proposedLineTotal", { amount: formatPrice(adjustment.lineTotalMinor) })}</Text>
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
  const { t } = useTranslation(["restaurantOps"]);
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
        {props.item.fulfillmentAdjustment?.status === "REJECTED" ? t("orders.reviseFulfillment") : t("orders.needCustomerDecision")}
      </Text>
      {props.item.allowSubstitution ? (
        <>
          <Text style={styles.editorLabel}>{t("orders.replacementProductLabel")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.replacementPicker}>
            <Pressable
              onPress={() => setReplacementMenuItemId("")}
              style={[styles.replacementChip, !replacementMenuItemId && styles.replacementChipActive]}
            >
              <Text style={[styles.replacementChipText, !replacementMenuItemId && styles.replacementChipTextActive]}>{t("orders.originalProduct")}</Text>
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
          <Text style={styles.editorLabel}>{t("orders.actualPackedQuantityLabel")}</Text>
          <TextInput
            keyboardType="decimal-pad"
            onChangeText={setPackedQuantity}
            style={styles.editorInput}
            value={packedQuantity}
          />
        </>
      ) : null}
      <Text style={styles.editorLabel}>{t("orders.noteForCustomerLabel")}</Text>
      <TextInput onChangeText={setNote} style={styles.editorInput} value={note} />
      <ActionButton
        disabled={!canPropose}
        label={props.item.fulfillmentAdjustment?.status === "PENDING" ? t("orders.replacePendingProposal") : t("orders.sendForCustomerReview")}
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
  const { t } = useTranslation(["restaurantOps", "common"]);
  if (props.history.length === 0) return null;
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.sectionTitle}>{t("orders.statusHistoryTitle")}</Text>
      {props.history.map((entry) => (
        <View key={entry.id} style={styles.timelineRow}>
          <Text style={styles.timelineStatus}>{t(`common:status.${entry.toStatus}`, entry.toStatus)}</Text>
          <Text style={styles.timelineDate}>{formatDate(entry.createdAt)}</Text>
          {entry.note ? <Text style={styles.timelineNote}>{entry.note}</Text> : null}
        </View>
      ))}
    </View>
  );
}

export function StatusBadge(props: { status: OrderStatusValue }) {
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
  const { t } = useTranslation(["restaurantOps"]);
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{props.message}</Text>
      {props.onRetry ? (
        <Pressable onPress={props.onRetry} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>{t("orders.tryAgain")}</Text>
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
        <ActivityIndicator color={colors.textInverse} />
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
  centered: { alignItems: "center", flex: 1, justifyContent: "center", padding: spacing[6] },
  emptyText: { ...text("body"), color: colors.textMuted, textAlign: "center" },
  listContent: { padding: spacing[4], paddingBottom: spacing[8] },
  formContent: { padding: spacing[4], paddingBottom: spacing[8] },
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
  orderRowHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  orderRowTotal: { ...text("bodySm", "bold"), color: colors.primary, marginTop: spacing[2] },
  statusBadge: { borderRadius: radius.sm, paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
  statusBadgeText: { ...text("label", "bold") },
  sectionTitle: { ...text("h3", "bold"), color: colors.text, marginBottom: spacing[2], marginTop: spacing[1] },
  summaryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing[4],
    padding: spacing[4]
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing[2] },
  orderItemBlock: { borderBottomColor: colors.border, borderBottomWidth: 1, paddingBottom: spacing[2], paddingTop: spacing[1] },
  summaryRowLabel: { ...text("bodySm"), color: colors.textMuted, flex: 1, paddingEnd: spacing[2] },
  summaryRowValue: { ...text("bodySm", "medium"), color: colors.text },
  summaryRowLabelBold: { ...text("bodySm", "bold"), color: colors.text },
  summaryRowValueBold: { ...text("bodySm", "bold"), color: colors.primary },
  summaryDivider: { backgroundColor: colors.border, height: 1, marginVertical: spacing[2] },
  label: { ...text("caption", "bold"), color: colors.text, marginBottom: spacing[2], marginTop: spacing[3] },
  addressText: { ...text("bodySm"), color: colors.text },
  timelineRow: { borderColor: colors.border, borderTopWidth: 1, paddingVertical: spacing[2] },
  timelineStatus: { ...text("bodySm", "bold"), color: colors.text },
  timelineDate: { ...text("label"), color: colors.textMuted, marginTop: spacing[1] },
  timelineNote: { ...text("caption"), color: colors.textMuted, fontStyle: "italic", marginTop: spacing[1] },
  actionRow: { gap: spacing[2], marginTop: spacing[1] },
  actionButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing[4]
  },
  actionButtonDestructive: { backgroundColor: colors.error },
  actionButtonText: { ...text("bodySm", "bold"), color: colors.textInverse },
  buttonPressed: { opacity: 0.85 },
  buttonDisabled: { opacity: 0.45 },
  fulfillmentSummary: { backgroundColor: colors.surfaceSunk, borderRadius: radius.sm, marginTop: spacing[1], padding: spacing[2] },
  fulfillmentEditor: { backgroundColor: colors.warningSubtle, borderRadius: radius.md, marginTop: spacing[2], padding: spacing[3] },
  fulfillmentTitle: { ...text("label", "bold"), color: colors.warning, marginBottom: spacing[1] },
  fulfillmentText: { ...text("label"), color: colors.text },
  fulfillmentNote: { ...text("label"), color: colors.textMuted, fontStyle: "italic", marginTop: spacing[1] },
  editorLabel: { ...text("label", "bold"), color: colors.text, marginBottom: spacing[1], marginTop: spacing[2] },
  editorInput: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, color: colors.text, marginBottom: spacing[1], minHeight: 42, paddingHorizontal: spacing[3] },
  replacementPicker: { marginBottom: spacing[1] },
  replacementChip: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.pill, borderWidth: 1, marginEnd: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  replacementChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  replacementChipText: { ...text("label", "bold"), color: colors.textMuted },
  replacementChipTextActive: { color: colors.textInverse },
  packHeader: { marginBottom: spacing[3] },
  packHeaderRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  packTitle: { ...text("h3", "bold"), color: colors.text },
  packProgressText: { ...text("bodySm", "bold"), color: colors.textMuted },
  packProgressDone: { color: colors.success },
  packBarTrack: { backgroundColor: colors.neutralSubtle, borderRadius: radius.pill, height: 8, marginTop: spacing[2], overflow: "hidden" },
  packBarFill: { backgroundColor: colors.primary, borderRadius: radius.pill, height: 8 },
  packBarFillDone: { backgroundColor: colors.success },
  packHint: { ...text("label"), color: colors.textMuted, marginTop: spacing[2] },
  packRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing[3],
    minHeight: 80,
    padding: spacing[2]
  },
  packRowPicked: { backgroundColor: colors.successSubtle, borderColor: colors.success },
  packRowReplacement: { backgroundColor: colors.warningSubtle, borderColor: colors.warning },
  packRowAwaiting: { backgroundColor: colors.warningSubtle, borderColor: colors.warning, borderStyle: "dashed" },
  packRowPressed: { opacity: 0.8 },
  packBox: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    borderWidth: 2,
    height: 32,
    justifyContent: "center",
    width: 32
  },
  packBoxPicked: { backgroundColor: colors.success, borderColor: colors.success },
  packBoxReplacement: { backgroundColor: colors.warning, borderColor: colors.warning },
  packBoxAwaiting: { backgroundColor: colors.surface, borderColor: colors.warning, borderStyle: "dashed" },
  packImage: { backgroundColor: colors.neutralSubtle, borderRadius: radius.sm, height: 64, width: 64 },
  packBody: { flex: 1 },
  packName: { ...text("bodySm", "bold"), color: colors.text },
  packNameDone: { color: colors.textMuted },
  packQuantity: { ...text("label"), color: colors.textMuted, marginTop: 2 },
  packReplacementNote: { ...text("label"), color: colors.text, marginTop: 2 },
  packReplacementTag: { ...text("label", "bold"), color: colors.warning },
  packMuted: { ...text("label"), color: colors.textMuted, fontStyle: "italic", marginTop: 2 },
  packAwaitingNote: { ...text("label", "bold"), color: colors.warning, marginTop: 2 },
  packPrice: { ...text("label", "bold"), color: colors.text },
  readyBlockedText: { ...text("label"), color: colors.textMuted, marginTop: spacing[2], textAlign: "center" },
  readyAnywayButton: { alignItems: "center", marginTop: spacing[1], paddingVertical: spacing[3] },
  readyAnywayText: { ...text("bodySm", "bold"), color: colors.warning, textDecorationLine: "underline" },
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
