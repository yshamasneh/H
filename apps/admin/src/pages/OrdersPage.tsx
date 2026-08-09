import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ApiError, listAdminOrders, type OrderDetail } from "../api";
import { StatusBadge } from "../components/StatusBadge";
import { useRealtimeEvent } from "../socket";

const currencyCode = "ILS";
const statusOptions = ["", "PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "DELIVERED", "REJECTED", "CANCELLED"];

export function OrdersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderDetail[] | null>(null);
  const [status, setStatus] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const page = await listAdminOrders({
        status: status || undefined,
        fromDate: fromDate ? new Date(fromDate).toISOString() : undefined,
        toDate: toDate ? new Date(toDate).toISOString() : undefined
      });
      setOrders(page.items);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("orders.loadError"));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, fromDate, toDate]);

  useRealtimeEvent("order.created", () => void load());
  useRealtimeEvent("order.status.changed", () => void load());

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("orders.title")}</h1>
          <p className="page-subtitle">{t("orders.subtitle")}</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="card">
        <div className="filters-row">
          <select className="select" onChange={(event) => setStatus(event.target.value)} value={status}>
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option ? t(`status.${option}`) : t("restaurants.allStatuses")}
              </option>
            ))}
          </select>
          <input className="text-input" onChange={(event) => setFromDate(event.target.value)} type="date" value={fromDate} />
          <input className="text-input" onChange={(event) => setToDate(event.target.value)} type="date" value={toDate} />
        </div>

        {orders === null ? (
          <div className="loading-state">{t("common.loading")}</div>
        ) : orders.length === 0 ? (
          <div className="empty-state">{t("orders.empty")}</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("orders.date")}</th>
                <th>{t("orders.restaurant")}</th>
                <th>{t("common.status")}</th>
                <th>{t("orders.total")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr className="clickable" key={order.id} onClick={() => navigate(`/orders/${order.id}`)}>
                  <td>{formatDate(order.createdAt)}</td>
                  <td>{order.restaurant.name}</td>
                  <td>
                    <StatusBadge status={order.status} />
                  </td>
                  <td>{formatPrice(order.totalMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ${currencyCode}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}
