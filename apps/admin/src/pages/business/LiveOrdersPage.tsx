import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../../api";
import { getLiveOrders, setBusinessOpenStatus, type BusinessOrder, type LiveOrderQueue } from "../../api.business";
import { useNewOrderAlert } from "../../alert-sound";
import { useAuth } from "../../auth";
import { StatusBadge } from "../../components/StatusBadge";
import { useLiveRefresh } from "../../socket";

const currencyCode = "ILS";
/** An order unhandled for longer than this is escalated visually and audibly. */
const escalateAfterMs = 3 * 60 * 1000;

export function LiveOrdersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { can, refreshAccess } = useAuth();
  const [queue, setQueue] = useState<LiveOrderQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  // Re-renders on a timer so elapsed-time badges stay honest between refreshes.
  const [, setTick] = useState(0);

  async function load() {
    try {
      setQueue(await getLiveOrders());
      setLastRefreshAt(new Date());
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("liveOrders.loadError"));
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => setTick((value) => value + 1), 15_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLiveRefresh(["order.created", "order.status.changed", "order.fulfillment.changed"], () => void load());

  const newOrders = queue?.new ?? [];
  const oldestNewAgeMs = newOrders.length > 0 ? Date.now() - new Date(newOrders[0].createdAt).getTime() : 0;
  // The alert is driven entirely by how many orders the server still reports as unaccepted.
  const alert = useNewOrderAlert(newOrders.length, oldestNewAgeMs > escalateAfterMs);

  async function toggleOpen() {
    if (!queue) return;
    try {
      await setBusinessOpenStatus(!queue.business.isOpen);
      await Promise.all([load(), refreshAccess()]);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("common.genericActionError"));
    }
  }

  if (error && !queue) return <div className="error-banner">{error}</div>;
  if (!queue) return <div className="loading-state">{t("common.loading")}</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("liveOrders.title")}</h1>
          <p className="page-subtitle">
            {t("liveOrders.subtitle", { name: queue.business.name })}
            {lastRefreshAt ? ` · ${t("liveOrders.updatedAt", { at: lastRefreshAt.toLocaleTimeString() })}` : ""}
          </p>
        </div>
        <div className="filters-row" style={{ margin: 0 }}>
          {alert.isArmed && !alert.isBlocked ? (
            <button className="btn btn-outline btn-sm" onClick={alert.disarm} type="button">
              {t("liveOrders.soundOn")}
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => void alert.arm()} type="button">
              {t("liveOrders.enableSound")}
            </button>
          )}
          {can("MANAGE_ORDERS") ? (
            <button className="btn btn-outline btn-sm" onClick={() => void toggleOpen()} type="button">
              {queue.business.isOpen ? t("liveOrders.closeStore") : t("liveOrders.openStore")}
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {alert.isBlocked ? <div className="error-banner">{t("liveOrders.soundBlocked")}</div> : null}
      {!alert.isArmed ? <div className="empty-state">{t("liveOrders.soundOffWarning")}</div> : null}
      {!queue.business.isOpen ? <div className="empty-state">{t("liveOrders.storeClosed")}</div> : null}

      <div className="queue-grid">
        <QueueColumn
          escalateAfterMs={escalateAfterMs}
          onOpen={(order) => navigate(`/business/orders/${order.id}`)}
          orders={queue.new}
          title={t("liveOrders.columnNew", { count: queue.new.length })}
        />
        <QueueColumn
          onOpen={(order) => navigate(`/business/orders/${order.id}`)}
          orders={queue.inProgress}
          title={t("liveOrders.columnInProgress", { count: queue.inProgress.length })}
        />
        <QueueColumn
          onOpen={(order) => navigate(`/business/orders/${order.id}`)}
          orders={queue.ready}
          title={t("liveOrders.columnReady", { count: queue.ready.length })}
        />
      </div>
    </div>
  );
}

function QueueColumn({
  title,
  orders,
  onOpen,
  escalateAfterMs: escalateMs
}: {
  title: string;
  orders: BusinessOrder[];
  onOpen: (order: BusinessOrder) => void;
  escalateAfterMs?: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="card">
      <h2 className="card-title">{title}</h2>
      {orders.length === 0 ? (
        <div className="empty-state">{t("liveOrders.columnEmpty")}</div>
      ) : (
        orders.map((order) => {
          const ageMs = Date.now() - new Date(order.createdAt).getTime();
          const isLate = escalateMs !== undefined && ageMs > escalateMs;
          const isNew = order.status === "PLACED";
          return (
            <button
              className={`order-ticket${isNew ? " is-new" : ""}${isLate ? " late" : ""}`}
              key={order.id}
              onClick={() => onOpen(order)}
              type="button"
            >
              <div className="order-ticket-head">
                <span className="order-ticket-ref">{shortReference(order.id)}</span>
                <StatusBadge status={order.status} />
              </div>
              <div className="order-ticket-body">
                <span>{t("liveOrders.itemCount", { count: countItems(order) })}</span>
                <span className="order-ticket-total">{formatPrice(order.totalMinor)}</span>
              </div>
              <div className="order-ticket-foot">
                <span className="order-ticket-age">{t("liveOrders.elapsed", { minutes: Math.floor(ageMs / 60_000) })}</span>
                {order.requiresCustomerReview ? <span>{t("liveOrders.awaitingCustomer")}</span> : null}
                {order.acceptedByFullName ? (
                  <span>{t("liveOrders.acceptedBy", { name: order.acceptedByFullName })}</span>
                ) : null}
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}

function countItems(order: BusinessOrder): number {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

/** The last block of the id: short enough to read aloud across a kitchen. */
function shortReference(orderId: string): string {
  return `#${orderId.slice(0, 8).toUpperCase()}`;
}

function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ${currencyCode}`;
}
