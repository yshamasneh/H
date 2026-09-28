import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { getDashboard, readApiError, type DashboardOverview } from "../api";
import { getAccountingOverview, type AccountingOverview } from "../api.accounting";
import { useAuth } from "../auth";
import { Money } from "../components/Money";
import { attentionItems } from "../dashboard-attention";
import { useRealtimeEvent } from "../socket";

/**
 * The first screen of the control centre, in the order an administrator asks the questions:
 * what is waiting on me, what is happening today, how big is the platform, and what just changed.
 * Every figure links to the page where it can be acted on.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [books, setBooks] = useState<AccountingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canSeeBooks = can("VIEW_ACCOUNTING");
  const canSeeOrders = can("VIEW_ALL_ORDERS");

  async function load() {
    try {
      setData(await getDashboard());
      setError(null);
    } catch (requestError) {
      setError(readApiError(requestError, t("dashboard.loadError")));
    }
    if (canSeeBooks) {
      // The books are a second, optional source: if they fail, the rest of the dashboard still shows.
      try {
        setBooks(await getAccountingOverview());
      } catch {
        setBooks(null);
      }
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeeBooks]);

  // The dashboard never trusts socket payloads as final state - any live event just triggers a
  // fresh REST fetch, matching the "REST is the source of truth" rule from architecture.md.
  useRealtimeEvent("order.created", () => void load());
  useRealtimeEvent("order.status.changed", () => void load());
  useRealtimeEvent("restaurant.pending.created", () => void load());

  const attention = data ? attentionItems({ ...data, accounting: books }, can) : [];

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
        error ? null : <div className="loading-state">{t("common.loading")}</div>
      ) : (
        <>
          <section aria-labelledby="dashboard-attention">
            <h2 className="form-section-title" id="dashboard-attention">{t("dashboard.attention.title")}</h2>
            {attention.length === 0 ? (
              <div className="card attention-clear">{t("dashboard.attention.allClear")}</div>
            ) : (
              <div className="attention-grid">
                {attention.map((item) => (
                  <Link className={`attention-card attention-${item.tone}`} key={item.key} to={item.to}>
                    <span className="attention-value">
                      {item.isMoney ? <Money minor={item.value} signed={item.key === "ledgerImbalance"} /> : item.value}
                    </span>
                    <span className="attention-label">{t(`dashboard.attention.${item.key}`)}</span>
                    <span className="attention-action">{t(`dashboard.attention.${item.key}Action`)}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <h2 className="form-section-title">{t("dashboard.todayTitle")}</h2>
          <div className="stat-grid">
            <StatCard
              hint={t("dashboard.ordersTodayHint")}
              label={t("dashboard.ordersToday")}
              to={canSeeOrders ? "/orders" : undefined}
              value={String(data.ordersToday)}
            />
            <StatCard hint={t("dashboard.revenueTodayHint")} label={t("dashboard.revenueToday")} value={<Money minor={data.revenueTodayMinor} />} />
            <StatCard
              hint={t("dashboard.activeDeliveriesHint")}
              label={t("dashboard.activeDeliveries")}
              to={can("MANAGE_DRIVERS") ? "/drivers/live" : undefined}
              value={String(data.activeDeliveries)}
            />
            <StatCard
              hint={t("dashboard.onlineDriversHint")}
              label={t("dashboard.onlineDrivers")}
              to={can("MANAGE_DRIVERS") ? "/drivers" : undefined}
              value={String(data.onlineDriversCount)}
            />
            <StatCard
              hint={t("dashboard.newSignupsHint")}
              label={t("dashboard.newSignups")}
              to={can("MANAGE_USERS") ? "/users" : undefined}
              value={String(data.newCustomerSignupsToday)}
            />
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
                  to={can("MANAGE_BUSINESSES") ? "/restaurants" : undefined}
                  value={String(data.totals.businesses)}
                />
                <StatCard
                  hint={t("dashboard.totals.productsHint", { hidden: data.totals.hiddenProducts })}
                  label={t("dashboard.totals.products")}
                  value={String(data.totals.products)}
                />
                <StatCard
                  hint=""
                  label={t("dashboard.totals.customers")}
                  to={can("MANAGE_USERS") ? "/users" : undefined}
                  value={String(data.totals.customers)}
                />
                <StatCard
                  hint=""
                  label={t("dashboard.totals.orders")}
                  to={canSeeOrders ? "/orders" : undefined}
                  value={String(data.totals.orders)}
                />
                <StatCard
                  hint=""
                  label={t("dashboard.totals.drivers")}
                  to={can("MANAGE_DRIVERS") ? "/drivers" : undefined}
                  value={String(data.totals.approvedDrivers)}
                />
              </div>
            </>
          ) : null}

          <div className="card">
            <h2 className="card-title">{t("dashboard.recentActivity")}</h2>
            {data.activityFeed.length === 0 ? (
              <div className="empty-state">{t("dashboard.noActivity")}</div>
            ) : (
              data.activityFeed.map((entry) => {
                const line = (
                  <>
                    <span>
                      <strong>{entry.restaurantName}</strong>
                      {" - "}
                      {t("dashboard.activityLine", {
                        status: t(`status.${entry.toStatus}`, entry.toStatus.replace(/_/g, " "))
                      })}
                    </span>
                    <span className="activity-meta">{new Date(entry.createdAt).toLocaleString()}</span>
                  </>
                );
                return canSeeOrders ? (
                  <Link className="activity-item activity-link" key={entry.id} to={`/orders/${entry.orderId}`}>
                    {line}
                  </Link>
                ) : (
                  <div className="activity-item" key={entry.id}>
                    {line}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard(props: { label: string; value: ReactNode; hint: string; to?: string }) {
  const body = (
    <>
      <div className="stat-label">{props.label}</div>
      <div className="stat-value">{props.value}</div>
      <div className="stat-hint">{props.hint}</div>
    </>
  );
  return props.to ? (
    <Link className="stat-card stat-card-link" to={props.to}>
      {body}
    </Link>
  ) : (
    <div className="stat-card">{body}</div>
  );
}
