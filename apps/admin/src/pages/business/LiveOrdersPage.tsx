import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { readApiError } from "../../api";
import { setBusinessOpenStatus, updateBusinessOrderStatus, type BusinessOrder } from "../../api.business";
import { useAuth } from "../../auth";
import { useLiveQueue } from "../../live-queue";
import { ageLabel, countItems, escalateAfterMs, queueSections, shortReference, type QueueSectionStatus } from "../../order-queue";
import { isPackingStatus, packProgress } from "../../packChecklist";
import { Money } from "../../components/Money";
import { SoundToggle } from "../../components/SoundToggle";

/**
 * The live board: one section per store status (New, Accepted, Preparing, Ready for pickup), each
 * with its count in a jump bar at the top, so "how many are waiting at each stage" is answered at a
 * glance and any stage is one tap away. New orders are the only orange section and carry Accept on
 * the ticket itself; Accepted tickets carry Start preparing. Marking ready stays on the order page,
 * where the packing checklist is.
 *
 * The queue itself lives in LiveQueueProvider (shared with the popup and sound on every page).
 */
export function LiveOrdersPage() {
  const { t } = useTranslation();
  const { can, refreshAccess } = useAuth();
  const live = useLiveQueue();
  const [error, setError] = useState<string | null>(null);

  if (!live) return <div className="empty-state">{t("liveOrders.noAccess")}</div>;
  const { queue } = live;
  if (live.error && !queue) return <div className="error-banner">{live.error}</div>;
  if (!queue) return <div className="loading-state">{t("common.loading")}</div>;

  const sections = queueSections(queue);

  async function toggleOpen() {
    if (!queue) return;
    try {
      await setBusinessOpenStatus(!queue.business.isOpen);
      await Promise.all([live!.reload(), refreshAccess()]);
    } catch (requestError) {
      setError(readApiError(requestError, t("common.genericActionError")));
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("liveOrders.title")}</h1>
          <p className="page-subtitle">
            {t("liveOrders.subtitle", { name: queue.business.name })}
            {live.lastRefreshAt ? ` · ${t("liveOrders.updatedAt", { at: live.lastRefreshAt.toLocaleTimeString() })}` : ""}
          </p>
        </div>
        <div className="filters-row" style={{ margin: 0 }}>
          <SoundToggle variant="topbar" />
          {can("MANAGE_ORDERS") ? (
            <button className="btn btn-outline" onClick={() => void toggleOpen()} type="button">
              {queue.business.isOpen ? t("liveOrders.closeStore") : t("liveOrders.openStore")}
            </button>
          ) : null}
        </div>
      </div>

      {error || live.error ? <div className="error-banner">{error ?? live.error}</div> : null}
      {!live.alert.isArmed ? <div className="warning-banner">{t("liveOrders.soundOffWarning")}</div> : null}
      {live.alert.isArmed && live.alert.isBlocked ? <div className="error-banner">{t("liveOrders.soundBlocked")}</div> : null}
      {!queue.business.isOpen ? <div className="warning-banner">{t("liveOrders.storeClosed")}</div> : null}

      <nav aria-label={t("liveOrders.sectionsLabel")} className="queue-jump">
        {sections.map((section) => (
          <a
            className={`queue-jump-link status-${section.status}${section.orders.length > 0 ? " has-orders" : ""}`}
            href={`#queue-${section.status}`}
            key={section.status}
            onClick={(event) => {
              event.preventDefault();
              document.getElementById(`queue-${section.status}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            <span className="queue-jump-count num">{section.orders.length}</span>
            <span className="queue-jump-label">{t(`liveOrders.section.${section.status}`)}</span>
          </a>
        ))}
      </nav>

      <div className="queue-board">
        {sections.map((section) => (
          <QueueSectionView key={section.status} orders={section.orders} status={section.status} />
        ))}
      </div>
    </div>
  );
}

function QueueSectionView({ status, orders }: { status: QueueSectionStatus; orders: BusinessOrder[] }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby={`queue-${status}-title`} className={`queue-section status-${status}`} id={`queue-${status}`}>
      <h2 className="queue-section-title" id={`queue-${status}-title`}>
        <span>{t(`liveOrders.section.${status}`)}</span>
        <span className="queue-section-count num">{orders.length}</span>
      </h2>
      {orders.length === 0 ? (
        <div className="queue-section-empty">{t("liveOrders.columnEmpty")}</div>
      ) : (
        orders.map((order) => <OrderTicket key={order.id} order={order} />)
      )}
    </section>
  );
}

function OrderTicket({ order }: { order: BusinessOrder }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { can } = useAuth();
  const live = useLiveQueue()!;
  const [starting, setStarting] = useState(false);

  const ageMs = live.now - new Date(order.createdAt).getTime();
  const isNew = order.status === "PLACED";
  const isLate = isNew && ageMs > escalateAfterMs;
  const age = ageLabel(ageMs);
  const canAct = can("MANAGE_ORDERS");
  const accepting = live.acceptingIds.has(order.id);

  async function startPreparing() {
    setStarting(true);
    try {
      await updateBusinessOrderStatus(order.id, "PREPARING");
      live.showFeedback("success", t("liveOrders.preparingToast", { ref: shortReference(order.id) }));
    } catch (requestError) {
      live.showFeedback("error", readApiError(requestError, t("common.genericActionError")));
    } finally {
      setStarting(false);
      void live.reload();
    }
  }

  return (
    <article className={`order-ticket${isNew ? " is-new" : ""}${isLate ? " late" : ""}`}>
      <button className="order-ticket-open" onClick={() => navigate(`/business/orders/${order.id}`)} type="button">
        <div className="order-ticket-head">
          <span className="order-ticket-ref">{shortReference(order.id)}</span>
          <span className="order-ticket-age">{t(age.key, { minutes: age.count, count: age.count })}</span>
        </div>
        <div className="order-ticket-body">
          <span>{t("liveOrders.itemCount", { count: countItems(order) })}</span>
          <span className="order-ticket-total">
            <Money minor={order.totalMinor} />
          </span>
        </div>
        <div className="order-ticket-foot">
          {order.requiresCustomerReview ? <span className="badge badge-warn">{t("liveOrders.awaitingCustomer")}</span> : null}
          <PackedBadge order={order} />
          {order.acceptedByFullName ? <span>{t("liveOrders.acceptedBy", { name: order.acceptedByFullName })}</span> : null}
        </div>
      </button>
      {canAct && isNew ? (
        <button className="btn btn-primary btn-lg order-ticket-action" disabled={accepting} onClick={() => void live.accept(order)} type="button">
          {accepting ? t("common.working") : t("liveOrders.accept")}
        </button>
      ) : null}
      {canAct && order.status === "ACCEPTED" ? (
        <button className="btn btn-outline btn-lg order-ticket-action" disabled={starting} onClick={() => void startPreparing()} type="button">
          {starting ? t("common.working") : t("liveOrders.startPreparing")}
        </button>
      ) : null}
    </article>
  );
}

/** "Packed 2/5" on a ticket whose order is being packed, so the board shows who is nearly done. */
function PackedBadge({ order }: { order: BusinessOrder }) {
  const { t } = useTranslation();
  if (!isPackingStatus(order.status)) return null;
  const progress = packProgress(order.items);
  return (
    <span className={`order-ticket-packed${progress.complete ? " is-done" : ""}`}>
      {t("liveOrders.packed", { packed: progress.packed, total: progress.total })}
    </span>
  );
}
