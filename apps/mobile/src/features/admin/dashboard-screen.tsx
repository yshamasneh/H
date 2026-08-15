import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { getAdminDashboard, type AdminDashboard, type PublicUser } from "../../core/api";
import { getAccessToken } from "../../core/session";
import i18n from "../../i18n";
import { useRealtimeEvent } from "../../core/socket";
import {
  ActionButton,
  ActionRow,
  AdminPage,
  Card,
  CardTitle,
  EmptyState,
  ErrorBanner,
  KeyValue,
  LoadingState,
  Meta,
  adminStyles,
  formatDate,
  formatMoney,
  readAdminError
} from "./ui";

export function AdminDashboardScreen(props: {
  user: PublicUser;
  onLogout: () => Promise<void>;
  onRestaurants: () => void;
  onOffers: () => void;
  onOrders: () => void;
  onDrivers: () => void;
  onUsers: () => void;
  onAuditLog: () => void;
  onNotifications: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation(["admin", "common"]);
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  async function load() {
    try {
      const token = await getAccessToken();
      if (!token) throw new Error(i18n.t("common:sessionExpired"));
      setDashboard(await getAdminDashboard(token));
      setError(null);
    } catch (requestError) {
      setError(readAdminError(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useRealtimeEvent("order.created", () => void load());
  useRealtimeEvent("order.status.changed", () => void load());
  useRealtimeEvent("restaurant.pending.created", () => void load());

  async function logOut() {
    setLoggingOut(true);
    try {
      await props.onLogout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <AdminPage title={t("dashboard.brandTitle")} subtitle={t("dashboard.signedInAs", { name: props.user.fullName })}>
      <ErrorBanner message={error} />
      {dashboard ? (
        <>
          <View style={adminStyles.grid}>
            <Stat label={t("dashboard.statOrdersToday")} value={String(dashboard.ordersToday)} />
            <Stat label={t("dashboard.statRevenueToday")} value={formatMoney(dashboard.revenueTodayMinor)} />
            <Stat label={t("dashboard.statActiveDeliveries")} value={String(dashboard.activeDeliveries)} />
            <Stat label={t("dashboard.statPendingStores")} value={String(dashboard.pendingRestaurantApprovals)} />
            <Stat label={t("dashboard.statOnlineDrivers")} value={String(dashboard.onlineDriversCount)} />
            <Stat label={t("dashboard.statNewCustomers")} value={String(dashboard.newCustomerSignupsToday)} />
          </View>

          <Text style={adminStyles.sectionTitle}>{t("dashboard.managementSection")}</Text>
          <Card onPress={props.onRestaurants}><CardTitle>{t("dashboard.storesTitle")}</CardTitle><Meta>{t("dashboard.storesMeta")}</Meta></Card>
          <Card onPress={props.onOffers}><CardTitle>{t("dashboard.offersTitle")}</CardTitle><Meta>{t("dashboard.offersMeta")}</Meta></Card>
          <Card onPress={props.onOrders}><CardTitle>{t("dashboard.ordersTitle")}</CardTitle><Meta>{t("dashboard.ordersMeta")}</Meta></Card>
          <Card onPress={props.onDrivers}><CardTitle>{t("dashboard.driversTitle")}</CardTitle><Meta>{t("dashboard.driversMeta")}</Meta></Card>
          <Card onPress={props.onUsers}><CardTitle>{t("dashboard.usersTitle")}</CardTitle><Meta>{t("dashboard.usersMeta")}</Meta></Card>
          <Card onPress={props.onAuditLog}><CardTitle>{t("dashboard.auditLogTitle")}</CardTitle><Meta>{t("dashboard.auditLogMeta")}</Meta></Card>

          <Text style={adminStyles.sectionTitle}>{t("dashboard.recentActivity")}</Text>
          {dashboard.activityFeed.length === 0 ? (
            <EmptyState message={t("dashboard.noActivity")} />
          ) : (
            dashboard.activityFeed.map((entry) => (
              <Card key={entry.id}>
                <CardTitle>{entry.restaurantName}</CardTitle>
                <KeyValue label={t("dashboard.orderStatusLabel")} value={t(`common:status.${entry.toStatus}`, entry.toStatus.replace(/_/g, " "))} />
                <Meta>{formatDate(entry.createdAt)}</Meta>
              </Card>
            ))
          )}
        </>
      ) : error ? null : <LoadingState />}
      <ActionRow>
        <ActionButton label={t("common:notifications")} onPress={props.onNotifications} variant="secondary" />
        <ActionButton label={t("common:settings")} onPress={props.onOpenSettings} variant="secondary" />
        <ActionButton label={t("common:logout")} loading={loggingOut} onPress={() => void logOut()} variant="danger" />
      </ActionRow>
    </AdminPage>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <View style={adminStyles.statCard}>
      <Text style={adminStyles.statValue}>{props.value}</Text>
      <Text style={adminStyles.statLabel}>{props.label}</Text>
    </View>
  );
}
