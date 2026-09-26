import { useTranslation } from "react-i18next";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { useLiveQueue } from "../live-queue";
import { ageLabel, countItems, escalateAfterMs, popupOrder, shortReference } from "../order-queue";
import { FallbackImage } from "./FallbackImage";
import { Money } from "./Money";

/**
 * The new-order popup: shown over whatever screen is open while an order is still NEW on the server,
 * with Accept right on it. It is deliberately not a blocking modal — someone mid-way through
 * packing another order can keep working — but it is the largest and only orange-framed thing on the
 * screen, and it stays until the order is accepted (here or on any other device) or set aside.
 */
export function NewOrderPopup() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useAuth();
  const live = useLiveQueue();
  if (!live?.queue) return null;

  const target = popupOrder(live.queue.new, live.setAside);
  if (!target) return null;
  const { order, othersWaiting } = target;
  // On that very order's page the Accept button is already the main thing on screen.
  const viewingThisOrder = matchPath("/business/orders/:orderId", location.pathname)?.params.orderId === order.id;
  if (viewingThisOrder) return null;

  const age = ageLabel(live.now - new Date(order.createdAt).getTime());
  const isLate = live.now - new Date(order.createdAt).getTime() > escalateAfterMs;
  const accepting = live.acceptingIds.has(order.id);
  const thumbnails = order.items.slice(0, 4);

  return (
    <section aria-labelledby="new-order-popup-title" aria-live="assertive" className={`new-order-popup${isLate ? " is-late" : ""}`} role="alertdialog">
      <div className="new-order-popup-head">
        <span className="new-order-popup-pulse" aria-hidden="true" />
        <h2 className="new-order-popup-title" id="new-order-popup-title">
          {t("liveOrders.popupTitle")}
        </h2>
        <span className="new-order-popup-age">{t(age.key, { minutes: age.count, count: age.count })}</span>
      </div>
      <div className="new-order-popup-body">
        <span className="new-order-popup-ref">{shortReference(order.id)}</span>
        <div className="new-order-popup-facts">
          <span>{t("liveOrders.itemCount", { count: countItems(order) })}</span>
          <strong className="new-order-popup-total">
            <Money minor={order.totalMinor} />
          </strong>
        </div>
        {thumbnails.length > 0 ? (
          <div className="new-order-popup-thumbs" aria-hidden="true">
            {thumbnails.map((item) => (
              <FallbackImage className="new-order-popup-thumb" key={item.id} loading="lazy" src={item.imageUrl ?? undefined} />
            ))}
            {order.items.length > thumbnails.length ? <span className="new-order-popup-more">+{order.items.length - thumbnails.length}</span> : null}
          </div>
        ) : null}
      </div>
      <div className="new-order-popup-actions">
        {can("MANAGE_ORDERS") ? (
          <button className="btn btn-primary btn-lg new-order-popup-accept" disabled={accepting} onClick={() => void live.accept(order)} type="button">
            {accepting ? t("common.working") : t("liveOrders.accept")}
          </button>
        ) : null}
        <button className="btn btn-outline btn-lg" onClick={() => navigate(`/business/orders/${order.id}`)} type="button">
          {t("liveOrders.openOrder")}
        </button>
        <button className="btn btn-ghost" onClick={() => live.setOrderAside(order.id)} type="button">
          {t("liveOrders.later")}
        </button>
      </div>
      {othersWaiting > 0 ? (
        <button className="new-order-popup-others" onClick={() => navigate("/business")} type="button">
          {t("liveOrders.othersWaiting", { count: othersWaiting })}
        </button>
      ) : null}
    </section>
  );
}
