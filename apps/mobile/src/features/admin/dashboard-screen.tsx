import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { getAdminDashboard, type AdminDashboard, type PublicUser } from "../../core/api";
import { getAccessToken } from "../../core/session";
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
}) {
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  async function load() {
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Your session has expired. Please log in again.");
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
    <AdminPage title="TasawaQ Admin" subtitle={`Signed in as ${props.user.fullName}`}>
      <ErrorBanner message={error} />
      {dashboard ? (
        <>
          <View style={adminStyles.grid}>
            <Stat label="Orders today" value={String(dashboard.ordersToday)} />
            <Stat label="Revenue today" value={formatMoney(dashboard.revenueTodayMinor)} />
            <Stat label="Active deliveries" value={String(dashboard.activeDeliveries)} />
            <Stat label="Pending stores" value={String(dashboard.pendingRestaurantApprovals)} />
            <Stat label="Online drivers" value={String(dashboard.onlineDriversCount)} />
            <Stat label="New customers" value={String(dashboard.newCustomerSignupsToday)} />
          </View>

          <Text style={adminStyles.sectionTitle}>Management</Text>
          <Card onPress={props.onRestaurants}><CardTitle>Stores</CardTitle><Meta>Restaurant and supermarket approvals, suspensions, and performance</Meta></Card>
          <Card onPress={props.onOffers}><CardTitle>Offers</CardTitle><Meta>Publish product, order, delivery, and free-delivery campaigns</Meta></Card>
          <Card onPress={props.onOrders}><CardTitle>Orders</CardTitle><Meta>Search all orders and apply support cancellations</Meta></Card>
          <Card onPress={props.onDrivers}><CardTitle>Drivers</CardTitle><Meta>Approve drivers and manage their operational status</Meta></Card>
          <Card onPress={props.onUsers}><CardTitle>Users</CardTitle><Meta>Search customers and accounts by role</Meta></Card>
          <Card onPress={props.onAuditLog}><CardTitle>Audit Log</CardTitle><Meta>Review every recorded administration action</Meta></Card>

          <Text style={adminStyles.sectionTitle}>Recent activity</Text>
          {dashboard.activityFeed.length === 0 ? (
            <EmptyState message="No order activity yet." />
          ) : (
            dashboard.activityFeed.map((entry) => (
              <Card key={entry.id}>
                <CardTitle>{entry.restaurantName}</CardTitle>
                <KeyValue label="Order status" value={entry.toStatus.replace(/_/g, " ")} />
                <Meta>{formatDate(entry.createdAt)}</Meta>
              </Card>
            ))
          )}
        </>
      ) : error ? null : <LoadingState />}
      <ActionRow>
        <ActionButton label="Notifications" onPress={props.onNotifications} variant="secondary" />
        <ActionButton label="Log out" loading={loggingOut} onPress={() => void logOut()} variant="danger" />
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
