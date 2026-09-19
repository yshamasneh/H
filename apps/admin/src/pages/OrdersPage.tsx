import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ApiError, listAdminOrders, type OrderDetail } from "../api";
import { Pager } from "../components/Pager";
import { StatusBadge } from "../components/StatusBadge";
import { useRealtimeEvent } from "../socket";

const currencyCode = "ILS";
const statusOptions = [
  "",
  "PLACED",
  "ACCEPTED",
  "PREPARING",
  "READY_FOR_PICKUP",
  "DELIVERED",
  "DELIVERY_FAILED",
  "REJECTED",
  "CANCELLED"
];

const listPageSize = 20;

export function OrdersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderDetail[] | null>(null);
  const [status, setStatus] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  async function load() {
    try {
      const result = await listAdminOrders({
        page,
        pageSize: listPageSize,
        status: status || undefined,
        fromDate: fromDate ? new Date(fromDate).toISOString() : undefined,
        toDate: toDate ? new Date(toDate).toISOString() : undefined
      });
      setOrders(result.items);
      setTotal(result.total);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("orders.loadError"));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, fromDate, toDate, page]);

  // A new filter starts again from the first page.
  useEffect(() => {
    setPage(1);
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
                <th>{t("orders.acceptedBy")}</th>
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
                  <td>{order.acceptedByFullName ?? (order.acceptedAt ? t("common.unknown") : t("common.dash"))}</td>
                  <td>{formatPrice(order.totalMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pager onPage={setPage} page={page} pageSize={listPageSize} total={total} />
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
