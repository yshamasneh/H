import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { readApiError } from "../api";
import { approveProducts, listReviewQueue, type ReviewQueueItem } from "../api.products";
import { listStoreCategories, updateStoreItem, type MenuCategoryOwner } from "../api.business";
import { FallbackImage } from "../components/FallbackImage";
import { ImageUploadField } from "../components/ImageUploadField";
import { Pager } from "../components/Pager";
import { saveProductWithImage } from "../image-upload";
import { formatMinor, toMoneyInput } from "../money";
import {
  approvalSummary,
  editBody,
  queryForFilter,
  toggleAll,
  toggleOne,
  type ProductEditDraft,
  type ReviewFilter
} from "../product-review-view";

/**
 * Run 3, task 2: every product across stores with its review state. Approve one or many, search by
 * name or barcode, and edit name, description, brand, category, price and image through the
 * existing admin product route (so the restricted-product screening and image rules still apply).
 */
export function ProductReviewPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ReviewFilter>("PENDING_REVIEW");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<ReviewQueueItem | null>(null);
  const [draft, setDraft] = useState<ProductEditDraft>({ name: "", description: "", brand: "", categoryId: "", price: "" });
  const [categories, setCategories] = useState<MenuCategoryOwner[]>([]);
  const [image, setImage] = useState<File | null | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listReviewQueue(queryForFilter(filter, search, page));
      setItems(result.items);
      setTotal(result.total);
      setPendingCount(result.pendingReviewCount);
      setSelected(new Set());
    } catch (requestError) {
      setError(readApiError(requestError, t("productReview.loadError")));
    } finally {
      setLoading(false);
    }
  }, [filter, search, page, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(ids: string[]) {
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const summary = approvalSummary(await approveProducts(ids));
      setNotice(t("productReview.approvedNotice", summary));
      await load();
    } catch (requestError) {
      setError(readApiError(requestError, t("productReview.approveError")));
    } finally {
      setBusy(false);
    }
  }

  async function openEditor(item: ReviewQueueItem) {
    setEditing(item);
    setImage(undefined);
    setDraft({ name: item.name, description: item.description ?? "", brand: item.brand ?? "", categoryId: item.categoryId, price: toMoneyInput(item.priceMinor) });
    try {
      setCategories(await listStoreCategories(item.restaurantId));
    } catch {
      setCategories([]);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    const body = editBody(editing, draft);
    if (!body) {
      setError(t("productReview.invalidPrice"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveProductWithImage({
        selection: image,
        previousUrl: editing.imageUrl,
        draftUrl: editing.imageUrl ?? "",
        restaurantId: editing.restaurantId,
        save: (imageUrl) => updateStoreItem(editing.restaurantId, editing.id, { ...body, ...(imageUrl !== undefined && imageUrl !== editing.imageUrl ? { imageUrl } : {}) })
      });
      setEditing(null);
      setNotice(t("productReview.saved"));
      await load();
    } catch (requestError) {
      setError(readApiError(requestError, t("productReview.saveError")));
    } finally {
      setBusy(false);
    }
  }

  const filters: ReviewFilter[] = ["PENDING_REVIEW", "APPROVED", "ALL"];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("productReview.title")}</h1>
          <p className="page-subtitle">{t("productReview.subtitle", { count: pendingCount })}</p>
        </div>
      </div>

      <div className="tab-row" role="tablist">
        {filters.map((key) => (
          <button
            aria-selected={key === filter}
            className={`btn btn-sm ${key === filter ? "btn-primary" : "btn-outline"}`}
            key={key}
            onClick={() => { setFilter(key); setPage(1); }}
            role="tab"
            type="button"
          >
            {t(`productReview.filters.${key}`)}
            {key === "PENDING_REVIEW" ? ` (${pendingCount})` : ""}
          </button>
        ))}
      </div>

      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {notice ? <div className="notice-banner" role="status">{notice}</div> : null}

      <div className="card">
        <div className="filters-row">
          <input
            aria-label={t("productReview.search")}
            className="text-input"
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            placeholder={t("productReview.search")}
            value={search}
          />
          <button className="btn btn-primary btn-sm" disabled={busy || selected.size === 0} onClick={() => void approve([...selected])} type="button">
            {t("productReview.approveSelected", { count: selected.size })}
          </button>
        </div>

        {loading ? (
          <div className="empty-state">{t("common.loading")}</div>
        ) : items.length === 0 ? (
          <div className="empty-state">{t("productReview.empty")}</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <input aria-label={t("productReview.selectAll")} onChange={() => setSelected(toggleAll(selected, items))} type="checkbox" />
                  </th>
                  <th>{t("productReview.columns.image")}</th>
                  <th>{t("productReview.columns.name")}</th>
                  <th>{t("productReview.columns.barcode")}</th>
                  <th>{t("productReview.columns.store")}</th>
                  <th>{t("productReview.columns.price")}</th>
                  <th>{t("productReview.columns.status")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.reviewStatus === "PENDING_REVIEW" ? (
                        <input
                          aria-label={t("productReview.select", { name: item.name })}
                          checked={selected.has(item.id)}
                          onChange={() => setSelected(toggleOne(selected, item.id))}
                          type="checkbox"
                        />
                      ) : null}
                    </td>
                    <td>
                      {item.imageUrl ? <FallbackImage alt="" className="stock-image" loading="lazy" src={item.imageUrl} /> : <span>{t("productReview.noImage")}</span>}
                    </td>
                    <td>
                      <div>{item.name}</div>
                      <small>{[item.brand, item.categoryName].filter(Boolean).join(" · ")}</small>
                    </td>
                    <td dir="ltr">{item.barcode ?? "—"}</td>
                    <td>{item.restaurantName}</td>
                    <td dir="ltr">{formatMinor(item.priceMinor)}</td>
                    <td>{t(`productReview.filters.${item.reviewStatus}`)}</td>
                    <td>
                      <button className="btn btn-outline btn-sm" onClick={() => void openEditor(item)} type="button">{t("productReview.edit")}</button>
                      {item.reviewStatus === "PENDING_REVIEW" ? (
                        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void approve([item.id])} type="button">{t("productReview.approve")}</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager onPage={setPage} page={page} pageSize={50} total={total} />
      </div>

      {editing ? (
        <div className="card" aria-label={t("productReview.editTitle")} role="dialog">
          <h2 className="card-title">{t("productReview.editTitle")}</h2>
          <div className="filters-row">
            <input aria-label={t("productReview.columns.name")} className="text-input" dir="auto" onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name} />
            <input aria-label={t("productReview.brand")} className="text-input" dir="auto" onChange={(event) => setDraft({ ...draft, brand: event.target.value })} placeholder={t("productReview.brand")} value={draft.brand} />
            <input aria-label={t("productReview.columns.price")} className="text-input" dir="ltr" inputMode="decimal" onChange={(event) => setDraft({ ...draft, price: event.target.value })} value={draft.price} />
            <select aria-label={t("productReview.category")} className="select" onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })} value={draft.categoryId}>
              {categories.length === 0 ? <option value={editing.categoryId}>{editing.categoryName}</option> : null}
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </div>
          <textarea
            aria-label={t("productReview.description")}
            className="text-input"
            dir="auto"
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            placeholder={t("productReview.description")}
            value={draft.description}
          />
          <ImageUploadField currentUrl={editing.imageUrl} disabled={busy} onChange={setImage} selection={image} />
          <div className="filters-row">
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void saveEdit()} type="button">{t("productReview.save")}</button>
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setEditing(null)} type="button">{t("productReview.cancel")}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
