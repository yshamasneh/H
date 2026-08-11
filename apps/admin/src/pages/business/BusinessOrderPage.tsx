import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../api";
import {
  getBusinessOrder,
  listBusinessItems,
  proposeFulfillment,
  updateBusinessOrderStatus,
  type BusinessOrder,
  type MenuItemOwner
} from "../../api.business";
import { useAuth } from "../../auth";
import { ReasonModal } from "../../components/ReasonModal";
import { StatusBadge } from "../../components/StatusBadge";
import { useLiveRefresh } from "../../socket";

const currencyCode = "ILS";

/** The single action that moves this order forward, given where it currently is. */
const nextAction: Partial<Record<string, "ACCEPTED" | "PREPARING" | "READY_FOR_PICKUP">> = {
  PLACED: "ACCEPTED",
  ACCEPTED: "PREPARING",
  PREPARING: "READY_FOR_PICKUP"
};

export function BusinessOrderPage() {
  const { t } = useTranslation();
  const { orderId = "" } = useParams();
  const navigate = useNavigate();
  const { can, access } = useAuth();
  const [order, setOrder] = useState<BusinessOrder | null>(null);
  const [items, setItems] = useState<MenuItemOwner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [showReject, setShowReject] = useState(false);

  const isSupermarket = access?.business?.businessType === "SUPERMARKET";

  async function load() {
    try {
      setOrder(await getBusinessOrder(orderId));
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("businessOrder.loadError"));
    }
  }

  useEffect(() => {
    void load();
    // The replacement picker needs the catalogue; only a supermarket can substitute.
    if (isSupermarket) void listBusinessItems().then(setItems, () => setItems([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, isSupermarket]);

  useLiveRefresh(["order.status.changed", "order.fulfillment.changed"], () => void load());

  async function advance(status: "ACCEPTED" | "PREPARING" | "READY_FOR_PICKUP" | "REJECTED", note?: string) {
    setIsWorking(true);
    setNotice(null);
    try {
      setOrder(await updateBusinessOrderStatus(orderId, status, note));
      setError(null);
    } catch (requestError) {
      const apiError = requestError instanceof ApiError ? requestError : null;
      // Losing an acceptance race is normal, not a fault: re-fetch and say who won.
      if (apiError?.code === "ORDER_INVALID_TRANSITION") {
        await load();
        setNotice(t("businessOrder.alreadyHandled"));
      } else {
        setError(apiError?.message ?? t("common.genericActionError"));
      }
    } finally {
      setIsWorking(false);
    }
  }

  if (error && !order) return <div className="error-banner">{error}</div>;
  if (!order) return <div className="loading-state">{t("common.loading")}</div>;

  const action = nextAction[order.status];
  const canAct = can("MANAGE_ORDERS");

  return (
    <div>
      <div className="page-header">
        <div>
          <button className="btn btn-outline btn-sm" onClick={() => navigate("/business")} type="button">
            {t("common.back")}
          </button>
          <h1 className="page-title" style={{ marginTop: 10 }}>
            {t("businessOrder.title", { reference: order.id.slice(0, 8).toUpperCase() })}
          </h1>
          <p className="page-subtitle">{formatDate(order.createdAt)}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="empty-state">{notice}</div> : null}

      <div className="detail-grid">
        <div>
          <div className="card">
            <h2 className="card-title">{t("businessOrder.items")}</h2>
            {order.items.map((item) => (
              <div key={item.id}>
                <div className="kv-row">
                  <span className="kv-label">
                    {t("businessOrder.lineItem", { quantity: item.quantity, name: item.nameSnapshot })}
                    {item.allowSubstitution ? ` · ${t("businessOrder.substitutionAllowed")}` : ""}
                  </span>
                  <span className="kv-value">{formatPrice(item.lineTotalMinor)}</span>
                </div>
                {item.fulfillmentAdjustment ? (
                  <div className="kv-row">
                    <span className="kv-label" style={{ paddingInlineStart: 14 }}>
                      {t("businessOrder.adjustmentSummary", {
                        name: item.fulfillmentAdjustment.replacementNameSnapshot ?? item.nameSnapshot,
                        status: t(`fulfillment.${item.fulfillmentAdjustment.status}`)
                      })}
                    </span>
                    <span className="kv-value">{formatPrice(item.fulfillmentAdjustment.lineTotalMinor)}</span>
                  </div>
                ) : null}
                {isSupermarket && canAct && order.status === "PLACED" ? (
                  <SubstitutionRow
                    availableItems={items.filter((candidate) => candidate.id !== item.menuItemId)}
                    item={item}
                    onSubmit={async (body) => {
                      try {
                        setOrder(await proposeFulfillment(orderId, item.id, body));
                        setError(null);
                      } catch (requestError) {
                        setError(
                          requestError instanceof ApiError ? requestError.message : t("common.genericActionError")
                        );
                      }
                    }}
                  />
                ) : null}
              </div>
            ))}
            <div className="kv-row">
              <span className="kv-label">{t("businessOrder.subtotal")}</span>
              <span className="kv-value">{formatPrice(order.subtotalMinor)}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">{t("businessOrder.deliveryFee")}</span>
              <span className="kv-value">{formatPrice(order.deliveryFeeMinor)}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">{t("businessOrder.total")}</span>
              <span className="kv-value">{formatPrice(order.totalMinor)}</span>
            </div>
          </div>

          <div className="card">
            <h2 className="card-title">{t("businessOrder.customer")}</h2>
            <div className="kv-row">
              <span className="kv-label">{t("businessOrder.deliveryAddress")}</span>
              <span className="kv-value">
                {order.deliveryLabel} — {order.deliveryAddressLine}
              </span>
            </div>
            {order.customerNote ? (
              <div className="kv-row">
                <span className="kv-label">{t("businessOrder.customerNote")}</span>
                <span className="kv-value">{order.customerNote}</span>
              </div>
            ) : null}
            <div className="kv-row">
              <span className="kv-label">{t("businessOrder.acceptedBy")}</span>
              <span className="kv-value">
                {order.acceptedAt
                  ? `${order.acceptedByFullName ?? t("common.unknown")} — ${formatDate(order.acceptedAt)}`
                  : t("businessOrder.notAcceptedYet")}
              </span>
            </div>
          </div>

          {canAct ? (
            <div className="filters-row">
              {action ? (
                <button
                  className="btn btn-primary"
                  disabled={isWorking || order.requiresCustomerReview}
                  onClick={() => void advance(action)}
                  type="button"
                >
                  {t(`businessOrder.action.${action}`)}
                </button>
              ) : null}
              {order.status === "PLACED" ? (
                <button className="btn btn-danger" disabled={isWorking} onClick={() => setShowReject(true)} type="button">
                  {t("businessOrder.action.REJECTED")}
                </button>
              ) : null}
            </div>
          ) : null}
          {order.requiresCustomerReview ? (
            <div className="empty-state">{t("businessOrder.blockedByReview")}</div>
          ) : null}
        </div>

        <div className="card">
          <h2 className="card-title">{t("businessOrder.statusHistory")}</h2>
          {order.statusHistory.map((entry) => (
            <div className="timeline-item" key={entry.id}>
              <div className="timeline-status">{t(`status.${entry.toStatus}`, entry.toStatus.replace(/_/g, " "))}</div>
              <div className="timeline-date">{formatDate(entry.createdAt)}</div>
              {entry.note ? (
                <div className="timeline-note">{entry.note}</div>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {showReject ? (
        <ReasonModal
          confirmLabel={t("businessOrder.action.REJECTED")}
          description={t("businessOrder.rejectDescription")}
          onCancel={() => setShowReject(false)}
          onConfirm={async (reason) => {
            await advance("REJECTED", reason);
            setShowReject(false);
          }}
          title={t("businessOrder.action.REJECTED")}
        />
      ) : null}
    </div>
  );
}

/** Propose a replacement product or an adjusted packed weight for one order line. */
function SubstitutionRow({
  item,
  availableItems,
  onSubmit
}: {
  item: BusinessOrder["items"][number];
  availableItems: MenuItemOwner[];
  onSubmit: (body: { replacementMenuItemId?: string; actualQuantityMilli?: number; note?: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [replacementId, setReplacementId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");

  const canSubstitute = item.allowSubstitution;
  const canReweigh = item.isVariableWeightSnapshot;
  if (!canSubstitute && !canReweigh) return null;

  return (
    <div className="filters-row" style={{ paddingInlineStart: 14 }}>
      {canSubstitute ? (
        <select className="select" onChange={(event) => setReplacementId(event.target.value)} value={replacementId}>
          <option value="">{t("businessOrder.noReplacement")}</option>
          {availableItems.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      ) : null}
      {canReweigh ? (
        <input
          className="text-input"
          onChange={(event) => setQuantity(event.target.value)}
          placeholder={t("businessOrder.packedQuantity")}
          type="number"
          value={quantity}
        />
      ) : null}
      <input
        className="text-input"
        onChange={(event) => setNote(event.target.value)}
        placeholder={t("businessOrder.adjustmentNote")}
        value={note}
      />
      <button
        className="btn btn-outline btn-sm"
        onClick={() =>
          void onSubmit({
            replacementMenuItemId: replacementId || undefined,
            actualQuantityMilli: quantity ? Number(quantity) : undefined,
            note: note || undefined
          })
        }
        type="button"
      >
        {t("businessOrder.proposeAdjustment")}
      </button>
    </div>
  );
}

function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ${currencyCode}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}
