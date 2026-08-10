import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, cancelAdminOrder, getAdminOrder, type OrderDetail } from "../api";
import { ReasonModal } from "../components/ReasonModal";
import { StatusBadge } from "../components/StatusBadge";
import { useRealtimeEvent } from "../socket";

const currencyCode = "ILS";
const cancellableStatuses = ["PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP"];

export function OrderDetailPage() {
  const { t } = useTranslation();
  const { orderId = "" } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);

  async function load() {
    try {
      setOrder(await getAdminOrder(orderId));
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("orderDetail.loadError"));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  useRealtimeEvent("order.status.changed", (payload: any) => {
    if (payload?.orderId === orderId) void load();
  });

  if (error) return <div className="error-banner">{error}</div>;
  if (!order) return <div className="loading-state">{t("common.loading")}</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <button className="btn btn-outline btn-sm" onClick={() => navigate("/orders")} type="button">
            {t("common.back")}
          </button>
          <h1 className="page-title" style={{ marginTop: 10 }}>
            {order.restaurant.name}
          </h1>
          <p className="page-subtitle">{formatDate(order.createdAt)}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <div className="detail-grid">
        <div>
          <div className="card">
            <h2 className="card-title">{t("orderDetail.items")}</h2>
            {order.items.map((item) => (
              <div className="kv-row" key={item.id}>
                <span className="kv-label">
                  {t("orderDetail.lineItem", { quantity: item.quantity, name: item.nameSnapshot })}
                </span>
                <span className="kv-value">{formatPrice(item.lineTotalMinor)}</span>
              </div>
            ))}
            <div className="kv-row">
              <span className="kv-label">{t("orderDetail.subtotal")}</span>
              <span className="kv-value">{formatPrice(order.subtotalMinor)}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">{t("orderDetail.deliveryFee")}</span>
              <span className="kv-value">{formatPrice(order.deliveryFeeMinor)}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">{t("orderDetail.serviceFee")}</span>
              <span className="kv-value">{formatPrice(order.serviceFeeMinor)}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">{t("orderDetail.total")}</span>
              <span className="kv-value">{formatPrice(order.totalMinor)}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">{t("orderDetail.deliveryAddress")}</span>
              <span className="kv-value">
                {t("orderDetail.deliveryAddressLine", { label: order.deliveryLabel, address: order.deliveryAddressLine })}
              </span>
            </div>
            <div className="kv-row">
              <span className="kv-label">{t("orderDetail.acceptedBy")}</span>
              <span className="kv-value">
                {order.acceptedAt
                  ? t("orderDetail.acceptedByValue", {
                      name: order.acceptedByFullName ?? t("common.unknown"),
                      at: formatDate(order.acceptedAt)
                    })
                  : t("orderDetail.notAcceptedYet")}
              </span>
            </div>
          </div>

          {order.delivery ? (
            <div className="card">
              <h2 className="card-title">{t("orderDetail.delivery")}</h2>
              <div className="kv-row">
                <span className="kv-label">{t("common.status")}</span>
                <StatusBadge status={order.delivery.status} />
              </div>
              {order.delivery.assignedAt ? (
                <div className="kv-row">
                  <span className="kv-label">{t("orderDetail.assigned")}</span>
                  <span className="kv-value">{formatDate(order.delivery.assignedAt)}</span>
                </div>
              ) : null}
              {order.delivery.pickedUpAt ? (
                <div className="kv-row">
                  <span className="kv-label">{t("orderDetail.pickedUp")}</span>
                  <span className="kv-value">{formatDate(order.delivery.pickedUpAt)}</span>
                </div>
              ) : null}
              {order.delivery.deliveredAt ? (
                <div className="kv-row">
                  <span className="kv-label">{t("orderDetail.delivered")}</span>
                  <span className="kv-value">{formatDate(order.delivery.deliveredAt)}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {cancellableStatuses.includes(order.status) ? (
            <button className="btn btn-danger" onClick={() => setShowCancelModal(true)} type="button">
              {t("orderDetail.cancelThisOrder")}
            </button>
          ) : null}
        </div>

        <div className="card">
          <h2 className="card-title">{t("orderDetail.statusHistory")}</h2>
          {order.statusHistory.map((entry) => (
            <div className="timeline-item" key={entry.id}>
              <div className="timeline-status">{t(`status.${entry.toStatus}`, entry.toStatus.replace(/_/g, " "))}</div>
              <div className="timeline-date">{formatDate(entry.createdAt)}</div>
              {entry.note ? <div style={{ fontSize: 12.5, color: "var(--ink-500)", marginTop: 2 }}>{entry.note}</div> : null}
            </div>
          ))}
        </div>
      </div>

      {showCancelModal ? (
        <ReasonModal
          confirmLabel={t("orderDetail.cancelTitle")}
          description={t("orderDetail.cancelDescription")}
          onCancel={() => setShowCancelModal(false)}
          onConfirm={async (reason) => {
            await cancelAdminOrder(order.id, reason);
            setShowCancelModal(false);
            await load();
          }}
          title={t("orderDetail.cancelTitle")}
        />
      ) : null}
    </div>
  );
}

function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ${currencyCode}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}
