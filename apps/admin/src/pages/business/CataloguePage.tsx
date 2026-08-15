import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../api";
import {
  createBusinessCategory,
  createBusinessItem,
  deleteBusinessCategory,
  deleteBusinessItem,
  listBusinessCategories,
  listBusinessItems,
  setBusinessItemAvailability,
  updateBusinessCategory,
  updateBusinessItem,
  type MenuCategoryOwner,
  type MenuItemOwner
} from "../../api.business";
import { ConfirmModal } from "../../components/ConfirmModal";
import { useAuth } from "../../auth";

const currencyCode = "ILS";

type ItemDraft = {
  categoryId: string;
  name: string;
  description: string;
  price: string;
  costPrice: string;
  imageUrl: string;
  brand: string;
  sku: string;
  barcode: string;
  unitLabel: string;
  stockQuantity: string;
  reorderLevel: string;
  isFeatured: boolean;
  isVariableWeight: boolean;
};

const emptyDraft: ItemDraft = {
  categoryId: "",
  name: "",
  description: "",
  price: "",
  costPrice: "",
  imageUrl: "",
  brand: "",
  sku: "",
  barcode: "",
  unitLabel: "item",
  stockQuantity: "",
  reorderLevel: "",
  isFeatured: false,
  isVariableWeight: false
};

export function CataloguePage() {
  const { t } = useTranslation();
  const { can, access } = useAuth();
  const [categories, setCategories] = useState<MenuCategoryOwner[]>([]);
  const [items, setItems] = useState<MenuItemOwner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [draft, setDraft] = useState<ItemDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MenuItemOwner | null>(null);

  const isSupermarket = access?.business?.businessType === "SUPERMARKET";
  const canManagePrices = can("MANAGE_PRICES");
  const canManageProducts = can("MANAGE_PRODUCTS");
  const canManageMenu = can("MANAGE_MENU");

  async function load() {
    try {
      const [nextCategories, nextItems] = await Promise.all([listBusinessCategories(), listBusinessItems()]);
      setCategories(nextCategories);
      setItems(nextItems);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("catalogue.loadError"));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    try {
      await action();
      await load();
      setError(null);
      return true;
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("common.genericActionError"));
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
      price: (item.priceMinor / 100).toFixed(2),
      costPrice: item.costPriceMinor === null ? "" : (item.costPriceMinor / 100).toFixed(2),
      imageUrl: item.imageUrl ?? "",
      brand: item.brand ?? "",
      sku: item.sku ?? "",
      barcode: item.barcode ?? "",
      unitLabel: item.unitLabel,
      stockQuantity: item.stockQuantity === null ? "" : String(item.stockQuantity),
      reorderLevel: item.reorderLevel === null ? "" : String(item.reorderLevel),
      isFeatured: item.isFeatured,
      isVariableWeight: item.isVariableWeight
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft);
    setError(null);
  }

  function validateDraft(): string | null {
    if (!draft.name.trim()) return t("catalogue.errorNameRequired");
    if (canManagePrices) {
      const priceMinor = Math.round(Number(draft.price.replace(",", ".")) * 100);
      if (!draft.price.trim() || !Number.isFinite(priceMinor) || priceMinor < 0) {
        return t("catalogue.errorPriceInvalid");
      }
      if (draft.costPrice.trim()) {
        const costPriceMinor = Math.round(Number(draft.costPrice.replace(",", ".")) * 100);
        if (!Number.isFinite(costPriceMinor) || costPriceMinor < 0) return t("catalogue.errorCostPriceInvalid");
      }
    }
    return null;
  }

  function submitItem() {
    const validationError = validateDraft();
    if (validationError) {
      setError(validationError);
      return;
    }

    const body: Record<string, unknown> = {
      categoryId: draft.categoryId || categories[0]?.id,
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      imageUrl: draft.imageUrl.trim() || undefined,
      unitLabel: draft.unitLabel.trim() || "item"
    };
    // Price and cost price are only ever sent by someone allowed to set prices, and the API
    // enforces the same rule independently.
    if (canManagePrices && draft.price) {
      body.priceMinor = Math.round(Number(draft.price.replace(",", ".")) * 100);
      body.costPriceMinor = draft.costPrice.trim()
        ? Math.round(Number(draft.costPrice.replace(",", ".")) * 100)
        : editingId
          ? null
          : undefined;
    }
    if (isSupermarket) {
      if (draft.brand.trim()) body.brand = draft.brand.trim();
      if (draft.sku.trim()) body.sku = draft.sku.trim();
      if (draft.barcode.trim()) body.barcode = draft.barcode.trim();
      body.stockQuantity = draft.stockQuantity.trim()
        ? Math.max(0, Number.parseInt(draft.stockQuantity, 10) || 0)
        : editingId
          ? null
          : undefined;
      body.reorderLevel = draft.reorderLevel.trim()
        ? Math.max(0, Number.parseInt(draft.reorderLevel, 10) || 0)
        : editingId
          ? null
          : undefined;
      body.isFeatured = draft.isFeatured;
      body.isVariableWeight = draft.isVariableWeight;
    }

    void (async () => {
      const success = await run(async () => {
        if (editingId) await updateBusinessItem(editingId, body);
        else {
          await createBusinessItem({
            ...body,
            priceMinor: Math.round(Number(draft.price.replace(",", ".") || 0) * 100)
          });
        }
      });
      if (success) {
        setDraft(emptyDraft);
        setEditingId(null);
      }
    })();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("catalogue.title")}</h1>
          <p className="page-subtitle">
            {isSupermarket ? t("catalogue.subtitleSupermarket") : t("catalogue.subtitleRestaurant")}
          </p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

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
                  await createBusinessCategory({ name: categoryName.trim() });
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
                  <th>{t("catalogue.sortOrder")}</th>
                  <th>{t("common.status")}</th>
                  {canManageMenu ? <th>{t("common.actions")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <tr key={category.id}>
                    <td>{category.name}</td>
                    <td>{category.sortOrder}</td>
                    <td>{category.isActive ? t("common.active") : t("common.inactive")}</td>
                    {canManageMenu ? (
                      <td>
                        <div className="filters-row" style={{ margin: 0 }}>
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() =>
                              void run(() => updateBusinessCategory(category.id, { isActive: !category.isActive }))
                            }
                            type="button"
                          >
                            {category.isActive ? t("catalogue.deactivate") : t("catalogue.activate")}
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => void run(() => deleteBusinessCategory(category.id))}
                            type="button"
                          >
                            {t("common.delete")}
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
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
              disabled={!canManagePrices}
              onChange={(event) => setDraft({ ...draft, price: event.target.value })}
              placeholder={canManagePrices ? t("catalogue.priceMinor") : t("catalogue.priceLocked")}
              value={draft.price}
            />
            <input
              className="text-input"
              disabled={!canManagePrices}
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
          </div>
          <div className="filters-row">
            <input
              className="text-input"
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder={t("catalogue.description")}
              value={draft.description}
            />
            <input
              className="text-input"
              onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value })}
              placeholder={t("catalogue.imageUrl")}
              value={draft.imageUrl}
            />
          </div>
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
                  onChange={(event) => setDraft({ ...draft, barcode: event.target.value })}
                  placeholder={t("catalogue.barcode")}
                  value={draft.barcode}
                />
              </div>
              <div className="filters-row">
                <input
                  className="text-input"
                  onChange={(event) => setDraft({ ...draft, stockQuantity: event.target.value })}
                  placeholder={t("catalogue.stockQuantity")}
                  type="number"
                  value={draft.stockQuantity}
                />
                <input
                  className="text-input"
                  onChange={(event) => setDraft({ ...draft, reorderLevel: event.target.value })}
                  placeholder={t("catalogue.reorderLevel")}
                  type="number"
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
            <button className="btn btn-primary btn-sm" onClick={submitItem} type="button">
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
        {items.length === 0 ? (
          <div className="empty-state">{t("catalogue.noProducts")}</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
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
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{categories.find((category) => category.id === item.categoryId)?.name ?? "—"}</td>
                    <td className="num">{formatPrice(item.priceMinor)}</td>
                    <td className="num">{item.costPriceMinor === null ? t("common.dash") : formatPrice(item.costPriceMinor)}</td>
                    {isSupermarket ? <td className="num">{item.stockQuantity ?? t("common.dash")}</td> : null}
                    <td>{item.isAvailable ? t("catalogue.available") : t("catalogue.soldOut")}</td>
                    <td>
                      <div className="filters-row" style={{ margin: 0 }}>
                        {can("MANAGE_ORDERS") ? (
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => void run(() => setBusinessItemAvailability(item.id, !item.isAvailable))}
                            type="button"
                          >
                            {item.isAvailable ? t("catalogue.markSoldOut") : t("catalogue.markAvailable")}
                          </button>
                        ) : null}
                        {canManageProducts ? (
                          <button className="btn btn-outline btn-sm" onClick={() => startEdit(item)} type="button">
                            {t("common.edit")}
                          </button>
                        ) : null}
                        {canManageProducts ? (
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => setPendingDelete(item)}
                            type="button"
                          >
                            {t("common.delete")}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pendingDelete ? (
        <ConfirmModal
          confirmLabel={t("common.delete")}
          description={t("catalogue.deleteConfirmDescription", { name: pendingDelete.name })}
          onCancel={() => setPendingDelete(null)}
          onConfirm={async () => {
            await deleteBusinessItem(pendingDelete.id);
            setPendingDelete(null);
            await load();
          }}
          title={t("catalogue.deleteConfirmTitle")}
        />
      ) : null}
    </div>
  );
}

function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ${currencyCode}`;
}
