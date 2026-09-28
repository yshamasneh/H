import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import i18n from "../../i18n";
import {
  cancelAdminOrder,
  fetchAdminAccess,
  getAdminOrder,
  getAdminOrderTracking,
  type AdminOrderTracking,
  listAdminOrders,
  type OrderDetail,
  type OrderStatusValue
} from "../../core/api";
import { CallCustomerButton } from "../../components/call-customer-button";
import { RemoteImage } from "../../components/remote-image";
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
  PhoneNumber,
  StatusPill,
  useAdminStyles,
  formatDate,
  formatMoney,
  readAdminError
} from "./ui";

type OrderFilter = "ALL" | OrderStatusValue;

// Every status an order can be in, so a failed or rejected order can be found from the phone too.
const filterValues: OrderFilter[] = [
  "ALL",
  "PLACED",
  "ACCEPTED",
  "PREPARING",
  "READY_FOR_PICKUP",
  "DELIVERED",
  "DELIVERY_FAILED",
  "REJECTED",
  "CANCELLED"
];

export function AdminOrdersScreen(props: {
  /** Absent when the list is the Orders tab (the tab bar is the way out). */
  onBack?: () => void;
  onOpenOrder: (orderId: string) => void;
  /** Opens the list already filtered, e.g. from the dashboard's "not yet accepted" item. */
  initialFilter?: OrderFilter;
  tabRoot?: boolean;
}) {
  const adminStyles = useAdminStyles();
  const { t } = useTranslation(["admin", "common"]);
  const [orders, setOrders] = useState<OrderDetail[] | null>(null);
  const [filter, setFilter] = useState<OrderFilter>(props.initialFilter ?? "ALL");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filters = filterValues.map((value) => ({
    value,
    label: value === "ALL" ? t("orders.filterAll") : t(`common:status.${value}`)
  }));

  // Reloads every page already shown, so a live update never drops orders the admin scrolled to.
  async function load(pages = page) {
    try {
      const token = await requireToken();
      const status = filter === "ALL" ? {} : { status: filter };
      const results = await Promise.all(
        Array.from({ length: pages }, (_, index) => listAdminOrders(token, { ...status, page: index + 1 }))
      );
      setOrders(results.flatMap((result) => result.items));
      setTotal(results[0]?.total ?? 0);
      setError(null);
    } catch (requestError) {
      setError(readAdminError(requestError));
    }
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const next = page + 1;
      const result = await listAdminOrders(await requireToken(), { ...(filter === "ALL" ? {} : { status: filter }), page: next });
      setOrders((current) => [...(current ?? []), ...result.items]);
      setTotal(result.total);
      setPage(next);
    } catch (requestError) {
      setError(readAdminError(requestError));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    setPage(1);
    setOrders(null);
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useRealtimeEvent("order.created", () => void load());
  useRealtimeEvent("order.status.changed", () => void load());

  return (
    <AdminPage onBack={props.onBack} subtitle={t("orders.subtitle")} tabRoot={props.tabRoot} title={t("orders.title")}>
      <FilterChips onChange={setFilter} options={filters} value={filter} />
      <ErrorBanner message={error} />
      {orders === null ? (
        <LoadingState />
      ) : orders.length === 0 ? (
        <EmptyState message={t("orders.empty")} />
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
            <KeyValue label={t("orders.totalLabel")} value={formatMoney(order.totalMinor)} />
            <KeyValue label={t("orders.deliveryLabel")} value={order.deliveryAddressLine} />
            <ActionButton label={t("orders.viewOrderButton")} onPress={() => props.onOpenOrder(order.id)} variant="secondary" />
          </Card>
        ))
      )}
      {orders !== null && orders.length < total ? (
        <ActionButton
          label={t("orders.loadMore", { shown: orders.length, total })}
          loading={loadingMore}
          onPress={() => void loadMore()}
          variant="secondary"
        />
      ) : null}
    </AdminPage>
  );
}

export function AdminOrderDetailScreen(props: { orderId: string; onBack: () => void }) {
  const adminStyles = useAdminStyles();
  const { t } = useTranslation(["admin", "common"]);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [tracking, setTracking] = useState<AdminOrderTracking | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const token = await requireToken();
      setOrder(await getAdminOrder(token, props.orderId));
      setError(null);
      // Who is delivering it, for a follow-up call. Only for accounts that manage drivers; a missing
      // permission or an order with no delivery simply leaves the section without a driver.
      const access = await fetchAdminAccess(token).catch(() => null);
      if (access && (access.isSuperAdmin || access.permissions.includes("MANAGE_DRIVERS"))) {
        setTracking(await getAdminOrderTracking(token, props.orderId).catch(() => null));
      }
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
    <AdminPage onBack={props.onBack} subtitle={order ? formatDate(order.createdAt) : undefined} title={order?.restaurant.name ?? t("orderDetail.notFoundTitle")}>
      <ErrorBanner message={error} />
      {!order ? (
        error ? null : <LoadingState />
      ) : (
        <>
          <Card>
            <View style={adminStyles.rowBetween}>
              <CardTitle>{t("orderDetail.orderNumberLabel", { id: order.id.slice(0, 8) })}</CardTitle>
              <StatusPill status={order.status} />
            </View>
            {order.items.map((item) => (
              <View key={item.id} style={{ alignItems: "center", flexDirection: "row", gap: 12 }}>
                <RemoteImage resizeMode="cover" style={{ borderRadius: 6, height: 40, width: 40 }} uri={item.imageUrl} />
                <View style={{ flex: 1 }}>
                  <KeyValue label={`${item.quantity} × ${item.nameSnapshot}`} value={formatMoney(item.lineTotalMinor)} />
                </View>
              </View>
            ))}
            <KeyValue label={t("orderDetail.subtotalLabel")} value={formatMoney(order.subtotalMinor)} />
            <KeyValue label={t("orderDetail.deliveryFeeLabel")} value={formatMoney(order.deliveryFeeMinor)} />
            <KeyValue label={t("orderDetail.totalLabel")} value={formatMoney(order.totalMinor)} />
            <KeyValue label={t("orderDetail.paymentLabel")} value={order.paymentMethod} />
            <KeyValue label={t("orderDetail.addressLabel")} value={order.deliveryAddressLine} />
            {order.customerPhone ? (
              <>
                <KeyValue label={t("common:customerLabel")} value={order.customerName ?? order.customerPhone} />
                <CallCustomerButton phone={order.customerPhone} />
              </>
            ) : null}
          </Card>

          {order.delivery || tracking?.driver ? (
            <Card>
              <View style={adminStyles.rowBetween}>
                <CardTitle>{t("orderDetail.deliveryTitle")}</CardTitle>
                {order.delivery ? <StatusPill status={order.delivery.status} /> : null}
              </View>
              {tracking?.driver ? (
                <>
                  <KeyValue label={t("orderDetail.driverLabel")} value={tracking.driver.fullName} />
                  <PhoneNumber phone={tracking.driver.phone} />
                </>
              ) : (
                <Meta>{t("orderDetail.noDriver")}</Meta>
              )}
              {order.delivery?.assignedAt ? <KeyValue label={t("orderDetail.assignedAt")} value={formatDate(order.delivery.assignedAt)} /> : null}
              {order.delivery?.pickedUpAt ? <KeyValue label={t("orderDetail.pickedUpAt")} value={formatDate(order.delivery.pickedUpAt)} /> : null}
              {order.delivery?.deliveredAt ? <KeyValue label={t("orderDetail.deliveredAt")} value={formatDate(order.delivery.deliveredAt)} /> : null}
            </Card>
          ) : null}

          <Card>
            <CardTitle>{t("orderDetail.statusHistoryTitle")}</CardTitle>
            {order.statusHistory.map((entry) => (
              <View key={entry.id}>
                <KeyValue label={formatDate(entry.createdAt)} value={t(`common:status.${entry.toStatus}`, entry.toStatus.replace(/_/g, " "))} />
                {entry.note ? <Meta>{entry.note}</Meta> : null}
              </View>
            ))}
          </Card>

          {cancellableAdminOrderStatuses.includes(order.status) ? (
            <View style={adminStyles.reasonBox}>
              <Input multiline onChangeText={setReason} placeholder={t("orderDetail.cancelReasonPlaceholder")} value={reason} />
              <ActionButton disabled={!reason.trim()} label={t("orderDetail.cancelButton")} loading={busy} onPress={() => void cancel()} variant="danger" />
            </View>
          ) : null}
        </>
      )}
    </AdminPage>
  );
}

async function requireToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error(i18n.t("common:sessionExpired"));
  return token;
}
