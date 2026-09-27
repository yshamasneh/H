import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { getAdminRestaurant, readApiError, type AdminRestaurantView } from "../../api";
import { NewOrderPopup } from "../../components/NewOrderPopup";
import { FeedbackToast } from "../../components/SoundToggle";
import { StatusBadge } from "../../components/StatusBadge";
import { LiveQueueProvider } from "../../live-queue";
import { AdminStoreWorkspaceProvider, useStoreWorkspace } from "../../store-workspace";

export type AdminStoreOutlet = {
  restaurant: AdminRestaurantView;
  setRestaurant: (update: (current: AdminRestaurantView) => AdminRestaurantView) => void;
};

export function useAdminStore(): AdminStoreOutlet {
  return useOutletContext<AdminStoreOutlet>();
}

/**
 * A store in the admin console, with the same workspace its own team has: its products (the
 * category catalogue), the live order board and each order's packing screen, stock for a
 * supermarket, sales, and staff. Those pages are the business shell's own, running against this
 * store's admin routes (see store-workspace.tsx), so the two views cannot drift apart. What stays
 * admin-only (approval status, public location, owner details) lives on the Overview tab.
 */
export function AdminStoreSection() {
  const { t } = useTranslation();
  const { restaurantId = "" } = useParams();
  const navigate = useNavigate();
  const [restaurant, setRestaurantState] = useState<AdminRestaurantView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRestaurantState(await getAdminRestaurant(restaurantId));
      setError(null);
    } catch (requestError) {
      setError(readApiError(requestError, t("restaurantDetail.loadError")));
    }
  }, [restaurantId, t]);

  useEffect(() => {
    setRestaurantState(null);
    void load();
  }, [load]);

  const business = useMemo(
    () => (restaurant ? { id: restaurant.id, name: restaurant.name, businessType: restaurant.businessType } : null),
    [restaurant?.id, restaurant?.name, restaurant?.businessType]
  );

  if (error) return <div className="error-banner">{error}</div>;
  if (!restaurant || !business) return <div className="loading-state">{t("common.loading")}</div>;

  const outlet: AdminStoreOutlet = {
    restaurant,
    setRestaurant: (update) => setRestaurantState((current) => (current ? update(current) : current))
  };

  return (
    <AdminStoreWorkspaceProvider business={business} refreshBusiness={load}>
      <LiveQueueProvider>
        <div className="page-header">
          <div>
            <button className="btn btn-outline btn-sm" onClick={() => navigate("/restaurants")} type="button">
              {t("common.back")}
            </button>
            <h1 className="page-title" style={{ marginTop: 10 }}>
              {restaurant.name}
            </h1>
            <p className="page-subtitle">{restaurant.addressLine}</p>
          </div>
          <StatusBadge status={restaurant.status} />
        </div>
        <StoreSectionTabs isSupermarket={restaurant.businessType === "SUPERMARKET"} />
        <Outlet context={outlet} />
        <NewOrderPopup />
        <FeedbackToast />
      </LiveQueueProvider>
    </AdminStoreWorkspaceProvider>
  );
}

function StoreSectionTabs({ isSupermarket }: { isSupermarket: boolean }) {
  const { t } = useTranslation();
  const { basePath, can } = useStoreWorkspace();
  const tabs = [
    { to: basePath, label: t("restaurantDetail.overviewTab"), end: true, show: true },
    { to: `${basePath}/orders`, label: t("layout.nav.liveOrders"), end: false, show: can("VIEW_ORDERS") },
    { to: `${basePath}/inventory`, label: t("layout.nav.inventory"), end: false, show: isSupermarket && can("MANAGE_INVENTORY") },
    { to: `${basePath}/reports`, label: t("layout.nav.reports"), end: false, show: can("MANAGE_BUSINESS_SETTINGS") },
    { to: `${basePath}/staff`, label: t("layout.nav.staff"), end: false, show: can("MANAGE_BUSINESS_STAFF") }
  ];
  return (
    <nav aria-label={t("restaurantDetail.sectionsLabel")} className="tab-row store-section-tabs">
      {tabs
        .filter((tab) => tab.show)
        .map((tab) => (
          <NavLink className={({ isActive }) => `btn ${isActive ? "btn-primary" : "btn-outline"}`} end={tab.end} key={tab.to} to={tab.to}>
            {tab.label}
          </NavLink>
        ))}
    </nav>
  );
}
