import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, fetchAllPages, listAdminRestaurants, type RestaurantProfile } from "../api";
import { listStoreItems, type MenuItemOwner } from "../api.business";
import { createOffer, listOffers, updateOffer } from "../api.offers";
import { Field } from "../components/Field";
import { Money } from "../components/Money";
import {
  buildOffer,
  emptyOfferDraft,
  offerNeedsRestaurant,
  offerToDraft,
  offerToggleBody,
  offerTypes,
  offerUsesPercent,
  type OfferDraft,
  type OfferView
} from "../offer-form";

/**
 * Platform promotions: create, edit, pause.
 *
 * The API existed with no screen at all, so the only way to run a promotion was a hand-written
 * request. Nothing here touches an offer's picture — image handling is its own piece of work — but
 * an edit hands the existing image back untouched (see `offer-form.ts`), because the update
 * endpoint replaces the whole offer and would otherwise drop it.
 */

type Status = "ACTIVE" | "PAUSED" | "SCHEDULED" | "EXPIRED";

function offerStatus(offer: OfferView, now = Date.now()): Status {
  if (!offer.isActive) return "PAUSED";
  if (new Date(offer.startsAt).getTime() > now) return "SCHEDULED";
  if (offer.endsAt && new Date(offer.endsAt).getTime() <= now) return "EXPIRED";
  return "ACTIVE";
}

const statusBadge: Record<Status, string> = {
  ACTIVE: "badge-good",
  PAUSED: "badge-neutral",
  SCHEDULED: "badge-info",
  EXPIRED: "badge-warn"
};

export function OffersPage() {
  const { t } = useTranslation();
  const [offers, setOffers] = useState<OfferView[] | null>(null);
  const [stores, setStores] = useState<RestaurantProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ offer: OfferView | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // '' = every offer, GLOBAL = offers not tied to one store, otherwise a store id.
  const [storeFilter, setStoreFilter] = useState("");

  const report = (requestError: unknown, fallback: string) =>
    setError(requestError instanceof ApiError ? requestError.message : fallback);

  const load = async () => {
    try {
      const [nextOffers, nextStores] = await Promise.all([
        listOffers(),
        fetchAllPages((page, pageSize) => listAdminRestaurants({ page, pageSize }))
      ]);
      setOffers(nextOffers);
      setStores(nextStores);
    } catch (requestError) {
      report(requestError, t("offers.loadError"));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const visibleOffers = (offers ?? []).filter((offer) =>
    storeFilter === "" ? true : storeFilter === "GLOBAL" ? offer.restaurantId === null : offer.restaurantId === storeFilter
  );

  const toggle = async (offer: OfferView) => {
    setBusyId(offer.id);
    setError(null);
    setNotice(null);
    try {
      await updateOffer(offer.id, offerToggleBody(offer, !offer.isActive));
      setNotice(t(offer.isActive ? "offers.paused" : "offers.activated"));
      await load();
    } catch (requestError) {
      report(requestError, t("common.genericActionError"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("offers.title")}</h1>
          <p className="page-subtitle">{t("offers.subtitle")}</p>
        </div>
        {editing ? null : (
          <button
            className="btn btn-primary"
            onClick={() => {
              setNotice(null);
              setEditing({ offer: null });
            }}
            type="button"
          >
            {t("offers.new")}
          </button>
        )}
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="notice-banner">{notice}</div> : null}

      {editing ? (
        <OfferForm
          offer={editing.offer}
          onCancel={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            setNotice(message);
            await load();
          }}
          stores={stores}
        />
      ) : null}

      <div className="card">
        <div className="filters-row">
          <select
            aria-label={t("offers.store")}
            className="select"
            onChange={(event) => setStoreFilter(event.target.value)}
            value={storeFilter}
          >
            <option value="">{t("offers.filterAllOffers")}</option>
            <option value="GLOBAL">{t("offers.filterGlobal")}</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </div>
        {offers === null ? (
          <div className="loading-state">{t("common.loading")}</div>
        ) : visibleOffers.length === 0 ? (
          <div className="empty-state">{t("offers.empty")}</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("offers.offerTitle")}</th>
                  <th>{t("offers.type")}</th>
                  <th>{t("offers.discount")}</th>
                  <th>{t("offers.minimum")}</th>
                  <th>{t("offers.period")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleOffers.map((offer) => {
                  const status = offerStatus(offer);
                  return (
                    <tr key={offer.id}>
                      <td>
                        {offer.title}
                        <br />
                        <small>
                          {offer.restaurantName ?? t("offers.allStores")}
                          {offer.menuItemName ? ` · ${offer.menuItemName}` : ""}
                        </small>
                      </td>
                      <td>{t(`offers.types.${offer.type}`)}</td>
                      <td>
                        {offer.type === "FREE_DELIVERY" ? (
                          t("offers.freeDeliveryValue")
                        ) : (
                          <span className="money">{offer.discountPercent}%</span>
                        )}
                        {offer.maxDiscountMinor !== null && offer.type !== "FREE_DELIVERY" ? (
                          <>
                            <br />
                            <small>
                              {t("offers.maxDiscount")}: <Money minor={offer.maxDiscountMinor} />
                            </small>
                          </>
                        ) : null}
                      </td>
                      <td>
                        <Money minor={offer.minimumSubtotalMinor} />
                      </td>
                      <td>
                        {new Date(offer.startsAt).toLocaleDateString()} –{" "}
                        {offer.endsAt ? new Date(offer.endsAt).toLocaleDateString() : t("offers.openEnded")}
                      </td>
                      <td>
                        <span className={`badge ${statusBadge[status]}`}>{t(`offers.status.${status}`)}</span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => {
                              setNotice(null);
                              setEditing({ offer });
                            }}
                            type="button"
                          >
                            {t("common.edit")}
                          </button>
                          <button
                            className={`btn btn-sm ${offer.isActive ? "btn-outline" : "btn-primary"}`}
                            disabled={busyId === offer.id}
                            onClick={() => void toggle(offer)}
                            type="button"
                          >
                            {offer.isActive ? t("offers.pause") : t("offers.activate")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function OfferForm({
  offer,
  stores,
  onCancel,
  onSaved
}: {
  offer: OfferView | null;
  stores: RestaurantProfile[];
  onCancel: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<OfferDraft>(() => (offer ? offerToDraft(offer) : emptyOfferDraft()));
  const [products, setProducts] = useState<MenuItemOwner[]>([]);
  const [error, setError] = useState<{ key: string; field?: keyof OfferDraft } | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (change: Partial<OfferDraft>) => setDraft((previous) => ({ ...previous, ...change }));
  const fieldError = (field: keyof OfferDraft) => (error?.field === field ? t(`offers.errors.${error.key}`) : null);

  useEffect(() => {
    if (draft.type !== "PRODUCT_PERCENTAGE" || !draft.restaurantId) {
      setProducts([]);
      return;
    }
    let cancelled = false;
    void listStoreItems(draft.restaurantId)
      .then((items) => !cancelled && setProducts(items))
      .catch((requestError) => !cancelled && setApiError(requestError instanceof ApiError ? requestError.message : t("offers.loadError")));
    return () => {
      cancelled = true;
    };
  }, [draft.type, draft.restaurantId]);

  const submit = async () => {
    const result = buildOffer(draft, offer ? { imageUrl: offer.imageUrl, startsAt: offer.startsAt, endsAt: offer.endsAt } : undefined);
    if (!result.ok) {
      setError({ key: result.error, field: result.field });
      return;
    }
    setError(null);
    setApiError(null);
    setBusy(true);
    try {
      if (offer) await updateOffer(offer.id, result.body);
      else await createOffer(result.body);
      await onSaved(t(offer ? "offers.updated" : "offers.created"));
    } catch (requestError) {
      setApiError(requestError instanceof ApiError ? requestError.message : t("common.genericActionError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2 className="card-title">{offer ? t("offers.edit") : t("offers.new")}</h2>
      {apiError ? <div className="error-banner">{apiError}</div> : null}
      <div className="form-grid">
        <Field label={t("offers.type")}>
          <select
            className="select"
            onChange={(event) => patch({ type: event.target.value as OfferDraft["type"], menuItemId: "" })}
            value={draft.type}
          >
            {offerTypes.map((type) => (
              <option key={type} value={type}>
                {t(`offers.types.${type}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field error={fieldError("restaurantId")} label={t("offers.store")}>
          <select
            className="select"
            onChange={(event) => patch({ restaurantId: event.target.value, menuItemId: "" })}
            value={draft.restaurantId}
          >
            <option value="">{offerNeedsRestaurant(draft.type) ? t("offers.chooseStore") : t("offers.allStores")}</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </Field>
        {draft.type === "PRODUCT_PERCENTAGE" ? (
          <Field error={fieldError("menuItemId")} label={t("offers.product")}>
            <select className="select" onChange={(event) => patch({ menuItemId: event.target.value })} value={draft.menuItemId}>
              <option value="">{t("offers.chooseProduct")}</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field className="span-all" error={fieldError("title")} label={t("offers.offerTitle")}>
          <input className="text-input" maxLength={120} onChange={(event) => patch({ title: event.target.value })} value={draft.title} />
        </Field>
        <Field className="span-all" label={t("offers.description")}>
          <input
            className="text-input"
            maxLength={500}
            onChange={(event) => patch({ description: event.target.value })}
            value={draft.description}
          />
        </Field>
        {offerUsesPercent(draft.type) ? (
          <Field error={fieldError("discountPercent")} label={t("offers.discountPercent")}>
            <input
              className="text-input"
              dir="ltr"
              inputMode="numeric"
              onChange={(event) => patch({ discountPercent: event.target.value })}
              value={draft.discountPercent}
            />
          </Field>
        ) : null}
        <Field error={fieldError("minimumSubtotal")} label={t("offers.minimumSubtotal")}>
          <input
            className="text-input"
            dir="ltr"
            inputMode="decimal"
            onChange={(event) => patch({ minimumSubtotal: event.target.value })}
            value={draft.minimumSubtotal}
          />
        </Field>
        {offerUsesPercent(draft.type) ? (
          <Field error={fieldError("maxDiscount")} hint={t("offers.maxDiscountHint")} label={t("offers.maxDiscount")}>
            <input
              className="text-input"
              dir="ltr"
              inputMode="decimal"
              onChange={(event) => patch({ maxDiscount: event.target.value })}
              value={draft.maxDiscount}
            />
          </Field>
        ) : null}
        <Field error={fieldError("startsAt")} hint={offer ? undefined : t("offers.startsAtHint")} label={t("offers.startsAt")}>
          <input
            className="text-input"
            onChange={(event) => patch({ startsAt: event.target.value })}
            type="datetime-local"
            value={draft.startsAt}
          />
        </Field>
        <Field error={fieldError("endsAt")} hint={t("offers.endsAtHint")} label={t("offers.endsAt")}>
          <input
            className="text-input"
            onChange={(event) => patch({ endsAt: event.target.value })}
            type="datetime-local"
            value={draft.endsAt}
          />
        </Field>
      </div>
      <label className="checkbox-row">
        <input checked={draft.isActive} onChange={(event) => patch({ isActive: event.target.checked })} type="checkbox" />
        {t("offers.active")}
      </label>
      <div className="row-actions" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => void submit()} type="button">
          {busy ? t("common.working") : t("offers.save")}
        </button>
        <button className="btn btn-outline" onClick={onCancel} type="button">
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
