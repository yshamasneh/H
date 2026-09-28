import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { fetchAllPages, listAdminRestaurants, readApiError, type RestaurantProfile } from "../api";
import { adminStoreApi } from "../api.business";
import { useAuth } from "../auth";
import { SaleOffersManager, type OffersApi } from "../components/SaleOffersManager";
import { OffersPage } from "./OffersPage";

type Tab = "products" | "campaigns";

/**
 * Offers in the control centre, as two jobs side by side:
 * - Product offers: a store's own sale prices, product by product (MANAGE_BUSINESSES — the same
 *   permission the admin product editor already needs).
 * - Campaigns: platform promotions such as "10% off orders" (MANAGE_OFFERS), unchanged.
 * Each tab only appears for an account holding its permission.
 */
export function OffersHubPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canProducts = can("MANAGE_BUSINESSES");
  const canCampaigns = can("MANAGE_OFFERS");
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = requested === "campaigns" && canCampaigns ? "campaigns" : canProducts ? "products" : "campaigns";

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("offers.title")}</h1>
          <p className="page-subtitle">{t("saleOffers.hubSubtitle")}</p>
        </div>
      </div>
      {canProducts && canCampaigns ? (
        <div className="tab-row" role="tablist">
          {(["products", "campaigns"] as const).map((key) => (
            <button
              aria-selected={key === tab}
              className={`btn btn-sm ${key === tab ? "btn-primary" : "btn-outline"}`}
              key={key}
              onClick={() => setParams(key === "products" ? {} : { tab: key })}
              role="tab"
              type="button"
            >
              {t(`saleOffers.tabs.${key}`)}
            </button>
          ))}
        </div>
      ) : null}
      {tab === "products" ? <ProductOffersForAnyStore /> : <OffersPage embedded />}
    </div>
  );
}

/** Product offers for a chosen store; the one store is picked automatically when there is only one. */
function ProductOffersForAnyStore() {
  const { t } = useTranslation();
  const [stores, setStores] = useState<RestaurantProfile[] | null>(null);
  const [storeId, setStoreId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAllPages((page, pageSize) => listAdminRestaurants({ status: "APPROVED", page, pageSize }))
      .then((result) => {
        setStores(result);
        // Supermarkets first: that is where product offers live today.
        const preferred = result.find((store) => store.businessType === "SUPERMARKET") ?? result[0];
        if (preferred) setStoreId((current) => current || preferred.id);
      })
      .catch((requestError) => setError(readApiError(requestError, t("saleOffers.loadError"))));
  }, [t]);

  const api = useMemo<OffersApi>(() => {
    const store = adminStoreApi(storeId);
    return { listCategories: store.listMenuCategories, listItems: store.listMenuItems, updateItem: store.updateMenuItem };
  }, [storeId]);

  if (error) return <div className="error-banner">{error}</div>;
  if (stores === null) return <div className="loading-state">{t("common.loading")}</div>;
  if (stores.length === 0) return <div className="card empty-state">{t("saleOffers.noStores")}</div>;

  return (
    <>
      {stores.length > 1 ? (
        <div className="filters-row">
          <label className="offers-store-picker">
            <span className="stat-label">{t("saleOffers.store")}</span>
            <select className="select" onChange={(event) => setStoreId(event.target.value)} value={storeId}>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <p className="field-hint">{t("saleOffers.storeLabel", { name: stores[0].name })}</p>
      )}
      {storeId ? <SaleOffersManager api={api} canEdit storeKey={storeId} /> : null}
    </>
  );
}
