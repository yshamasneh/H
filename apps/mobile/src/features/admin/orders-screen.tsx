import { useEffect, useState } from "react";
import { View } from "react-native";
import {
  cancelAdminOrder,
  getAdminOrder,
  listAdminOrders,
  type OrderDetail,
  type OrderStatusValue
} from "../../core/api";
import { getAccessToken } from "../../core/session";
import { useRealtimeEvent } from "../../core/socket";
import { cancellableAdminOrderStatuses } from "./admin.rules";
import {
  ActionButton,
  AdminPage,
  Card,
  CardTitle,
  EmptyState,
  ErrorBanner,
  FilterChips,
  Input,
  KeyValue,
  LoadingState,
  Meta,
  StatusPill,
  adminStyles,
  formatDate,
  formatMoney,
  readAdminError
} from "./ui";

type OrderFilter = "ALL" | OrderStatusValue;

const filters: { label: string; value: OrderFilter }[] = [
  { label: "All", value: "ALL" },
  { label: "Placed", value: "PLACED" },
  { label: "Preparing", value: "PREPARING" },
  { label: "Ready", value: "READY_FOR_PICKUP" },
  { label: "Delivered", value: "DELIVERED" },
  { label: "Cancelled", value: "CANCELLED" }
];

export function AdminOrdersScreen(props: { onBack: () => void; onOpenOrder: (orderId: string) => void }) {
  const [orders, setOrders] = useState<OrderDetail[] | null>(null);
  const [filter, setFilter] = useState<OrderFilter>("ALL");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const page = await listAdminOrders(await requireToken(), filter === "ALL" ? {} : { status: filter });
      setOrders(page.items);
      setError(null);
    } catch (requestError) {
      setError(readAdminError(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, [filter]);

  useRealtimeEvent("order.created", () => void load());
  useRealtimeEvent("order.status.changed", () => void load());

  return (
    <AdminPage onBack={props.onBack} subtitle="All customer orders" title="Orders">
      <FilterChips onChange={setFilter} options={filters} value={filter} />
      <ErrorBanner message={error} />
      {orders === null ? (
        <LoadingState />
      ) : orders.length === 0 ? (
        <EmptyState message="No orders match this filter." />
      ) : (
        orders.map((order) => (
          <Card key={order.id}>
            <View style={adminStyles.rowBetween}>
              <View style={{ flex: 1 }}>
                <CardTitle>{order.restaurant.name}</CardTitle>
                <Meta>{formatDate(order.createdAt)}</Meta>
              </View>
              <StatusPill status={order.status} />
            </View>
            <KeyValue label="Total" value={formatMoney(order.totalMinor)} />
            <KeyValue label="Delivery" value={order.deliveryAddressLine} />
            <ActionButton label="View order" onPress={() => props.onOpenOrder(order.id)} variant="secondary" />
          </Card>
        ))
      )}
    </AdminPage>
  );
}

export function AdminOrderDetailScreen(props: { orderId: string; onBack: () => void }) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setOrder(await getAdminOrder(await requireToken(), props.orderId));
      setError(null);
    } catch (requestError) {
      setError(readAdminError(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, [props.orderId]);

  useRealtimeEvent("order.status.changed", (payload: unknown) => {
    if ((payload as { orderId?: string })?.orderId === props.orderId) void load();
  });

  async function cancel() {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await cancelAdminOrder(await requireToken(), props.orderId, reason.trim());
      setReason("");
      await load();
    } catch (requestError) {
      setError(readAdminError(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage onBack={props.onBack} subtitle={order ? formatDate(order.createdAt) : undefined} title={order?.restaurant.name ?? "Order details"}>
      <ErrorBanner message={error} />
      {!order ? (
        error ? null : <LoadingState />
      ) : (
        <>
          <Card>
            <View style={adminStyles.rowBetween}>
              <CardTitle>Order #{order.id.slice(0, 8)}</CardTitle>
              <StatusPill status={order.status} />
            </View>
            {order.items.map((item) => (
              <KeyValue key={item.id} label={`${item.quantity} × ${item.nameSnapshot}`} value={formatMoney(item.lineTotalMinor)} />
            ))}
            <KeyValue label="Subtotal" value={formatMoney(order.subtotalMinor)} />
            <KeyValue label="Delivery fee" value={formatMoney(order.deliveryFeeMinor)} />
            <KeyValue label="Service fee" value={formatMoney(order.serviceFeeMinor)} />
            <KeyValue label="Total" value={formatMoney(order.totalMinor)} />
            <KeyValue label="Payment" value={order.paymentMethod} />
            <KeyValue label="Address" value={order.deliveryAddressLine} />
          </Card>

          <Card>
            <CardTitle>Status history</CardTitle>
            {order.statusHistory.map((entry) => (
              <View key={entry.id}>
                <KeyValue label={formatDate(entry.createdAt)} value={entry.toStatus.replace(/_/g, " ")} />
                {entry.note ? <Meta>{entry.note}</Meta> : null}
              </View>
            ))}
          </Card>

          {cancellableAdminOrderStatuses.includes(order.status) ? (
            <View style={adminStyles.reasonBox}>
              <Input multiline onChangeText={setReason} placeholder="Required cancellation reason" value={reason} />
              <ActionButton disabled={!reason.trim()} label="Cancel order" loading={busy} onPress={() => void cancel()} variant="danger" />
            </View>
          ) : null}
        </>
      )}
    </AdminPage>
  );
}

async function requireToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error("Your session has expired. Please log in again.");
  return token;
}
