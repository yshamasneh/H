import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { listRestaurantOrders, updateOrderStatus, type OrderDetail } from "../../core/api";
import { readError } from "../../core/errors";
import { getAccessToken } from "../../core/session";
import { RemoteImage } from "../../components/remote-image";
import { useToast } from "../../components/toast";
import { colors, radius, spacing } from "../../theme/tokens";
import { text } from "../../theme/typography";
import { ageLabel, countItems, escalateAfterMs, queueSections, shortReference, type QueueSectionStatus } from "./live-queue.rules";
import { isPackingStatus, packProgress } from "./pack-checklist";
import { StatusBadge } from "./order-screens";
import { StoreSoundChip, useStoreLiveQueue } from "./store-live-queue";

/**
 * The store's order board on a phone: the four store stages (New, Accepted, Preparing, Ready for
 * pickup) as tabs that each show their count, so "how many at each stage" is readable at a glance
 * and any stage is one tap away. New is selected whenever something is waiting and is the only
 * orange tab. New tickets carry Accept, Accepted tickets carry Start preparing; marking ready stays
 * on the order screen with the packing checklist. A fifth tab keeps the full recent history.
 *
 * The live stages come from the StoreLiveQueueProvider (the same queue that drives the sound and
 * popup), so this screen adds no request of its own for them.
 */
type Tab = QueueSectionStatus | "HISTORY";

const tabAccent: Record<QueueSectionStatus, { fg: string; bg: string }> = {
  PLACED: { fg: colors.primary, bg: colors.primarySubtle },
  ACCEPTED: { fg: colors.info, bg: colors.infoSubtle },
  PREPARING: { fg: colors.warning, bg: colors.warningSubtle },
  READY_FOR_PICKUP: { fg: colors.success, bg: colors.successSubtle }
};

export function RestaurantOrdersScreen(props: { onBack: () => void; onOpenOrder: (orderId: string) => void }) {
  const { t } = useTranslation(["restaurantOps", "common"]);
  const live = useStoreLiveQueue();
  const sections = useMemo(() => (live?.queue ? queueSections(live.queue) : null), [live?.queue]);
  const newCount = sections?.[0].orders.length ?? 0;
  const [tab, setTab] = useState<Tab>("PLACED");
  const userPicked = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  // Until the person picks a tab themselves, jump to whichever stage has work, New first.
  useEffect(() => {
    if (userPicked.current || !sections) return;
    const firstBusy = sections.find((section) => section.orders.length > 0);
    if (firstBusy) setTab(firstBusy.status);
  }, [sections]);
  // A new order always pulls the board back to New.
  const previousNew = useRef(newCount);
  useEffect(() => {
    if (newCount > previousNew.current) setTab("PLACED");
    previousNew.current = newCount;
  }, [newCount]);

  function pick(next: Tab) {
    userPicked.current = true;
    setTab(next);
  }

  async function refresh() {
    setRefreshing(true);
    await live?.reload();
    setRefreshing(false);
  }

  const current = sections?.find((section) => section.status === tab);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={colors.surface} barStyle="dark-content" />
      <View style={styles.header}>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={props.onBack} style={styles.back}>
          <Text style={styles.backText}>{t("common:back")}</Text>
        </Pressable>
        <Text style={styles.title}>{t("live.boardTitle")}</Text>
        <StoreSoundChip />
      </View>

      <ScrollView contentContainerStyle={styles.tabs} horizontal showsHorizontalScrollIndicator={false} style={styles.tabsBar}>
        {(sections ?? []).map((section) => {
          const selected = tab === section.status;
          const accent = tabAccent[section.status];
          const urgent = section.status === "PLACED" && section.orders.length > 0;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={section.status}
              onPress={() => pick(section.status)}
              style={[
                styles.tab,
                { borderTopColor: accent.fg },
                selected && { backgroundColor: accent.bg, borderColor: accent.fg },
                urgent && styles.tabUrgent
              ]}
            >
              <Text style={[styles.tabCount, { color: urgent ? colors.textInverse : section.orders.length ? accent.fg : colors.textMuted }]}>
                {section.orders.length}
              </Text>
              <Text style={[styles.tabLabel, urgent && { color: colors.textInverse }]} numberOfLines={1}>
                {t(`live.section.${section.status}`)}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === "HISTORY" }}
          onPress={() => pick("HISTORY")}
          style={[styles.tab, tab === "HISTORY" && styles.tabHistorySelected]}
        >
          <Text style={styles.tabLabel}>{t("live.history")}</Text>
        </Pressable>
      </ScrollView>

      {tab === "HISTORY" ? (
        <HistoryList onOpenOrder={props.onOpenOrder} />
      ) : !live || !sections ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={current?.orders ?? []}
          keyExtractor={(order) => order.id}
          ListEmptyComponent={<Text style={styles.empty}>{t("live.sectionEmpty")}</Text>}
          refreshControl={<RefreshControl onRefresh={refresh} refreshing={refreshing} tintColor={colors.primary} />}
          renderItem={({ item }) => <Ticket onOpen={() => props.onOpenOrder(item.id)} order={item} />}
        />
      )}
    </SafeAreaView>
  );
}

function Ticket({ order, onOpen }: { order: OrderDetail; onOpen: () => void }) {
  const { t } = useTranslation(["restaurantOps", "common"]);
  const live = useStoreLiveQueue()!;
  const { showToast } = useToast();
  const [starting, setStarting] = useState(false);
  const ageMs = live.now - new Date(order.createdAt).getTime();
  const age = ageLabel(ageMs);
  const isNew = order.status === "PLACED";
  const isLate = isNew && ageMs > escalateAfterMs;
  const accepting = live.acceptingIds.has(order.id);
  const packing = isPackingStatus(order.status)
    ? packProgress(order.items.map((item) => ({ id: item.id, isPicked: Boolean(item.isPicked), fulfillmentAdjustment: item.fulfillmentAdjustment ?? null })))
    : null;

  async function startPreparing() {
    setStarting(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error(t("common:sessionExpired"));
      await updateOrderStatus(token, order.id, "PREPARING");
      showToast(t("live.preparingToast", { ref: shortReference(order.id) }));
    } catch (error) {
      showToast(readError(error));
    } finally {
      setStarting(false);
      void live.reload();
    }
  }

  return (
    <View style={[styles.ticket, isNew && styles.ticketNew, isLate && styles.ticketLate]}>
      <Pressable accessibilityRole="button" onPress={onOpen} style={({ pressed }) => [styles.ticketBody, pressed && styles.pressed]}>
        <View style={styles.ticketRow}>
          <Text style={[styles.ticketRef, isNew && { color: colors.primaryPressed }]}>{shortReference(order.id)}</Text>
          <Text style={[styles.ticketAge, isLate && { color: colors.error }]}>{t(age.key, { count: age.count })}</Text>
        </View>
        <View style={styles.ticketRow}>
          <Text style={styles.ticketMeta}>{t("live.itemCount", { count: countItems(order) })}</Text>
          <Text style={styles.ticketTotal}>{`${(order.totalMinor / 100).toFixed(2)} ₪`}</Text>
        </View>
        <View style={styles.thumbs}>
          {order.items.slice(0, 6).map((item) => (
            <RemoteImage key={item.id} style={styles.thumb} uri={item.imageUrl ?? null} />
          ))}
        </View>
        <View style={styles.ticketRow}>
          {packing && packing.total > 0 ? (
            <Text style={[styles.ticketMeta, packing.complete && { color: colors.success }]}>
              {t("live.packed", { packed: packing.packed, total: packing.total })}
            </Text>
          ) : (
            <View />
          )}
          {order.requiresCustomerReview ? <Text style={styles.review}>{t("live.awaitingCustomer")}</Text> : null}
        </View>
      </Pressable>
      {isNew ? (
        <Pressable
          accessibilityRole="button"
          disabled={accepting}
          onPress={() => void live.accept(order)}
          style={({ pressed }) => [styles.action, styles.actionPrimary, (pressed || accepting) && styles.pressed]}
        >
          <Text style={styles.actionPrimaryText}>{accepting ? t("live.working") : t("live.accept")}</Text>
        </Pressable>
      ) : null}
      {order.status === "ACCEPTED" ? (
        <Pressable
          accessibilityRole="button"
          disabled={starting}
          onPress={() => void startPreparing()}
          style={({ pressed }) => [styles.action, styles.actionSecondary, (pressed || starting) && styles.pressed]}
        >
          <Text style={styles.actionSecondaryText}>{starting ? t("live.working") : t("live.startPreparing")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The full recent history (all statuses, newest first) — what this screen used to be. */
function HistoryList({ onOpenOrder }: { onOpenOrder: (orderId: string) => void }) {
  const { t } = useTranslation(["restaurantOps", "common"]);
  const [orders, setOrders] = useState<OrderDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const token = await getAccessToken();
      if (!token) throw new Error(t("common:sessionExpired"));
      setOrders((await listRestaurantOrders(token, 1, 30)).items);
      setError(null);
    } catch (requestError) {
      setError(readError(requestError));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!orders) {
    return <View style={styles.centered}>{error ? <Text style={styles.empty}>{error}</Text> : <ActivityIndicator color={colors.primary} size="large" />}</View>;
  }
  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={orders}
      keyExtractor={(order) => order.id}
      ListEmptyComponent={<Text style={styles.empty}>{t("orders.noOrdersYet")}</Text>}
      refreshControl={
        <RefreshControl
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          refreshing={refreshing}
          tintColor={colors.primary}
        />
      }
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" onPress={() => onOpenOrder(item.id)} style={({ pressed }) => [styles.ticket, styles.ticketBody, pressed && styles.pressed]}>
          <View style={styles.ticketRow}>
            <Text style={styles.ticketRef}>{shortReference(item.id)}</Text>
            <StatusBadge status={item.status} />
          </View>
          <View style={styles.ticketRow}>
            <Text style={styles.ticketMeta}>{new Date(item.createdAt).toLocaleString()}</Text>
            <Text style={styles.ticketTotal}>{`${(item.totalMinor / 100).toFixed(2)} ₪`}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.surfaceSunk, flex: 1 },
  header: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2]
  },
  back: { justifyContent: "center", minHeight: 44 },
  backText: { ...text("bodySm", "bold"), color: colors.textMuted },
  title: { ...text("h2", "bold"), color: colors.text, flex: 1 },
  tabsBar: { backgroundColor: colors.surface, flexGrow: 0 },
  tabs: { gap: spacing[2], padding: spacing[3] },
  tab: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderTopWidth: 4,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 64,
    minWidth: 96,
    paddingHorizontal: spacing[3]
  },
  tabUrgent: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabHistorySelected: { backgroundColor: colors.neutralSubtle, borderColor: colors.borderStrong },
  tabCount: { ...text("h1", "heavy") },
  tabLabel: { ...text("caption", "bold"), color: colors.text },
  list: { alignSelf: "center", gap: spacing[3], maxWidth: 720, padding: spacing[4], paddingBottom: spacing[9] * 3, width: "100%" },
  centered: { alignItems: "center", flex: 1, justifyContent: "center", padding: spacing[6] },
  empty: { ...text("body"), color: colors.textMuted, paddingVertical: spacing[8], textAlign: "center" },
  ticket: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, overflow: "hidden" },
  ticketNew: { backgroundColor: colors.primarySubtle, borderColor: colors.primaryBorder, borderWidth: 2 },
  ticketLate: { borderColor: colors.error },
  ticketBody: { gap: spacing[2], padding: spacing[4] },
  ticketRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  ticketRef: { ...text("h2", "heavy"), color: colors.text },
  ticketAge: { ...text("caption", "bold"), color: colors.textMuted },
  ticketMeta: { ...text("bodySm", "semibold"), color: colors.textMuted },
  ticketTotal: { ...text("h3", "bold"), color: colors.text },
  review: { ...text("caption", "bold"), color: colors.warning },
  thumbs: { flexDirection: "row", gap: spacing[2] },
  thumb: { backgroundColor: colors.neutralSubtle, borderRadius: radius.sm, height: 40, width: 40 },
  action: { alignItems: "center", justifyContent: "center", minHeight: 52 },
  actionPrimary: { backgroundColor: colors.primary },
  actionPrimaryText: { ...text("body", "bold"), color: colors.textInverse },
  actionSecondary: { borderTopColor: colors.border, borderTopWidth: 1 },
  actionSecondaryText: { ...text("body", "bold"), color: colors.info },
  pressed: { opacity: 0.8 }
});
