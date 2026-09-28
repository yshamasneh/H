import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { getCustomerDetail, readApiError, type CustomerDetail } from "../api";
import { useAuth } from "../auth";
import { Money } from "../components/Money";
import { StatusBadge } from "../components/StatusBadge";
import { countsTowardCustomerTotals } from "../users-sections";
import { PhoneNumber } from "./UsersPage";

/**
 * One customer: their registered number, how many orders were actually delivered to them, what
 * those delivered orders came to since they registered, and every order they have ever placed.
 *
 * Every amount here is the order's exact total (items at the price charged, plus delivery, minus
 * discounts). The cash a driver collects is that total rounded up to a whole shekel; it is
 * deliberately not used, so the headline always equals the sum of the delivered rows below it.
 */
export function CustomerDetailPage() {
  const { t } = useTranslation();
  const { userId = "" } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canViewOrders = can("VIEW_ALL_ORDERS");

  useEffect(() => {
    if (!canViewOrders) return;
    let cancelled = false;
    setDetail(null);
    setError(null);
    getCustomerDetail(userId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((requestError) => {
        if (!cancelled) setError(readApiError(requestError, t("customerDetail.loadError")));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, canViewOrders]);

  const back = (
    <button className="btn btn-outline btn-sm" onClick={() => navigate("/users")} type="button">
      {t("common.back")}
    </button>
  );

  if (!canViewOrders) {
    return (
      <div>
        {back}
        <div className="empty-state">{t("customerDetail.noPermission")}</div>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        {back}
        <div className="error-banner" style={{ marginTop: 10 }}>{error}</div>
      </div>
    );
  }
  if (!detail) return <div className="loading-state">{t("common.loading")}</div>;

  const { customer } = detail;

  return (
    <div>
      <div className="page-header">
        <div>
          {back}
          <h1 className="page-title" style={{ marginTop: 10 }}>
            {customer.fullName}
          </h1>
          <p className="page-subtitle">
            {t("customerDetail.registeredOn", { date: formatDate(customer.createdAt) })}
          </p>
        </div>
        <StatusBadge status={customer.isActive ? "ACTIVE" : "INACTIVE"} />
      </div>

      <div className="card">
        <div className="kv-row">
          <span className="kv-label">{t("users.registeredPhone")}</span>
          <span className="kv-value">
            <PhoneNumber phone={customer.phone} />
          </span>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">{t("customerDetail.deliveredOrders")}</div>
          <div className="stat-value num">{detail.deliveredOrdersCount}</div>
          <div className="stat-hint">{t("customerDetail.deliveredOrdersHint")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t("customerDetail.totalSpent")}</div>
          <div className="stat-value">
            <Money minor={detail.deliveredSpentMinor} />
          </div>
          <div className="stat-hint">{t("customerDetail.totalSpentHint")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t("customerDetail.allOrders")}</div>
          <div className="stat-value num">{detail.ordersCount}</div>
          <div className="stat-hint">
            {detail.firstOrderAt
              ? t("customerDetail.firstOrderOn", { date: formatDate(detail.firstOrderAt) })
              : t("customerDetail.noOrdersYet")}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">{t("customerDetail.historyTitle")}</h2>
        <p className="page-subtitle">{t("customerDetail.historyHint")}</p>
        {detail.orders.length === 0 ? (
          <div className="empty-state">{t("customerDetail.noOrdersYet")}</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("orders.date")}</th>
                  <th>{t("customerDetail.store")}</th>
                  <th>{t("customerDetail.items")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("customerDetail.orderTotal")}</th>
                  <th>{t("customerDetail.counted")}</th>
                </tr>
              </thead>
              <tbody>
                {detail.orders.map((order) => (
                  <tr className="clickable" key={order.id} onClick={() => navigate(`/orders/${order.id}`)}>
                    <td>{formatDateTime(order.createdAt)}</td>
                    <td>{order.storeName}</td>
                    <td className="num">{order.itemsCount}</td>
                    <td>
                      <StatusBadge status={order.status} />
                    </td>
                    <td>
                      <Money minor={order.totalMinor} />
                    </td>
                    <td>{countsTowardCustomerTotals(order.status) ? t("customerDetail.countedYes") : t("common.dash")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}
