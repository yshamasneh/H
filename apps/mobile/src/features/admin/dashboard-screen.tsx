import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  fetchAdminAccess,
  getAdminAccountingOverview,
  getAdminDashboard,
  type AdminAccess,
  type AdminAccountingOverview,
  type AdminDashboard,
  type PublicUser
} from "../../core/api";
import { getAccessToken } from "../../core/session";
import i18n from "../../i18n";
import { useRealtimeEvent } from "../../core/socket";
import { Icon } from "../../theme/icon";
import { useTheme } from "../../theme/theme-context";
import { radius, spacing, type ThemeColors } from "../../theme/tokens";
import { text } from "../../theme/typography";
import { attentionItems, type AttentionDestination } from "./attention.rules";
import {
  AdminPage,
  Card,
  CardTitle,
  EmptyState,
  ErrorBanner,
  KeyValue,
  LoadingState,
  Meta,
  useAdminStyles,
  formatDate,
  readAdminError
} from "./ui";
import { formatMinorExact, hasAdminPermission } from "./users.rules";


/**
 * The admin home on the phone: an operations tool, not a shrunken web console. It answers, in
 * order: what is waiting on me (with one tap to deal with it), how today is going, and where the
 * tools are — grouped by job and shown only when the account can use them. Configuration and heavy
 * bookkeeping (rates, payouts, adjustments, landmarks, platform settings) stay on the web console.
 */
export function AdminDashboardScreen(props: {
  user: PublicUser;
  onRestaurants: (filter?: "PENDING") => void;
  onOrders: (filter?: "PLACED") => void;
  onOpenOrder: (orderId: string) => void;
  onDrivers: (filter?: "PENDING") => void;
  onDriverCash: () => void;
  onCosts: () => void;
  onUsers: () => void;
  onNotifications: () => void;
  /** Rendered as the Home tab above the admin tab bar. */
  tabRoot?: boolean;
}) {
  const { t } = useTranslation(["admin", "common"]);
  const adminStyles = useAdminStyles();
  const styles = useScreenStyles();
  const { colors } = useTheme();
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [books, setBooks] = useState<AdminAccountingOverview | null>(null);
  const [access, setAccess] = useState<AdminAccess | null | "failed">(null);
  const [error, setError] = useState<string | null>(null);
  const knownAccess = access === "failed" ? null : access;
  // If the access check itself failed, every tool is offered and the server decides.
  const can = (permission?: string) => !permission || access === "failed" || hasAdminPermission(knownAccess, permission);

  async function load(currentAccess: AdminAccess | null | "failed" = access) {
    try {
      const token = await getAccessToken();
      if (!token) throw new Error(i18n.t("common:sessionExpired"));
      setDashboard(await getAdminDashboard(token));
      setError(null);
      if (currentAccess && currentAccess !== "failed" && hasAdminPermission(currentAccess, "VIEW_ACCOUNTING")) {
        // Optional: if the books fail to load, the rest of the dashboard still shows.
        setBooks(await getAdminAccountingOverview(token).catch(() => null));
      }
    } catch (requestError) {
      setError(readAdminError(requestError));
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let resolved: AdminAccess | "failed";
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("no session");
        resolved = await fetchAdminAccess(token);
      } catch {
        resolved = "failed";
      }
      if (cancelled) return;
      setAccess(resolved);
      await load(resolved);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRealtimeEvent("order.created", () => void load());
  useRealtimeEvent("order.status.changed", () => void load());
  useRealtimeEvent("restaurant.pending.created", () => void load());

  const go: Record<AttentionDestination, (() => void) | null> = {
    "orders-placed": () => props.onOrders("PLACED"),
    "stores-pending": () => props.onRestaurants("PENDING"),
    "drivers-pending": () => props.onDrivers("PENDING"),
    costs: props.onCosts,
    "driver-cash": props.onDriverCash,
    "web-accounting": null
  };
  const attention = dashboard ? attentionItems(dashboard, books, knownAccess) : [];

  return (
    <AdminPage
      headerAction={
        <Pressable
          accessibilityLabel={t("common:notifications")}
          accessibilityRole="button"
          hitSlop={8}
          onPress={props.onNotifications}
          style={({ pressed }) => [styles.bell, pressed ? styles.pressed : null]}
          testID="admin-notifications"
        >
          <Icon color={colors.text} name="notifications" size="md" />
        </Pressable>
      }
      subtitle={t("dashboard.signedInAs", { name: props.user.fullName })}
      tabRoot={props.tabRoot}
      title={t("dashboard.brandTitle")}
    >
      <ErrorBanner message={error} />
      {dashboard ? (
        <>
          <Text style={adminStyles.sectionTitle}>{t("dashboard.attentionTitle")}</Text>
          {access === null ? (
            <LoadingState />
          ) : attention.length === 0 ? (
            <Card>
              <Text style={styles.allClear}>{t("dashboard.allClear")}</Text>
            </Card>
          ) : (
            attention.map((item) => {
              const onPress = go[item.destination];
              return (
                <Pressable
                  accessibilityRole={onPress ? "button" : "text"}
                  disabled={!onPress}
                  key={item.key}
                  onPress={onPress ?? undefined}
                  style={({ pressed }) => [
                    styles.attention,
                    item.tone === "problem" ? { backgroundColor: colors.errorSubtle, borderStartColor: colors.error } : null,
                    pressed ? styles.pressed : null
                  ]}
                >
                  <Text style={styles.attentionValue}>
                    {item.isMoney ? formatMinorExact(item.value) : String(item.value)}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.attentionLabel}>{t(`dashboard.attention.${item.key}`)}</Text>
                    <Text style={[styles.attentionAction, item.tone === "problem" ? { color: colors.error } : null]}>
                      {onPress ? t(`dashboard.attention.${item.key}Action`) : t("dashboard.attention.onWeb")}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          )}

          <Text style={adminStyles.sectionTitle}>{t("dashboard.todayTitle")}</Text>
          <View style={adminStyles.grid}>
            <Stat label={t("dashboard.statOrdersToday")} onPress={can("VIEW_ALL_ORDERS") ? () => props.onOrders() : undefined} value={String(dashboard.ordersToday)} />
            <Stat label={t("dashboard.statRevenueToday")} value={formatMinorExact(dashboard.revenueTodayMinor)} />
            <Stat label={t("dashboard.statActiveDeliveries")} onPress={can("VIEW_ALL_ORDERS") ? () => props.onOrders() : undefined} value={String(dashboard.activeDeliveries)} />
            <Stat label={t("dashboard.statOnlineDrivers")} onPress={can("MANAGE_DRIVERS") ? () => props.onDrivers() : undefined} value={String(dashboard.onlineDriversCount)} />
            <Stat label={t("dashboard.statNewCustomers")} onPress={can("MANAGE_USERS") ? props.onUsers : undefined} value={String(dashboard.newCustomerSignupsToday)} />
          </View>

          <Text style={adminStyles.sectionTitle}>{t("dashboard.recentActivity")}</Text>
          {dashboard.activityFeed.length === 0 ? (
            <EmptyState message={t("dashboard.noActivity")} />
          ) : (
            dashboard.activityFeed.map((entry) => (
              <Card key={entry.id} onPress={can("VIEW_ALL_ORDERS") ? () => props.onOpenOrder(entry.orderId) : undefined}>
                <CardTitle>{entry.restaurantName}</CardTitle>
                <KeyValue label={t("dashboard.orderStatusLabel")} value={t(`common:status.${entry.toStatus}`, entry.toStatus.replace(/_/g, " "))} />
                <Meta>{formatDate(entry.createdAt)}</Meta>
              </Card>
            ))
          )}
        </>
      ) : error ? null : <LoadingState />}
    </AdminPage>
  );
}

function Stat(props: { label: string; value: string; onPress?: () => void }) {
  const adminStyles = useAdminStyles();
  const styles = useScreenStyles();
  const body = (
    <>
      <Text style={adminStyles.statValue}>{props.value}</Text>
      <Text style={adminStyles.statLabel}>{props.label}</Text>
    </>
  );
  return props.onPress ? (
    <Pressable
      accessibilityLabel={`${props.label}: ${props.value}`}
      accessibilityRole="button"
      onPress={props.onPress}
      style={({ pressed }) => [adminStyles.statCard, pressed ? styles.pressed : null]}
    >
      {body}
    </Pressable>
  ) : (
    <View style={adminStyles.statCard}>{body}</View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    attention: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderStartColor: colors.primary,
      borderStartWidth: 4,
      borderWidth: 1,
      flexDirection: "row",
      gap: spacing[4],
      minHeight: 64,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3]
    },
    attentionValue: { ...text("h2", "heavy"), color: colors.text, minWidth: 44, writingDirection: "ltr" },
    attentionLabel: { ...text("bodySm", "semibold"), color: colors.text },
    attentionAction: { ...text("caption", "semibold"), color: colors.primary, marginTop: spacing[1] },
    allClear: { ...text("bodySm", "semibold"), color: colors.success },
    pressed: { opacity: 0.7 },
    bell: { alignItems: "center", height: 44, justifyContent: "center", width: 44 }
  });
}

function useScreenStyles() {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [colors]);
}
