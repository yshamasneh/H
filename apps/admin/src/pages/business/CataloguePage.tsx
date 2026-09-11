import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  createBusinessCategory,
  createBusinessItem,
  deleteBusinessCategory,
  deleteBusinessItem,
  listBusinessCategories,
  listBusinessItems,
  setBusinessItemAvailability,
  updateBusinessCategory,
  updateBusinessItem
} from "../../api.business";
import { CatalogueManager, type CatalogueApi } from "../../components/CatalogueManager";
import { useAuth } from "../../auth";

/**
 * The store owner's own catalogue, editing the business the signed-in account belongs to (the
 * `/restaurant/me/*` surface). The editing UI itself lives in the shared CatalogueManager, which
 * the super-admin store detail page reuses to manage any store's catalogue.
 */
export function CataloguePage() {
  const { t } = useTranslation();
  const { can, access } = useAuth();

  const isSupermarket = access?.business?.businessType === "SUPERMARKET";

  const api = useMemo<CatalogueApi>(
    () => ({
      listCategories: listBusinessCategories,
      createCategory: createBusinessCategory,
      updateCategory: updateBusinessCategory,
      deleteCategory: deleteBusinessCategory,
      listItems: listBusinessItems,
      createItem: createBusinessItem,
      updateItem: updateBusinessItem,
      deleteItem: deleteBusinessItem,
      setItemAvailability: setBusinessItemAvailability
    }),
    []
  );

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

      <CatalogueManager
        api={api}
        capabilities={{
          isSupermarket,
          canManagePrices: can("MANAGE_PRICES"),
          canManageProducts: can("MANAGE_PRODUCTS"),
          canManageMenu: can("MANAGE_MENU"),
          canManageOrders: can("MANAGE_ORDERS")
        }}
      />
    </div>
  );
}
