import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, getDashboard, type DashboardOverview } from "../api";
import { useRealtimeEvent } from "../socket";

const currencyCode = "ILS";

export function DashboardPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setData(await getDashboard());
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("dashboard.loadError"));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // The dashboard never trusts socket payloads as final state - any live event just triggers a
  // fresh REST fetch, matching the "REST is the source of truth" rule from architecture.md.
  useRealtimeEvent("order.created", () => void load());
  useRealtimeEvent("order.status.changed", () => void load());
  useRealtimeEvent("restaurant.pending.created", () => void load());

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("dashboard.title")}</h1>
          <p className="page-subtitle">{t("dashboard.subtitle")}</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {data === null ? (
        <div className="loading-state">{t("common.loading")}</div>
      ) : (
        <>
          <div className="stat-grid">
            <StatCard hint={t("dashboard.ordersTodayHint")} label={t("dashboard.ordersToday")} value={String(data.ordersToday)} />
            <StatCard
              hint={t("dashboard.revenueTodayHint")}
              label={t("dashboard.revenueToday")}
              value={formatPrice(data.revenueTodayMinor)}
            />
            <StatCard hint={t("dashboard.activeDeliveriesHint")} label={t("dashboard.activeDeliveries")} value={String(data.activeDeliveries)} />
            <StatCard hint={t("dashboard.pendingRestaurantsHint")} label={t("dashboard.pendingRestaurants")} value={String(data.pendingRestaurantApprovals)} />
            <StatCard hint={t("dashboard.onlineDriversHint")} label={t("dashboard.onlineDrivers")} value={String(data.onlineDriversCount)} />
            <StatCard hint={t("dashboard.newSignupsHint")} label={t("dashboard.newSignups")} value={String(data.newCustomerSignupsToday)} />
          </div>

          {data.totals ? (
            <>
              <h2 className="form-section-title">{t("dashboard.totalsTitle")}</h2>
              <div className="stat-grid">
                <StatCard
                  hint={t("dashboard.totals.businessesHint", {
                    approved: data.totals.approvedBusinesses,
                    suspended: data.totals.suspendedBusinesses
                  })}
                  label={t("dashboard.totals.businesses")}
                  value={String(data.totals.businesses)}
                />
                <StatCard
                  hint={t("dashboard.totals.productsHint", { hidden: data.totals.hiddenProducts })}
                  label={t("dashboard.totals.products")}
                  value={String(data.totals.products)}
                />
                <StatCard hint="" label={t("dashboard.totals.customers")} value={String(data.totals.customers)} />
                <StatCard hint="" label={t("dashboard.totals.orders")} value={String(data.totals.orders)} />
                <StatCard hint="" label={t("dashboard.totals.drivers")} value={String(data.totals.approvedDrivers)} />
              </div>
            </>
          ) : null}

          <div className="card">
            <h2 className="card-title">{t("dashboard.recentActivity")}</h2>
            {data.activityFeed.length === 0 ? (
              <div className="empty-state">{t("dashboard.noActivity")}</div>
            ) : (
              data.activityFeed.map((entry) => (
                <div className="activity-item" key={entry.id}>
                  <span>
                    <strong>{entry.restaurantName}</strong>
                    {" - "}
                    {t("dashboard.activityLine", {
                      status: t(`status.${entry.toStatus}`, entry.toStatus.replace(/_/g, " "))
                    })}
                  </span>
                  <span className="activity-meta">{formatDate(entry.createdAt)}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard(props: { label: string; value: string; hint: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{props.label}</div>
      <div className="stat-value">{props.value}</div>
      <div className="stat-hint">{props.hint}</div>
    </div>
  );
}

function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ${currencyCode}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString();
}
