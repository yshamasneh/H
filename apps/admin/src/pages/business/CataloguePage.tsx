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
import { useAuth } from "../../auth";

const currencyCode = "ILS";

type ItemDraft = {
  categoryId: string;
  name: string;
  description: string;
  price: string;
  imageUrl: string;
  sku: string;
  barcode: string;
  unitLabel: string;
  stockQuantity: string;
};

const emptyDraft: ItemDraft = {
  categoryId: "",
  name: "",
  description: "",
  price: "",
  imageUrl: "",
  sku: "",
  barcode: "",
  unitLabel: "item",
  stockQuantity: ""
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

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await load();
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("common.genericActionError"));
    }
  }

  function startEdit(item: MenuItemOwner) {
    setEditingId(item.id);
    setDraft({
      categoryId: item.categoryId,
      name: item.name,
      description: item.description ?? "",
      price: String(item.priceMinor),
      imageUrl: item.imageUrl ?? "",
      sku: item.sku ?? "",
      barcode: item.barcode ?? "",
      unitLabel: item.unitLabel,
      stockQuantity: item.stockQuantity === null ? "" : String(item.stockQuantity)
    });
  }

  function submitItem() {
    const body: Record<string, unknown> = {
      categoryId: draft.categoryId || categories[0]?.id,
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      imageUrl: draft.imageUrl.trim() || undefined,
      unitLabel: draft.unitLabel.trim() || "item"
    };
    // The price field is only ever sent by someone allowed to set prices, and the API enforces the
    // same rule independently.
    if (canManagePrices && draft.price) body.priceMinor = Number(draft.price);
    if (isSupermarket) {
      if (draft.sku.trim()) body.sku = draft.sku.trim();
      if (draft.barcode.trim()) body.barcode = draft.barcode.trim();
      if (draft.stockQuantity !== "") body.stockQuantity = Number(draft.stockQuantity);
    }

    void run(async () => {
      if (editingId) await updateBusinessItem(editingId, body);
      else await createBusinessItem({ ...body, priceMinor: Number(draft.price || 0) });
      setDraft(emptyDraft);
      setEditingId(null);
    });
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
            <input
              className="text-input"
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder={t("catalogue.productName")}
              value={draft.name}
            />
            <input
              className="text-input"
              disabled={!canManagePrices}
              onChange={(event) => setDraft({ ...draft, price: event.target.value })}
              placeholder={canManagePrices ? t("catalogue.priceMinor") : t("catalogue.priceLocked")}
              type="number"
              value={draft.price}
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
            {isSupermarket ? (
              <>
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
                <input
                  className="text-input"
                  onChange={(event) => setDraft({ ...draft, stockQuantity: event.target.value })}
                  placeholder={t("catalogue.stockQuantity")}
                  type="number"
                  value={draft.stockQuantity}
                />
              </>
            ) : null}
          </div>
          <div className="filters-row">
            <button className="btn btn-primary btn-sm" disabled={!draft.name.trim()} onClick={submitItem} type="button">
              {editingId ? t("common.save") : t("catalogue.addProduct")}
            </button>
            {editingId ? (
              <button
                className="btn btn-outline btn-sm"
                onClick={() => {
                  setEditingId(null);
                  setDraft(emptyDraft);
                }}
                type="button"
              >
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
                            onClick={() => void run(() => deleteBusinessItem(item.id))}
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
    </div>
  );
}

function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ${currencyCode}`;
}
