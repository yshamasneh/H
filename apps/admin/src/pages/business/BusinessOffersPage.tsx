import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SaleOffersManager, type OffersApi } from "../../components/SaleOffersManager";
import { useStoreWorkspace } from "../../store-workspace";

/**
 * A store's product offers. The same page serves the store's own manager (business shell) and an
 * administrator inside that store's section of the console; the workspace supplies which API it
 * calls and what the account may do. Changing a sale price needs MANAGE_PRICES as well as
 * MANAGE_PRODUCTS — the rule the API applies to the product editor — so without them the offers are
 * shown read-only.
 */
export function BusinessOffersPage() {
  const { t } = useTranslation();
  const { can, business, api } = useStoreWorkspace();
  const offersApi = useMemo<OffersApi>(
    () => ({ listCategories: api.listMenuCategories, listItems: api.listMenuItems, updateItem: api.updateMenuItem }),
    [api]
  );
  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">{t("saleOffers.storeTitle")}</h2>
          <p className="page-subtitle">{t("saleOffers.storeSubtitle")}</p>
        </div>
      </div>
      <SaleOffersManager
        api={offersApi}
        canEdit={can("MANAGE_PRICES") && can("MANAGE_PRODUCTS")}
        storeKey={business?.id ?? "own"}
      />
    </div>
  );
}
