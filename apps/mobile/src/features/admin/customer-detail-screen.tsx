import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { fetchAdminAccess, getAdminCustomerDetail, type AdminCustomerDetail } from "../../core/api";
import { getAccessToken } from "../../core/session";
import i18n from "../../i18n";
import {
  AdminPage,
  Card,
  CardTitle,
  EmptyState,
  ErrorBanner,
  KeyValue,
  LoadingState,
  Meta,
  PhoneNumber,
  StatCard,
  StatusPill,
  useAdminStyles,
  formatDate,
  readAdminError
} from "./ui";
import { countsTowardCustomerTotals, formatMinorExact, hasAdminPermission } from "./users.rules";

/**
 * One customer, at parity with the admin web console: registered number, how many orders were
 * actually delivered, what those delivered orders came to since registration, and every order
 * ever placed, newest first.
 *
 * Every amount is the order's exact total (items at the price charged, plus delivery, minus
 * discounts) — the same definition the API sums. The cash a driver collects is that total rounded
 * up to a whole shekel; it is deliberately not used, so the headline equals the delivered rows.
 */
export function AdminCustomerDetailScreen(props: {
  userId: string;
  onBack: () => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const adminStyles = useAdminStyles();
  const { t } = useTranslation(["admin", "common"]);
  const [detail, setDetail] = useState<AdminCustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permitted, setPermitted] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    (async () => {
      const token = await getAccessToken();
      if (!token) throw new Error(i18n.t("common:sessionExpired"));
      const access = await fetchAdminAccess(token);
      const allowed = hasAdminPermission(access, "VIEW_ALL_ORDERS");
      if (cancelled) return;
      setPermitted(allowed);
      if (!allowed) return;
      const result = await getAdminCustomerDetail(token, props.userId);
      if (!cancelled) setDetail(result);
    })().catch((requestError) => {
      if (!cancelled) setError(readAdminError(requestError));
    });
    return () => {
      cancelled = true;
    };
  }, [props.userId]);

  const title = detail?.customer.fullName ?? t("customerDetail.title");

  if (permitted === false) {
    return (
      <AdminPage onBack={props.onBack} title={title}>
        <EmptyState message={t("customerDetail.noPermission")} />
      </AdminPage>
    );
  }
  if (error) {
    return (
      <AdminPage onBack={props.onBack} title={title}>
        <ErrorBanner message={error} />
      </AdminPage>
    );
  }
  if (!detail) {
    return (
      <AdminPage onBack={props.onBack} title={title}>
        <LoadingState />
      </AdminPage>
    );
  }

  const { customer } = detail;

  return (
    <AdminPage
      onBack={props.onBack}
      subtitle={t("customerDetail.registeredOn", { date: formatDate(customer.createdAt) })}
      title={customer.fullName}
    >
      <Card>
        <View style={adminStyles.rowBetween}>
          <Meta>{t("users.registeredPhone")}</Meta>
          <StatusPill status={customer.isActive ? "ACTIVE" : "INACTIVE"} />
        </View>
        <PhoneNumber phone={customer.phone} />
      </Card>

      <View style={adminStyles.grid}>
        <StatCard
          hint={t("customerDetail.deliveredOrdersHint")}
          label={t("customerDetail.deliveredOrders")}
          value={String(detail.deliveredOrdersCount)}
        />
        <StatCard
          hint={t("customerDetail.totalSpentHint")}
          label={t("customerDetail.totalSpent")}
          value={formatMinorExact(detail.deliveredSpentMinor)}
        />
        <StatCard
          hint={
            detail.firstOrderAt
              ? t("customerDetail.firstOrderOn", { date: formatDate(detail.firstOrderAt) })
              : t("customerDetail.noOrdersYet")
          }
          label={t("customerDetail.allOrders")}
          value={String(detail.ordersCount)}
        />
      </View>

      <CardTitle>{t("customerDetail.historyTitle")}</CardTitle>
      <Meta>{t("customerDetail.historyHint")}</Meta>
      {detail.orders.length === 0 ? (
        <EmptyState message={t("customerDetail.noOrdersYet")} />
      ) : (
        detail.orders.map((order) => (
          <Card key={order.id} onPress={() => props.onOpenOrder(order.id)}>
            <View style={adminStyles.rowBetween}>
              <View style={{ flex: 1 }}>
                <CardTitle>{order.storeName}</CardTitle>
                <Meta>{formatDate(order.createdAt)}</Meta>
              </View>
              <StatusPill status={order.status} />
            </View>
            <KeyValue label={t("customerDetail.items")} value={String(order.itemsCount)} />
            <KeyValue label={t("customerDetail.orderTotal")} value={formatMinorExact(order.totalMinor)} />
            <KeyValue
              label={t("customerDetail.counted")}
              value={countsTowardCustomerTotals(order.status) ? t("customerDetail.countedYes") : t("customerDetail.countedNo")}
            />
          </Card>
        ))
      )}
    </AdminPage>
  );
}
