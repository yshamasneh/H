import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, readApiError } from "../api";
import { type MenuCategoryOwner, type MenuItemOwner } from "../api.business";
import { categoryCounts, emptyFilter, filterProducts, hiddenCount, onSaleCount, paginate, type ProductFilter, type Visibility } from "../catalogue-view";
import { parseMoneyToMinor, parseWholeNumber, toMoneyInput } from "../money";
import { isBelowCost, parseSaleInput, salePercentOff } from "../sale";
import { ConfirmModal } from "./ConfirmModal";
import { FallbackImage } from "./FallbackImage";
import { ImageUploadField } from "./ImageUploadField";
import { Pager } from "./Pager";
import { isSafeExternalImageUrl, saveProductWithImage } from "../image-upload";

const currencyCode = "ILS";
const productsPageSize = 40;

/**
 * The set of catalogue calls this editor needs, injected so the same UI drives two shells: the
 * business portal (a store owner managing their own catalogue via /restaurant/me/*) and the
 * super-admin store detail page (an admin managing any store via /admin/restaurants/:id/*). The
 * component never knows which store it is editing — that is baked into the adapter it is handed.
 */
export type CatalogueApi = {
  listCategories: () => Promise<MenuCategoryOwner[]>;
  createCategory: (body: { name: string; sortOrder?: number }) => Promise<MenuCategoryOwner>;
  updateCategory: (categoryId: string, body: { name?: string; sortOrder?: number; isActive?: boolean }) => Promise<MenuCategoryOwner>;
  deleteCategory: (categoryId: string) => Promise<{ message: string }>;
  listItems: () => Promise<MenuItemOwner[]>;
  createItem: (body: Record<string, unknown>) => Promise<MenuItemOwner>;
  updateItem: (itemId: string, body: Record<string, unknown>) => Promise<MenuItemOwner>;
  deleteItem: (itemId: string) => Promise<{ message: string }>;
  setItemAvailability: (itemId: string, isAvailable: boolean) => Promise<MenuItemOwner>;
};

export type CatalogueCapabilities = {
  isSupermarket: boolean;
  canManagePrices: boolean;
  canManageProducts: boolean;
  canManageMenu: boolean;
  canManageOrders: boolean;
};

type ItemDraft = {
  categoryId: string;
  name: string;
  description: string;
  price: string;
  salePrice: string;
  costPrice: string;
  imageUrl: string;
  brand: string;
  sku: string;
  barcode: string;
  unitLabel: string;
  stockQuantity: string;
  reorderLevel: string;
  displayPriority: string;
  isFeatured: boolean;
  isVariableWeight: boolean;
};

const emptyDraft: ItemDraft = {
  categoryId: "",
  name: "",
  description: "",
  price: "",
  salePrice: "",
  costPrice: "",
  imageUrl: "",
  brand: "",
  sku: "",
  barcode: "",
  unitLabel: "item",
  stockQuantity: "",
  reorderLevel: "",
  displayPriority: "",
  isFeatured: false,
  isVariableWeight: false
};

export function CatalogueManager({ api, capabilities, restaurantId }: { api: CatalogueApi; capabilities: CatalogueCapabilities; restaurantId: string }) {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<MenuCategoryOwner[]>([]);
  const [items, setItems] = useState<MenuItemOwner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [draft, setDraft] = useState<ItemDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Removing a product means hiding it. There is deliberately no delete action in this screen: the
  // API refuses to delete a product that was ever ordered (order history must stay intact), and
  // hiding is the normal, reversible way to take something off sale.
  const [pendingHide, setPendingHide] = useState<MenuItemOwner | null>(null);
  const [filter, setFilter] = useState<ProductFilter>(emptyFilter);
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string; sortOrder: string } | null>(null);
  const [pendingCategoryDelete, setPendingCategoryDelete] = useState<MenuCategoryOwner | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null | undefined>(undefined);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [savingItem, setSavingItem] = useState(false);

  const { isSupermarket, canManagePrices, canManageProducts, canManageMenu, canManageOrders } = capabilities;

  async function load() {
    try {
      const [nextCategories, nextItems] = await Promise.all([api.listCategories(), api.listItems()]);
      setCategories(nextCategories);
      setItems(nextItems);
      setError(null);
    } catch (requestError) {
      setError(readApiError(requestError, t("catalogue.loadError")));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setNotice(null);
    try {
      await action();
      await load();
      setError(null);
      return true;
    } catch (requestError) {
      setError(readApiError(requestError, t("common.genericActionError")));
      return false;
    }
  }

  function startEdit(item: MenuItemOwner) {
    setEditingId(item.id);
    setError(null);
    setDraft({
      categoryId: item.categoryId,
      name: item.name,
      description: item.description ?? "",
      price: toMoneyInput(item.priceMinor),
      salePrice: item.salePriceMinor === null ? "" : toMoneyInput(item.salePriceMinor),
      costPrice: item.costPriceMinor === null ? "" : toMoneyInput(item.costPriceMinor),
      imageUrl: item.imageUrl ?? "",
      brand: item.brand ?? "",
      sku: item.sku ?? "",
      barcode: item.barcode ?? "",
      unitLabel: item.unitLabel,
      stockQuantity: item.stockQuantity === null ? "" : String(item.stockQuantity),
      reorderLevel: item.reorderLevel === null ? "" : String(item.reorderLevel),
      displayPriority: item.displayPriority === 0 ? "" : String(item.displayPriority),
      isFeatured: item.isFeatured,
      isVariableWeight: item.isVariableWeight
    });
    setSelectedImage(undefined);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft);
    setSelectedImage(undefined);
    setError(null);
  }

  function validateDraft(): string | null {
    if (!draft.name.trim()) return t("catalogue.errorNameRequired");
    if (canManagePrices) {
      // Text is parsed digit by digit (see money.ts): `Number("1.15") * 100` is 114.99999999999999.
      if (!draft.price.trim() || parseMoneyToMinor(draft.price) === null) return t("catalogue.errorPriceInvalid");
      if (draft.costPrice.trim() && parseMoneyToMinor(draft.costPrice) === null) {
        return t("catalogue.errorCostPriceInvalid");
      }
      const sale = parseSaleInput(draft.price, draft.salePrice);
      if (!sale.ok) return t(sale.error === "notBelowPrice" ? "catalogue.errorSaleNotBelow" : "catalogue.errorSaleInvalid");
    }
    if (isSupermarket) {
      for (const value of [draft.stockQuantity, draft.reorderLevel]) {
        if (value.trim() && parseWholeNumber(value) === null) return t("catalogue.errorStockInvalid");
      }
    }
    if (draft.displayPriority.trim() && parseWholeNumber(draft.displayPriority) === null) {
      return t("catalogue.errorPriorityInvalid");
    }
    const previousUrl = editingId ? items.find((item) => item.id === editingId)?.imageUrl : null;
    if (selectedImage === undefined && draft.imageUrl.trim() && draft.imageUrl.trim() !== previousUrl && !isSafeExternalImageUrl(draft.imageUrl)) {
      return t("catalogue.errorImageUrlInvalid");
    }
    return null;
  }

  async function submitItem() {
    const validationError = validateDraft();
    if (validationError) {
      setError(validationError);
      return;
    }

    const previousUrl = editingId ? items.find((item) => item.id === editingId)?.imageUrl ?? null : null;
    setSavingItem(true);
    try {
      if (selectedImage instanceof File) setUploadProgress(0);

      const body: Record<string, unknown> = {
        categoryId: draft.categoryId || categories[0]?.id,
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        unitLabel: draft.unitLabel.trim() || "item",
        displayPriority: draft.displayPriority.trim() ? parseWholeNumber(draft.displayPriority) : editingId ? 0 : undefined
      };
      // Price and cost price are only ever sent by someone allowed to set prices, and the API
      // enforces the same rule independently.
      if (canManagePrices && draft.price) {
        body.priceMinor = parseMoneyToMinor(draft.price);
        // Blank ends a running sale (null); on a new product a blank simply means no sale.
        const sale = parseSaleInput(draft.price, draft.salePrice);
        if (sale.ok && (sale.saleMinor !== null || editingId)) body.salePriceMinor = sale.saleMinor;
        body.costPriceMinor = draft.costPrice.trim()
          ? parseMoneyToMinor(draft.costPrice)
          : editingId
            ? null
            : undefined;
      }
      if (isSupermarket) {
        if (draft.brand.trim()) body.brand = draft.brand.trim();
        if (draft.sku.trim()) body.sku = draft.sku.trim();
        if (draft.barcode.trim()) body.barcode = draft.barcode.trim();
        body.stockQuantity = draft.stockQuantity.trim()
          ? parseWholeNumber(draft.stockQuantity)
          : editingId
            ? null
            : undefined;
        body.reorderLevel = draft.reorderLevel.trim()
          ? parseWholeNumber(draft.reorderLevel)
          : editingId
            ? null
            : undefined;
        body.isFeatured = draft.isFeatured;
        body.isVariableWeight = draft.isVariableWeight;
      }

      await saveProductWithImage({
        selection: selectedImage,
        previousUrl,
        draftUrl: draft.imageUrl,
        restaurantId,
        onProgress: setUploadProgress,
        save: (imageUrl) => editingId
          ? api.updateItem(editingId, { ...body, imageUrl })
          : api.createItem({ ...body, imageUrl, priceMinor: parseMoneyToMinor(draft.price || "0") ?? 0 })
      });
      setDraft(emptyDraft);
      setEditingId(null);
      setSelectedImage(undefined);
      setNotice(t("catalogue.saved"));
      await load();
    } catch (requestError) {
      setError(readApiError(requestError, t("catalogue.uploadError")));
    } finally {
      setUploadProgress(null);
      setSavingItem(false);
    }
  }

  const counts = categoryCounts(items);
  const filtered = filterProducts(items, filter);
  const pageItems = paginate(filtered, page, productsPageSize);
  const hiddenTotal = hiddenCount(items);
  const saleTotal = onSaleCount(items);
  const draftSale = parseSaleInput(draft.price, draft.salePrice);
  const draftBelowCost = draftSale.ok && isBelowCost(draftSale.saleMinor, draft.costPrice.trim() ? parseMoneyToMinor(draft.costPrice) : null);
  const categoryNameOf = (id: string) => categories.find((category) => category.id === id)?.name ?? "—";
  const canHide = canManageProducts || canManageOrders;

  function changeFilter(patch: Partial<ProductFilter>) {
    setFilter((previous) => ({ ...previous, ...patch }));
    setPage(1);
  }

  async function moveItem(item: MenuItemOwner, categoryId: string) {
    if (categoryId === item.categoryId) return;
    if (await run(() => api.updateItem(item.id, { categoryId }))) setNotice(t("catalogue.moved"));
  }

  async function saveRename() {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) return setError(t("catalogue.categoryNameRequired"));
    const sortOrder = parseWholeNumber(renaming.sortOrder);
    if (sortOrder === null) return setError(t("catalogue.sortOrderInvalid"));
    if (await run(() => api.updateCategory(renaming.id, { name, sortOrder }))) setRenaming(null);
  }

  function requestCategoryDelete(category: MenuCategoryOwner) {
    const count = counts.get(category.id)?.total ?? 0;
    if (count > 0) {
      // The API refuses this too; saying why here, in the operator's language, saves a round trip.
      setError(t("catalogue.deleteCategoryBlocked", { name: category.name, count }));
      return;
    }
    setError(null);
    setPendingCategoryDelete(category);
  }

  return (
    <div>
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="notice-banner">{notice}</div> : null}

      <div className="card">
        <h2 className="card-title">{t("catalogue.categories")}</h2>
        {canManageMenu ? (
          <div className="filters-row">
            <input
              className="text-input"
              onChange={(event) => setCategoryName(event.target.value)}
              placeholder={t("catalogue.newCategoryPlaceholder")}
              value={categoryName}
            />
            <button
              className="btn btn-primary btn-sm"
              disabled={!categoryName.trim()}
              onClick={() =>
                void run(async () => {
                  await api.createCategory({ name: categoryName.trim() });
                  setCategoryName("");
                })
              }
              type="button"
            >
              {t("catalogue.addCategory")}
            </button>
          </div>
        ) : null}
        {categories.length === 0 ? (
          <div className="empty-state">{t("catalogue.noCategories")}</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("common.name")}</th>
                  <th>{t("catalogue.productCount")}</th>
                  <th>{t("catalogue.sortOrder")}</th>
                  <th>{t("common.status")}</th>
                  {canManageMenu ? <th>{t("common.actions")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => {
                  const count = counts.get(category.id) ?? { total: 0, visible: 0, hidden: 0 };
                  const editing = renaming?.id === category.id ? renaming : null;
                  return (
                    <tr key={category.id}>
                      <td>
                        {editing ? (
                          <input
                            className="text-input"
                            maxLength={80}
                            onChange={(event) => setRenaming({ ...editing, name: event.target.value })}
                            value={editing.name}
                          />
                        ) : (
                          category.name
                        )}
                      </td>
                      <td>
                        <strong className="num">{count.total}</strong>
                        {count.hidden > 0 ? (
                          <>
                            <br />
                            <small>{t("catalogue.countDetail", { visible: count.visible, hidden: count.hidden })}</small>
                          </>
                        ) : null}
                      </td>
                      <td className="num">
                        {editing ? (
                          <input
                            className="text-input"
                            dir="ltr"
                            inputMode="numeric"
                            onChange={(event) => setRenaming({ ...editing, sortOrder: event.target.value })}
                            style={{ maxWidth: 90 }}
                            value={editing.sortOrder}
                          />
                        ) : (
                          category.sortOrder
                        )}
                      </td>
                      <td>{category.isActive ? t("common.active") : t("common.inactive")}</td>
                      {canManageMenu ? (
                        <td>
                          <div className="row-actions">
                            {editing ? (
                              <>
                                <button className="btn btn-primary btn-sm" onClick={() => void saveRename()} type="button">
                                  {t("catalogue.renameSave")}
                                </button>
                                <button className="btn btn-outline btn-sm" onClick={() => setRenaming(null)} type="button">
                                  {t("common.cancel")}
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="btn btn-outline btn-sm"
                                  onClick={() =>
                                    setRenaming({ id: category.id, name: category.name, sortOrder: String(category.sortOrder) })
                                  }
                                  type="button"
                                >
                                  {t("catalogue.rename")}
                                </button>
                                <button
                                  className="btn btn-outline btn-sm"
                                  onClick={() => void run(() => api.updateCategory(category.id, { isActive: !category.isActive }))}
                                  type="button"
                                >
                                  {category.isActive ? t("catalogue.deactivate") : t("catalogue.activate")}
                                </button>
                                <button
                                  className="btn btn-outline btn-sm"
                                  onClick={() => requestCategoryDelete(category)}
                                  type="button"
                                >
                                  {t("catalogue.deleteCategory")}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canManageProducts && categories.length > 0 ? (
        <div className="card">
          <h2 className="card-title">{editingId ? t("catalogue.editProduct") : t("catalogue.addProduct")}</h2>
          <div className="filters-row">
            <input
              className="text-input"
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder={isSupermarket ? t("catalogue.productName") : t("catalogue.itemName")}
              value={draft.name}
            />
            <select
              className="select"
              onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}
              value={draft.categoryId || categories[0]?.id}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filters-row">
            <input
              className="text-input"
              dir="ltr"
              disabled={!canManagePrices}
              inputMode="decimal"
              onChange={(event) => setDraft({ ...draft, price: event.target.value })}
              placeholder={canManagePrices ? t("catalogue.priceMinor") : t("catalogue.priceLocked")}
              value={draft.price}
            />
            <input
              aria-label={t("catalogue.salePrice")}
              className="text-input"
              dir="ltr"
              disabled={!canManagePrices}
              inputMode="decimal"
              onChange={(event) => setDraft({ ...draft, salePrice: event.target.value })}
              placeholder={t("catalogue.salePrice")}
              value={draft.salePrice}
            />
            <input
              className="text-input"
              dir="ltr"
              disabled={!canManagePrices}
              inputMode="decimal"
              onChange={(event) => setDraft({ ...draft, costPrice: event.target.value })}
              placeholder={canManagePrices ? t("catalogue.costPriceMinor") : t("catalogue.costPriceLocked")}
              value={draft.costPrice}
            />
            <input
              className="text-input"
              onChange={(event) => setDraft({ ...draft, unitLabel: event.target.value })}
              placeholder={t("catalogue.unitLabel")}
              value={draft.unitLabel}
            />
            <input
              aria-label={t("catalogue.displayPriority")}
              className="text-input"
              dir="ltr"
              inputMode="numeric"
              onChange={(event) => setDraft({ ...draft, displayPriority: event.target.value })}
              placeholder={t("catalogue.displayPriority")}
              style={{ maxWidth: 140 }}
              value={draft.displayPriority}
            />
          </div>
          <p className="field-hint">{t("catalogue.displayPriorityHint")}</p>
          {canManagePrices ? (
            <p className="field-hint">
              {t("catalogue.salePriceHint")}
              {draftSale.ok && draftSale.saleMinor !== null ? (
                <>
                  {" "}
                  <strong>{t("catalogue.saleBadge", { percent: salePercentOff(parseMoneyToMinor(draft.price) ?? 0, draftSale.saleMinor) })}</strong>{" "}
                  <button className="btn btn-outline btn-sm" onClick={() => setDraft({ ...draft, salePrice: "" })} type="button">
                    {t("catalogue.clearSale")}
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
          {draftBelowCost ? <div className="warning-banner">{t("catalogue.saleBelowCost")}</div> : null}
          <div className="filters-row">
            <input
              className="text-input"
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder={t("catalogue.description")}
              value={draft.description}
            />
          </div>
          <ImageUploadField
            currentUrl={draft.imageUrl}
            disabled={savingItem}
            onChange={setSelectedImage}
            progress={uploadProgress}
            selection={selectedImage}
          />
          <details>
            <summary>{t("catalogue.advancedImageUrl")}</summary>
            <div className="filters-row">
              <input
                aria-label={t("catalogue.imageUrl")}
                className="text-input"
                dir="ltr"
                onChange={(event) => { setSelectedImage(undefined); setDraft({ ...draft, imageUrl: event.target.value }); }}
                placeholder={`${t("catalogue.imageUrl")} — ${t("catalogue.imageUrlPlaceholder")}`}
                style={{ minWidth: 320 }}
                value={draft.imageUrl}
              />
              <span className="field-hint">{t("catalogue.imageUrlHint")}</span>
            </div>
          </details>
          {isSupermarket ? (
            <>
              <div className="filters-row">
                <input
                  className="text-input"
                  onChange={(event) => setDraft({ ...draft, brand: event.target.value })}
                  placeholder={t("catalogue.brand")}
                  value={draft.brand}
                />
                <input
                  className="text-input"
                  onChange={(event) => setDraft({ ...draft, sku: event.target.value })}
                  placeholder={t("catalogue.sku")}
                  value={draft.sku}
                />
                <input
                  className="text-input"
                  dir="ltr"
                  onChange={(event) => setDraft({ ...draft, barcode: event.target.value })}
                  placeholder={t("catalogue.barcode")}
                  value={draft.barcode}
                />
              </div>
              <div className="filters-row">
                <input
                  className="text-input"
                  inputMode="numeric"
                  onChange={(event) => setDraft({ ...draft, stockQuantity: event.target.value })}
                  placeholder={t("catalogue.stockQuantity")}
                  value={draft.stockQuantity}
                />
                <input
                  className="text-input"
                  inputMode="numeric"
                  onChange={(event) => setDraft({ ...draft, reorderLevel: event.target.value })}
                  placeholder={t("catalogue.reorderLevel")}
                  value={draft.reorderLevel}
                />
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => setDraft({ ...draft, isFeatured: !draft.isFeatured })}
                  type="button"
                >
                  {draft.isFeatured ? t("catalogue.featuredActive") : t("catalogue.markFeatured")}
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => setDraft({ ...draft, isVariableWeight: !draft.isVariableWeight })}
                  type="button"
                >
                  {draft.isVariableWeight ? t("catalogue.variableWeightActive") : t("catalogue.fixedQuantity")}
                </button>
              </div>
            </>
          ) : null}
          <div className="filters-row">
            <button className="btn btn-primary btn-sm" disabled={savingItem} onClick={() => void submitItem()} type="button">
              {editingId ? t("common.save") : t("catalogue.addProduct")}
            </button>
            {editingId ? (
              <button className="btn btn-outline btn-sm" onClick={cancelEdit} type="button">
                {t("common.cancel")}
              </button>
            ) : null}
          </div>
          {!canManagePrices ? <div className="empty-state">{t("catalogue.priceLockedHint")}</div> : null}
        </div>
      ) : null}

      <div className="card">
        <h2 className="card-title">{t("catalogue.products")}</h2>
        <div className="filters-row">
          <input
            className="text-input"
            onChange={(event) => changeFilter({ search: event.target.value })}
            placeholder={t("catalogue.searchPlaceholder")}
            style={{ minWidth: 260 }}
            value={filter.search}
          />
          <select
            aria-label={t("catalogue.category")}
            className="select"
            onChange={(event) => changeFilter({ categoryId: event.target.value })}
            value={filter.categoryId}
          >
            <option value="">{t("catalogue.allCategories")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <select
            aria-label={t("common.status")}
            className="select"
            onChange={(event) => changeFilter({ visibility: event.target.value as Visibility })}
            value={filter.visibility}
          >
            <option value="ALL">{t("catalogue.visibilityAll")}</option>
            <option value="VISIBLE">{t("catalogue.visibilityVisible")}</option>
            <option value="HIDDEN">
              {t("catalogue.visibilityHidden")} ({hiddenTotal})
            </option>
          </select>
        </div>
        <label className="checkbox-row">
          <input
            checked={filter.onSaleOnly}
            onChange={(event) => changeFilter({ onSaleOnly: event.target.checked })}
            type="checkbox"
          />
          {t("catalogue.onSaleOnly", { count: saleTotal })}
        </label>
        <p className="field-hint">
          {t("catalogue.showing", { shown: filtered.length, total: items.length })}
          {hiddenTotal > 0 ? ` · ${t("catalogue.hiddenSummary", { count: hiddenTotal })}` : ""}
        </p>
        {items.length === 0 ? (
          <div className="empty-state">{t("catalogue.noProducts")}</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">{t("catalogue.noMatches")}</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("catalogue.image")}</th>
                  <th>{t("common.name")}</th>
                  <th>{t("catalogue.category")}</th>
                  <th>{t("catalogue.price")}</th>
                  <th>{t("catalogue.cost")}</th>
                  {isSupermarket ? <th>{t("catalogue.stock")}</th> : null}
                  <th>{t("common.status")}</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((item) => (
                  <tr key={item.id} style={item.isAvailable ? undefined : { opacity: 0.7 }}>
                    <td><FallbackImage alt="" className="catalogue-thumbnail" src={item.imageUrl ?? undefined} /></td>
                    <td>{item.name}</td>
                    <td>
                      {canManageProducts ? (
                        <select
                          aria-label={t("catalogue.moveTo")}
                          className="select"
                          onChange={(event) => void moveItem(item, event.target.value)}
                          value={item.categoryId}
                        >
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        categoryNameOf(item.categoryId)
                      )}
                    </td>
                    <td className="money">
                      {item.salePriceMinor !== null ? (
                        <>
                          <s style={{ opacity: 0.6 }}>{formatPrice(item.priceMinor)}</s>{" "}
                          <strong>{formatPrice(item.salePriceMinor)}</strong>
                          <br />
                          <span className="badge badge-attention">
                            {t("catalogue.saleBadge", { percent: salePercentOff(item.priceMinor, item.salePriceMinor) })}
                          </span>
                        </>
                      ) : (
                        formatPrice(item.priceMinor)
                      )}
                    </td>
                    <td className="money">{item.costPriceMinor === null ? t("common.dash") : formatPrice(item.costPriceMinor)}</td>
                    {isSupermarket ? <td className="num">{item.stockQuantity ?? t("common.dash")}</td> : null}
                    <td>
                      <span className={`badge ${item.isAvailable ? "badge-good" : "badge-neutral"}`}>
                        {item.isAvailable ? t("catalogue.statusVisible") : t("catalogue.statusHidden")}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        {canManageProducts ? (
                          <button className="btn btn-outline btn-sm" onClick={() => startEdit(item)} type="button">
                            {t("common.edit")}
                          </button>
                        ) : null}
                        {canHide ? (
                          item.isAvailable ? (
                            <button className="btn btn-outline btn-sm" onClick={() => setPendingHide(item)} type="button">
                              {t("catalogue.hide")}
                            </button>
                          ) : (
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={async () => {
                                if (await run(() => api.setItemAvailability(item.id, true))) setNotice(t("catalogue.unhidden"));
                              }}
                              type="button"
                            >
                              {t("catalogue.unhide")}
                            </button>
                          )
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager onPage={setPage} page={page} pageSize={productsPageSize} total={filtered.length} />
        <p className="field-hint">{t("catalogue.hideNote")}</p>
      </div>

      {pendingHide ? (
        <ConfirmModal
          confirmLabel={t("catalogue.hide")}
          description={t("catalogue.hideConfirmBody", { name: pendingHide.name })}
          onCancel={() => setPendingHide(null)}
          onConfirm={async () => {
            await api.setItemAvailability(pendingHide.id, false);
            setPendingHide(null);
            setNotice(t("catalogue.hidden"));
            await load();
          }}
          title={t("catalogue.hideConfirmTitle")}
          tone="primary"
        />
      ) : null}
      {pendingCategoryDelete ? (
        <ConfirmModal
          confirmLabel={t("catalogue.deleteCategory")}
          description={t("catalogue.deleteCategoryBody", { name: pendingCategoryDelete.name })}
          onCancel={() => setPendingCategoryDelete(null)}
          onConfirm={async () => {
            await api.deleteCategory(pendingCategoryDelete.id);
            setPendingCategoryDelete(null);
            await load();
          }}
          title={t("catalogue.deleteCategoryTitle")}
        />
      ) : null}
    </div>
  );
}

function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ${currencyCode}`;
}
