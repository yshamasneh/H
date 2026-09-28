import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { readApiError } from "../api";
import type { MenuCategoryOwner, MenuItemOwner } from "../api.business";
import { formatMinor, toMoneyInput } from "../money";
import {
  isOnOffer,
  offerAttention,
  offerPercent,
  offerPriceForPercent,
  offerSavingMinor,
  offerSummary,
  parseOfferPrice,
  selectOfferRows,
  type OfferFilter
} from "../offers-view";
import { isBelowCost } from "../sale";
import { ConfirmModal } from "./ConfirmModal";
import { FallbackImage } from "./FallbackImage";
import { Money } from "./Money";
import { Pager } from "./Pager";

/** The catalogue calls the offers screen needs — the same adapters the catalogue editor uses. */
export type OffersApi = {
  listCategories: () => Promise<MenuCategoryOwner[]>;
  listItems: () => Promise<MenuItemOwner[]>;
  updateItem: (itemId: string, body: Record<string, unknown>) => Promise<MenuItemOwner>;
};

const pageSize = 40;
const quickPercents = [10, 20, 25, 30, 50];
const filters: OfferFilter[] = ["all", "onSale", "notOnSale", "attention"];

/**
 * Product offers, in one place: find a product by picture, name, SKU, barcode, brand or category,
 * see what it costs and what it is offered at, and start, change or end the offer in the row.
 *
 * An offer is the product's existing sale price — the value the customer app's sale sticker, price
 * display and checkout already read — so there is no second pricing system: the manager types the
 * offer price and the percentage shown here, and on the customer's sticker, is worked out from it.
 * Writes go through the same product-update call as the catalogue editor, so the API's permission
 * checks (MANAGE_PRICES for a store; MANAGE_BUSINESSES for an administrator) still decide.
 */
export function SaleOffersManager(props: { api: OffersApi; canEdit: boolean; storeKey: string }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<MenuItemOwner[] | null>(null);
  const [categories, setCategories] = useState<MenuCategoryOwner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [filter, setFilter] = useState<OfferFilter>("all");
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ending, setEnding] = useState<MenuItemOwner | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    Promise.all([props.api.listItems(), props.api.listCategories()])
      .then(([nextItems, nextCategories]) => {
        if (cancelled) return;
        setItems(nextItems);
        setCategories(nextCategories);
      })
      .catch((requestError) => !cancelled && setError(readApiError(requestError, t("saleOffers.loadError"))));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.storeKey, reload]);

  useEffect(() => setPage(1), [search, categoryId, filter, props.storeKey]);

  const categoryNames = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
  const rows = useMemo(
    () => (items ? selectOfferRows(items, { search, categoryId, filter, categoryNames }) : []),
    [items, search, categoryId, filter, categoryNames]
  );
  const summary = useMemo(() => offerSummary(items ?? []), [items]);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);

  function replaceItem(updated: MenuItemOwner) {
    setItems((current) => current?.map((item) => (item.id === updated.id ? updated : item)) ?? current);
  }

  async function saveOffer(item: MenuItemOwner, saleMinor: number | null) {
    const updated = await props.api.updateItem(item.id, { salePriceMinor: saleMinor });
    replaceItem(updated);
    setEditingId(null);
    setNotice(
      saleMinor === null
        ? t("saleOffers.endedNotice", { name: item.name, price: formatMinor(item.priceMinor) })
        : t("saleOffers.savedNotice", { name: item.name, percent: offerPercent(updated) })
    );
  }

  if (error) {
    return (
      <div className="card">
        <div className="error-banner">{error}</div>
        <button className="btn btn-outline" onClick={() => setReload((value) => value + 1)} type="button">
          {t("common.retry")}
        </button>
      </div>
    );
  }
  if (items === null) return <div className="loading-state">{t("common.loading")}</div>;
  if (items.length === 0) return <div className="card empty-state">{t("saleOffers.noProducts")}</div>;

  return (
    <div>
      <div className="stat-grid offers-summary">
        <SummaryTile label={t("saleOffers.summary.onOffer")} value={String(summary.onOffer)} onClick={() => setFilter("onSale")} />
        <SummaryTile label={t("saleOffers.summary.products")} value={String(summary.products)} onClick={() => setFilter("all")} />
        <SummaryTile
          label={t("saleOffers.summary.attention")}
          tone={summary.attention > 0 ? "problem" : undefined}
          value={String(summary.attention)}
          onClick={() => setFilter("attention")}
        />
        <SummaryTile label={t("saleOffers.summary.biggest")} value={summary.biggestPercent ? `${summary.biggestPercent}%` : t("common.dash")} />
      </div>

      {notice ? <div className="notice-banner" role="status">{notice}</div> : null}
      {!props.canEdit ? <div className="warning-banner">{t("saleOffers.readOnly")}</div> : null}

      <div className="card">
        <div className="offers-toolbar">
          <input
            aria-label={t("saleOffers.searchPlaceholder")}
            autoFocus
            className="text-input offers-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("saleOffers.searchPlaceholder")}
            type="search"
            value={search}
          />
          <select
            aria-label={t("saleOffers.category")}
            className="select"
            onChange={(event) => setCategoryId(event.target.value)}
            value={categoryId}
          >
            <option value="">{t("saleOffers.allCategories")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <div className="tab-row" role="tablist" style={{ marginTop: 0 }}>
          {filters.map((key) => (
            <button
              aria-selected={key === filter}
              className={`btn btn-sm ${key === filter ? "btn-primary" : "btn-outline"}`}
              key={key}
              onClick={() => setFilter(key)}
              role="tab"
              type="button"
            >
              {t(`saleOffers.filters.${key}`)}
              {key === "onSale" ? ` (${summary.onOffer})` : key === "attention" && summary.attention ? ` (${summary.attention})` : ""}
            </button>
          ))}
        </div>
        <p className="field-hint">{t("saleOffers.resultCount", { shown: rows.length, total: items.length })}</p>

        {rows.length === 0 ? (
          <div className="empty-state">
            {filter === "onSale" && !search ? t("saleOffers.emptyOnSale") : t("saleOffers.emptySearch")}
            {search || categoryId || filter !== "all" ? (
              <div style={{ marginTop: 12 }}>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    setSearch("");
                    setCategoryId("");
                    setFilter("all");
                  }}
                  type="button"
                >
                  {t("saleOffers.clearFilters")}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table offers-table">
              <thead>
                <tr>
                  <th>{t("saleOffers.product")}</th>
                  <th>{t("saleOffers.regularPrice")}</th>
                  <th>{t("saleOffers.offerPrice")}</th>
                  <th>{t("saleOffers.discount")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((item) =>
                  editingId === item.id ? (
                    <tr className="offers-editing" key={item.id}>
                      <td colSpan={6}>
                        <OfferEditor
                          categoryName={categoryNames.get(item.categoryId)}
                          item={item}
                          onCancel={() => setEditingId(null)}
                          onEnd={() => setEnding(item)}
                          onSave={(saleMinor) => saveOffer(item, saleMinor)}
                        />
                      </td>
                    </tr>
                  ) : (
                    <OfferRow
                      canEdit={props.canEdit}
                      categoryName={categoryNames.get(item.categoryId)}
                      item={item}
                      key={item.id}
                      onEdit={() => {
                        setNotice(null);
                        setEditingId(item.id);
                      }}
                      onEnd={() => setEnding(item)}
                    />
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
        <Pager onPage={setPage} page={page} pageSize={pageSize} total={rows.length} />
      </div>

      {ending ? (
        <ConfirmModal
          confirmLabel={t("saleOffers.endConfirm")}
          description={t("saleOffers.endBody", { name: ending.name, price: formatMinor(ending.priceMinor) })}
          onCancel={() => setEnding(null)}
          onConfirm={async () => {
            await saveOffer(ending, null);
            setEnding(null);
          }}
          title={t("saleOffers.endTitle")}
        />
      ) : null}
    </div>
  );
}

function SummaryTile(props: { label: string; value: string; tone?: "problem"; onClick?: () => void }) {
  const body = (
    <>
      <div className="stat-label">{props.label}</div>
      <div className="stat-value">{props.value}</div>
    </>
  );
  return props.onClick ? (
    <button className={`stat-card offers-tile${props.tone === "problem" ? " offers-tile-problem" : ""}`} onClick={props.onClick} type="button">
      {body}
    </button>
  ) : (
    <div className="stat-card">{body}</div>
  );
}

function ProductCell(props: { item: MenuItemOwner; categoryName?: string }) {
  const { item } = props;
  return (
    <div className="offers-product">
      <div className="offers-thumb">
        <FallbackImage alt="" loading="lazy" src={item.imageUrl ?? undefined} />
        {isOnOffer(item) ? <span className="offers-thumb-sticker">−{offerPercent(item)}%</span> : null}
      </div>
      <div className="offers-product-text">
        <strong>{item.name}</strong>
        <span className="offers-product-meta">
          {[props.categoryName, item.brand, item.unitLabel].filter(Boolean).join(" · ")}
        </span>
        {item.sku || item.barcode ? (
          <span className="offers-product-meta" dir="ltr">
            {[item.sku, item.barcode].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function OfferRow(props: { item: MenuItemOwner; categoryName?: string; canEdit: boolean; onEdit: () => void; onEnd: () => void }) {
  const { t } = useTranslation();
  const { item } = props;
  const onOffer = isOnOffer(item);
  const attention = offerAttention(item);
  return (
    <tr className={onOffer ? "offers-row-on" : undefined}>
      <td>
        <ProductCell categoryName={props.categoryName} item={item} />
      </td>
      <td>{onOffer ? <s className="offers-regular"><Money minor={item.priceMinor} /></s> : <Money minor={item.priceMinor} />}</td>
      <td>{onOffer ? <strong className="offers-price"><Money minor={item.salePriceMinor!} /></strong> : t("common.dash")}</td>
      <td>
        {onOffer ? (
          <>
            <span className="offers-percent">−{offerPercent(item)}%</span>
            <br />
            <small>{t("saleOffers.saves", { amount: formatMinor(offerSavingMinor(item)) })}</small>
          </>
        ) : (
          t("common.dash")
        )}
      </td>
      <td>
        <span className={onOffer ? "badge badge-good" : "badge"}>{onOffer ? t("saleOffers.status.on") : t("saleOffers.status.none")}</span>
        {attention.map((reason) => (
          <div key={reason}>
            <span className="badge badge-warn">{t(`saleOffers.attention.${reason}`)}</span>
          </div>
        ))}
      </td>
      <td>
        {props.canEdit ? (
          <div className="row-actions">
            <button className={`btn btn-sm ${onOffer ? "btn-outline" : "btn-primary"}`} onClick={props.onEdit} type="button">
              {onOffer ? t("saleOffers.edit") : t("saleOffers.addOffer")}
            </button>
            {onOffer ? (
              <button className="btn btn-danger btn-sm" onClick={props.onEnd} type="button">
                {t("saleOffers.end")}
              </button>
            ) : null}
          </div>
        ) : (
          t("common.dash")
        )}
      </td>
    </tr>
  );
}

/**
 * The one field that matters: the offer price. The percentage, the saving and the before/after
 * the customer will see update as it is typed; quick chips fill in a common discount.
 */
function OfferEditor(props: {
  item: MenuItemOwner;
  categoryName?: string;
  onSave: (saleMinor: number) => Promise<void>;
  onEnd: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { item } = props;
  const [text, setText] = useState(item.salePriceMinor !== null ? toMoneyInput(item.salePriceMinor) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const parsed = parseOfferPrice(item.priceMinor, text);
  const belowCost = parsed.ok && isBelowCost(parsed.saleMinor, item.costPriceMinor);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function save() {
    if (!parsed.ok) return;
    setBusy(true);
    setError(null);
    try {
      await props.onSave(parsed.saleMinor);
    } catch (requestError) {
      setError(readApiError(requestError, t("common.genericActionError")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="offers-editor">
      <ProductCell categoryName={props.categoryName} item={item} />
      <form
        className="offers-editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="offers-editor-prices">
          <div>
            <div className="stat-label">{t("saleOffers.regularPrice")}</div>
            <div className="offers-editor-regular"><Money minor={item.priceMinor} /></div>
          </div>
          <span aria-hidden="true" className="offers-editor-arrow">→</span>
          <label className="offers-editor-field">
            <span className="stat-label">{t("saleOffers.offerPriceLabel")}</span>
            <input
              aria-invalid={!parsed.ok && parsed.error !== "empty"}
              className="text-input"
              dir="ltr"
              inputMode="decimal"
              onChange={(event) => setText(event.target.value)}
              placeholder={toMoneyInput(Math.round(item.priceMinor * 0.9))}
              ref={inputRef}
              value={text}
            />
          </label>
          <div className="offers-editor-result" aria-live="polite">
            {parsed.ok ? (
              <>
                <span className="offers-percent offers-percent-lg">−{parsed.percent}%</span>
                <span>{t("saleOffers.customerSaves", { amount: formatMinor(parsed.savingMinor) })}</span>
              </>
            ) : parsed.error === "empty" ? (
              <span className="field-hint">{t("saleOffers.typePrice")}</span>
            ) : (
              <span className="offers-error">{t(`saleOffers.errors.${parsed.error}`, { price: formatMinor(item.priceMinor) })}</span>
            )}
          </div>
        </div>
        <div className="offers-quick" role="group" aria-label={t("saleOffers.quickLabel")}>
          <span className="field-hint">{t("saleOffers.quickLabel")}</span>
          {quickPercents.map((percent) => {
            const price = offerPriceForPercent(item.priceMinor, percent);
            return price === null ? null : (
              <button className="btn btn-outline btn-sm" key={percent} onClick={() => setText(toMoneyInput(price))} type="button">
                −{percent}%
              </button>
            );
          })}
        </div>
        {parsed.ok ? (
          <p className="offers-preview">
            {t("saleOffers.previewLabel")} <span className="offers-preview-sticker">{t("saleOffers.sticker", { percent: parsed.percent })}</span>{" "}
            <s><Money minor={item.priceMinor} /></s> <strong><Money minor={parsed.saleMinor} /></strong>
          </p>
        ) : null}
        {belowCost ? <div className="warning-banner">{t("saleOffers.belowCostWarning", { cost: formatMinor(item.costPriceMinor!) })}</div> : null}
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="row-actions">
          <button className="btn btn-primary" disabled={!parsed.ok || busy} type="submit">
            {busy ? t("common.working") : isOnOffer(item) ? t("saleOffers.saveChange") : t("saleOffers.startOffer")}
          </button>
          <button className="btn btn-outline" onClick={props.onCancel} type="button">
            {t("common.cancel")}
          </button>
          {isOnOffer(item) ? (
            <button className="btn btn-danger" onClick={props.onEnd} type="button">
              {t("saleOffers.end")}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
