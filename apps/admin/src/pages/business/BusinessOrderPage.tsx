import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, readApiError } from "../../api";
import {
  getBusinessOrder,
  listBusinessItems,
  proposeFulfillment,
  updateBusinessOrderStatus,
  type BusinessOrder,
  type MenuItemOwner
} from "../../api.business";
import { useAuth } from "../../auth";
import { ConfirmModal } from "../../components/ConfirmModal";
import { FallbackImage } from "../../components/FallbackImage";
import { ReasonModal } from "../../components/ReasonModal";
import {
  clearPicked,
  isPackingStatus,
  loadPicked,
  packLineState,
  packProgress,
  savePicked,
  togglePicked,
  trimQuantity,
  type PackLineState
} from "../../packChecklist";
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
  const [showReadyAnyway, setShowReadyAnyway] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  const isSupermarket = access?.business?.businessType === "SUPERMARKET";

  async function load() {
    try {
      setOrder(await getBusinessOrder(orderId));
      setError(null);
    } catch (requestError) {
      setError(readApiError(requestError, t("businessOrder.loadError")));
    }
  }

  useEffect(() => {
    void load();
    // The replacement picker needs the catalogue; only a supermarket can substitute.
    if (isSupermarket) void listBusinessItems().then(setItems, () => setItems([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, isSupermarket]);

  useLiveRefresh(["order.status.changed", "order.fulfillment.changed"], () => void load());

  // What has been put in the bag is remembered in this browser, per order, so a refresh or a live
  // update does not lose the packer's place.
  const lineIdsKey = useMemo(() => (order?.items ?? []).map((item) => item.id).join(","), [order]);
  useEffect(() => {
    if (!lineIdsKey) return;
    setPicked(loadPicked(orderId, lineIdsKey.split(",")));
  }, [orderId, lineIdsKey]);

  function toggleLine(lineId: string) {
    if (!order) return;
    const next = togglePicked(order.items, picked, lineId);
    setPicked(next);
    savePicked(orderId, next);
  }

  async function advance(status: "ACCEPTED" | "PREPARING" | "READY_FOR_PICKUP" | "REJECTED", note?: string) {
    setIsWorking(true);
    setNotice(null);
    try {
      const updated = await updateBusinessOrderStatus(orderId, status, note);
      setOrder(updated);
      setError(null);
      // Packing is finished (or the order left the store's hands): the working state is done with.
      if (!isPackingStatus(updated.status) && updated.status !== "PLACED") clearPicked(orderId);
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
  const isPacking = isPackingStatus(order.status);
  const progress = packProgress(order.items, picked);
  // "Ready" is the one step that hands the order to a driver, so it waits until every item is
  // checked off. Nothing else about the flow is gated.
  const readyBlocked = action === "READY_FOR_PICKUP" && !progress.complete;
  const missingNames = order.items.filter((item) => progress.remainingIds.includes(item.id)).map((item) => item.nameSnapshot);

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
            {isPacking ? (
              <div className="pack-header">
                <div className="pack-header-row">
                  <h3 className="pack-title">{t("businessOrder.pack.title")}</h3>
                  <span className={`pack-progress-text${progress.complete ? " is-done" : ""}`}>
                    {progress.complete
                      ? t("businessOrder.pack.allPacked")
                      : t("businessOrder.pack.progress", { packed: progress.packed, total: progress.total })}
                  </span>
                </div>
                <div aria-hidden="true" className="pack-bar">
                  <div
                    className={`pack-bar-fill${progress.complete ? " is-done" : ""}`}
                    style={{ width: `${progress.total ? Math.round((progress.packed / progress.total) * 100) : 0}%` }}
                  />
                </div>
                {!progress.complete ? <p className="pack-hint">{t("businessOrder.pack.hint")}</p> : null}
              </div>
            ) : null}
            {order.items.map((item) => (
              <div key={item.id}>
                {isPacking || item.fulfillmentAdjustment?.status === "PENDING" ? (
                  <PackRow
                    item={item}
                    onToggle={() => toggleLine(item.id)}
                    packable={isPacking && canAct}
                    state={packLineState(item, picked)}
                  />
                ) : (
                <div className="kv-row">
                  <span className="kv-label">
                    {t("businessOrder.lineItem", { quantity: item.quantity, name: item.nameSnapshot })}
                    {item.allowSubstitution ? ` · ${t("businessOrder.substitutionAllowed")}` : ""}
                  </span>
                  <span className="kv-value">{formatPrice(item.lineTotalMinor)}</span>
                </div>
                )}
                {item.fulfillmentAdjustment && !isPacking ? (
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
                          readApiError(requestError, t("common.genericActionError"))
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
                  disabled={isWorking || order.requiresCustomerReview || readyBlocked}
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
          {canAct && readyBlocked ? (
            <div>
              <p className="pack-ready-note">
                {t("businessOrder.pack.readyBlocked")} {t("businessOrder.pack.remaining", { count: progress.remainingIds.length })}
              </p>
              <button className="pack-anyway" onClick={() => setShowReadyAnyway(true)} type="button">
                {t("businessOrder.pack.readyAnyway")}
              </button>
            </div>
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

      {showReadyAnyway ? (
        <ConfirmModal
          confirmLabel={t("businessOrder.pack.readyAnywayConfirm")}
          description={t("businessOrder.pack.readyAnywayBody", { items: missingNames.join(", ") })}
          onCancel={() => setShowReadyAnyway(false)}
          onConfirm={async () => {
            await advance("READY_FOR_PICKUP");
            setShowReadyAnyway(false);
          }}
          title={t("businessOrder.pack.readyAnywayTitle")}
          tone="primary"
        />
      ) : null}

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

/**
 * One line of the packing checklist: the whole row is the tap target, with the product photo so the
 * packer can confirm the right item by sight, and a state that is never ambiguous.
 */
function PackRow({
  item,
  state,
  packable,
  onToggle
}: {
  item: BusinessOrder["items"][number];
  state: PackLineState;
  packable: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const adjustment = item.fulfillmentAdjustment;
  const replacement = adjustment?.status === "APPROVED" && adjustment.replacementMenuItemId ? adjustment : null;
  const awaiting = state === "awaitingCustomer";
  const packed = state === "picked" || state === "pickedReplacement";
  // What the packer actually picks up: the approved replacement and/or the re-weighed quantity.
  const shownName = replacement?.replacementNameSnapshot ?? item.nameSnapshot;
  const shownImage = replacement ? replacement.replacementImageUrl : item.imageUrl;
  const quantity = adjustment?.status === "APPROVED" ? adjustment.actualQuantityMilli / 1_000 : item.quantity;
  const unit = replacement?.replacementUnitLabelSnapshot ?? item.unitLabelSnapshot;
  const quantityText = t("businessOrder.pack.packQuantity", { quantity: trimQuantity(quantity), unit });
  const stateClass =
    state === "picked" ? " is-picked" : state === "pickedReplacement" ? " is-replacement" : awaiting ? " is-awaiting" : "";
  const glyph = state === "picked" ? "\u2713" : state === "pickedReplacement" ? "\u21C4" : awaiting ? "!" : "";

  return (
    <button
      aria-checked={packed}
      aria-label={t("businessOrder.pack.itemLabel", { name: shownName, quantity: quantityText })}
      className={`pack-row${stateClass}`}
      disabled={awaiting || !packable}
      onClick={onToggle}
      role="checkbox"
      type="button"
    >
      <span aria-hidden="true" className="pack-box">{glyph}</span>
      <FallbackImage alt="" className="pack-image" src={shownImage ?? undefined} />
      <span className="pack-body">
        <span className="pack-name">{shownName}</span>
        <span className="pack-qty">{quantityText}</span>
        {replacement ? (
          <span className="pack-replaces">
            <span className="pack-tag">{t("businessOrder.pack.replacementTag")} </span>
            {t("businessOrder.pack.replaces", { name: item.nameSnapshot })}
          </span>
        ) : null}
        {adjustment?.status === "REJECTED" ? <span className="pack-muted">{t("businessOrder.pack.declined")}</span> : null}
        {awaiting ? <span className="pack-awaiting-note">{t("businessOrder.pack.awaitingCustomer")}</span> : null}
      </span>
      <span className="pack-price">{formatPrice(item.lineTotalMinor)}</span>
    </button>
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
