import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  getRestaurantOwnerProfile,
  listActiveRestaurantOffers,
  listRestaurantMenuCategories,
  listRestaurantMenuItems,
  listRestaurantOrders,
  setRestaurantMenuItemAvailability,
  type MenuCategoryOwner,
  type MenuItemOwner,
  type OrderDetail,
  type OrderStatusValue,
  type PublicUser,
  type RestaurantOffer,
  type RestaurantOwnerProfile
} from "../../core/api";
import { readError } from "../../core/errors";
import { useRealtimeEvent } from "../../core/socket";
import { getAccessToken } from "../../core/session";
import i18n from "../../i18n";
import { Icon } from "../../theme/icon";
import { colors, radius, spacing, statusFamily, statusPalette as tokenStatusPalette } from "../../theme/tokens";
import { text } from "../../theme/typography";

const activeOrderStatuses: OrderStatusValue[] = ["PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP"];
const maxCategoriesOnHome = 3;
const maxItemsPerCategory = 3;

export function RestaurantHomeScreen(props: {
  user: PublicUser;
  notice?: string;
  onManageOrders: () => void;
  onManageRestaurant: () => void;
  onEditItem: (itemId: string) => void;
  onOpenStats: () => void;
  onOpenOrder: (orderId: string) => void;
  onOpenNotifications: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation(["restaurantOps", "common"]);
  const [profile, setProfile] = useState<RestaurantOwnerProfile | null>(null);
  const [orders, setOrders] = useState<OrderDetail[]>([]);
  const [offers, setOffers] = useState<RestaurantOffer[]>([]);
  const [categories, setCategories] = useState<MenuCategoryOwner[]>([]);
  const [items, setItems] = useState<MenuItemOwner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  async function toggleAvailability(item: MenuItemOwner) {
    setBusyItemId(item.id);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error(i18n.t("common:sessionExpired"));
      const updated = await setRestaurantMenuItemAvailability(token, item.id, !item.isAvailable);
      setItems((current) => current.map((candidate) => (candidate.id === updated.id ? updated : candidate)));
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setBusyItemId(null);
    }
  }

  async function load() {
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error(i18n.t("common:sessionExpired"));
      const [nextProfile, orderPage, activeOffers, nextCategories, nextItems] = await Promise.all([
        getRestaurantOwnerProfile(token),
        listRestaurantOrders(token, 1, 20),
        listActiveRestaurantOffers(),
        listRestaurantMenuCategories(token),
        listRestaurantMenuItems(token)
      ]);
      setProfile(nextProfile);
      setOrders(orderPage.items);
      setOffers(activeOffers.filter((offer) => offer.restaurantId === nextProfile.id));
      setCategories(nextCategories);
      setItems(nextItems);
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useRealtimeEvent("order.created", () => void load());
  useRealtimeEvent("order.status.changed", () => void load());

  const activeOrders = useMemo(
    () => orders.filter((order) => activeOrderStatuses.includes(order.status)).slice(0, 5),
    [orders]
  );
  const itemsByCategory = useMemo(() => {
    const map = new Map<string, MenuItemOwner[]>();
    for (const item of items) {
      const list = map.get(item.categoryId) ?? [];
      list.push(item);
      map.set(item.categoryId, list);
    }
    return map;
  }, [items]);
  const visibleCategories = useMemo(() => categories.filter((category) => category.isActive), [categories]);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={colors.background} barStyle="dark-content" />
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle} numberOfLines={1}>{profile?.name ?? props.user.fullName}</Text>
          {profile ? (
            <View style={[styles.openBadge, profile.isOpenNow ? styles.openBadgeOn : styles.openBadgeOff]}>
              <Text style={[styles.openBadgeText, profile.isOpenNow ? styles.openBadgeTextOn : styles.openBadgeTextOff]}>
                {profile.isOpenNow ? t("dashboard.openBadge") : t("dashboard.closedBadge")}
              </Text>
            </View>
          ) : null}
        </View>
        <Pressable accessibilityLabel={t("common:notifications")} onPress={props.onOpenNotifications} style={styles.iconButton}>
          <Icon name="notifications" size="md" />
        </Pressable>
        <Pressable accessibilityLabel={t("common:settings")} onPress={props.onOpenSettings} style={styles.iconButton}>
          <Icon name="settings" size="md" />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : error && !profile ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void load()} style={styles.retryButton}>
            <Text style={styles.retryText}>{t("common:retry")}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {props.notice ? <Text style={styles.notice}>{props.notice}</Text> : null}

          <View style={styles.quickRow}>
            <QuickAction icon="orders" label={t("dashboard.quickOrders")} onPress={props.onManageOrders} />
            <QuickAction icon="browse" label={t("dashboard.quickCatalog")} onPress={props.onManageRestaurant} />
            <QuickAction icon="home" label={t("dashboard.quickStats")} onPress={props.onOpenStats} />
          </View>

          <SectionHeader title={t("dashboard.ordersSectionTitle")} actionLabel={t("dashboard.viewAll")} onAction={props.onManageOrders} />
          {activeOrders.length === 0 ? (
            <Empty text={t("dashboard.ordersEmpty")} />
          ) : (
            activeOrders.map((order) => (
              <Pressable key={order.id} onPress={() => props.onOpenOrder(order.id)} style={styles.orderCard}>
                <View style={styles.orderCopy}>
                  <StatusBadge status={order.status} />
                  <Text style={styles.orderMeta}>
                    {t("dashboard.orderItemsCount", { count: order.items.reduce((sum, item) => sum + item.quantity, 0) })}
                  </Text>
                </View>
                <Text style={styles.orderTotal}>{formatMoney(order.totalMinor)}</Text>
              </Pressable>
            ))
          )}

          <SectionHeader title={t("dashboard.offersSectionTitle")} />
          {offers.length === 0 ? (
            <Empty text={t("dashboard.offersEmpty")} />
          ) : (
            offers.map((offer) => (
              <View key={offer.id} style={styles.offerCard}>
                <View style={styles.offerCopy}>
                  <Text style={styles.offerTitle} numberOfLines={1}>{offer.title}</Text>
                  {offer.description ? <Text style={styles.offerDesc} numberOfLines={1}>{offer.description}</Text> : null}
                </View>
                {offer.discountPercent ? (
                  <View style={styles.discountPill}>
                    <Text style={styles.discountText}>{t("dashboard.offerDiscount", { percent: offer.discountPercent })}</Text>
                  </View>
                ) : null}
              </View>
            ))
          )}

          <SectionHeader title={t("dashboard.menuSectionTitle")} />
          {visibleCategories.length === 0 ? (
            <Empty text={t("dashboard.menuEmpty")} />
          ) : (
            <>
              {visibleCategories.slice(0, maxCategoriesOnHome).map((category) => {
                const allItems = itemsByCategory.get(category.id) ?? [];
                const shownItems = allItems.slice(0, maxItemsPerCategory);
                return (
                  <View key={category.id} style={styles.categoryCard}>
                    <View style={styles.categoryHeader}>
                      <Text style={styles.categoryName}>{category.name}</Text>
                      <Text style={styles.categoryCount}>{t("dashboard.itemsCount", { count: allItems.length })}</Text>
                    </View>
                    {shownItems.length === 0 ? (
                      <Text style={styles.categoryEmpty}>{t("dashboard.categoryEmpty")}</Text>
                    ) : (
                      shownItems.map((item) => (
                        <View key={item.id} style={styles.menuItemRow}>
                          <View style={styles.menuItemMain}>
                            <Text style={[styles.menuItemName, !item.isAvailable && styles.menuItemUnavailable]} numberOfLines={1}>
                              {item.name}{item.isAvailable ? "" : t("dashboard.unavailableSuffix")}
                            </Text>
                            <Text style={styles.menuItemPrice}>{formatMoney(item.priceMinor)}</Text>
                          </View>
                          <View style={styles.menuItemActions}>
                            <SmallButton label={t("dashboard.editButton")} onPress={() => props.onEditItem(item.id)} disabled={busyItemId === item.id} />
                            <SmallButton
                              label={item.isAvailable ? t("dashboard.pauseButton") : t("dashboard.resumeButton")}
                              onPress={() => void toggleAvailability(item)}
                              disabled={busyItemId === item.id}
                              danger={item.isAvailable}
                            />
                          </View>
                        </View>
                      ))
                    )}
                    {allItems.length > maxItemsPerCategory ? (
                      <Text style={styles.moreHint}>{t("dashboard.moreItems", { count: allItems.length - maxItemsPerCategory })}</Text>
                    ) : null}
                  </View>
                );
              })}
              <Pressable onPress={props.onManageRestaurant} style={styles.viewAllButton}>
                <Text style={styles.viewAllText}>{t("dashboard.viewAllCatalog")}</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function QuickAction(props: { icon: "orders" | "browse" | "home"; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={styles.quickAction}>
      <View style={styles.quickIcon}><Icon color={colors.primary} name={props.icon} size="md" /></View>
      <Text style={styles.quickLabel} numberOfLines={1}>{props.label}</Text>
    </Pressable>
  );
}

function SectionHeader(props: { title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{props.title}</Text>
      {props.actionLabel && props.onAction ? (
        <Pressable onPress={props.onAction}><Text style={styles.sectionAction}>{props.actionLabel}</Text></Pressable>
      ) : null}
    </View>
  );
}

function StatusBadge({ status }: { status: OrderStatusValue }) {
  const { t } = useTranslation(["common"]);
  const palette = tokenStatusPalette[statusFamily(status)];
  return (
    <View style={[styles.statusBadge, { backgroundColor: palette.background }]}>
      <Text style={[styles.statusBadgeText, { color: palette.foreground }]}>{t(`status.${status}`, status.replace(/_/g, " "))}</Text>
    </View>
  );
}

function SmallButton(props: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Pressable
      disabled={props.disabled}
      onPress={props.onPress}
      style={[styles.smallButton, props.danger && styles.smallButtonDanger, props.disabled && styles.smallButtonDisabled]}
    >
      <Text style={[styles.smallButtonText, props.danger && styles.smallButtonDangerText]}>{props.label}</Text>
    </Pressable>
  );
}

function Empty({ text: message }: { text: string }) {
  return <View style={styles.empty}><Text style={styles.emptyText}>{message}</Text></View>;
}

function formatMoney(minor: number): string {
  return `${(minor / 100).toFixed(2)} ₪`;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  header: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing[2],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4]
  },
  headerCopy: { alignItems: "flex-start", flex: 1, gap: spacing[2] },
  headerTitle: { ...text("h2", "bold"), color: colors.text },
  openBadge: { borderRadius: radius.pill, paddingHorizontal: spacing[3], paddingVertical: spacing[1] },
  openBadgeOn: { backgroundColor: colors.successSubtle },
  openBadgeOff: { backgroundColor: colors.errorSubtle },
  openBadgeText: { ...text("label", "bold") },
  openBadgeTextOn: { color: colors.success },
  openBadgeTextOff: { color: colors.error },
  iconButton: { alignItems: "center", backgroundColor: colors.surfaceSunk, borderRadius: radius.lg, height: 44, justifyContent: "center", width: 44 },
  center: { alignItems: "center", flex: 1, gap: spacing[4], justifyContent: "center", padding: spacing[5] },
  content: { alignSelf: "center", maxWidth: 720, padding: spacing[5], paddingBottom: spacing[9], width: "100%" },
  notice: { ...text("bodySm"), backgroundColor: colors.successSubtle, borderRadius: radius.md, color: colors.success, marginBottom: spacing[4], padding: spacing[3] },
  quickRow: { flexDirection: "row", gap: spacing[3], marginBottom: spacing[5] },
  quickAction: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, flex: 1, gap: spacing[2], paddingVertical: spacing[4] },
  quickIcon: { alignItems: "center", backgroundColor: colors.primarySubtle, borderRadius: radius.md, height: 40, justifyContent: "center", width: 40 },
  quickLabel: { ...text("label", "bold"), color: colors.text },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: spacing[3], marginTop: spacing[3] },
  sectionTitle: { ...text("h3", "bold"), color: colors.text },
  sectionAction: { ...text("label", "bold"), color: colors.primary },
  orderCard: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginBottom: spacing[2], padding: spacing[4] },
  orderCopy: { alignItems: "flex-start", gap: spacing[2] },
  statusBadge: { borderRadius: radius.pill, paddingHorizontal: spacing[3], paddingVertical: spacing[1] },
  statusBadgeText: { ...text("label", "bold") },
  orderMeta: { ...text("caption"), color: colors.textMuted },
  orderTotal: { ...text("bodySm", "bold"), color: colors.text },
  offerCard: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: spacing[3], justifyContent: "space-between", marginBottom: spacing[2], padding: spacing[4] },
  offerCopy: { flex: 1, gap: spacing[1] },
  offerTitle: { ...text("bodySm", "bold"), color: colors.text },
  offerDesc: { ...text("caption"), color: colors.textMuted },
  discountPill: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing[3], paddingVertical: spacing[1] },
  discountText: { ...text("label", "bold"), color: colors.textInverse },
  categoryCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing[3], padding: spacing[4] },
  categoryHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: spacing[3] },
  categoryName: { ...text("bodySm", "bold"), color: colors.text },
  categoryCount: { ...text("caption"), color: colors.textMuted },
  categoryEmpty: { ...text("caption"), color: colors.textMuted },
  menuItemRow: { borderTopColor: colors.border, borderTopWidth: 1, gap: spacing[2], paddingVertical: spacing[3] },
  menuItemMain: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  menuItemName: { ...text("bodySm"), color: colors.text, flex: 1, paddingEnd: spacing[2] },
  menuItemUnavailable: { color: colors.textMuted, textDecorationLine: "line-through" },
  menuItemPrice: { ...text("bodySm", "bold"), color: colors.text },
  menuItemActions: { flexDirection: "row", gap: spacing[2] },
  smallButton: { backgroundColor: colors.primarySubtle, borderRadius: radius.sm, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  smallButtonText: { ...text("label", "bold"), color: colors.primaryPressed },
  smallButtonDanger: { backgroundColor: colors.errorSubtle },
  smallButtonDangerText: { color: colors.error },
  smallButtonDisabled: { opacity: 0.5 },
  moreHint: { ...text("caption"), color: colors.textMuted, marginTop: spacing[2] },
  viewAllButton: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.primary, borderRadius: radius.lg, borderWidth: 1, marginTop: spacing[1], padding: spacing[4] },
  viewAllText: { ...text("bodySm", "bold"), color: colors.primary },
  empty: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing[2], padding: spacing[5] },
  emptyText: { ...text("bodySm"), color: colors.textMuted, textAlign: "center" },
  errorText: { ...text("bodySm"), color: colors.error, textAlign: "center" },
  retryButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing[5], paddingVertical: spacing[3] },
  retryText: { ...text("bodySm", "bold"), color: colors.textInverse }
});
