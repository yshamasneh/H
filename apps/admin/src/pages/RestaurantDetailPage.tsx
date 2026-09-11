import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  getAdminRestaurant,
  getAdminRestaurantOrders,
  updateStoreLocation,
  type AdminRestaurantView
} from "../api";
import {
  createStoreCategory,
  createStoreItem,
  deleteStoreCategory,
  deleteStoreItem,
  listStoreCategories,
  listStoreItems,
  setStoreItemAvailability,
  updateStoreCategory,
  updateStoreItem
} from "../api.business";
import { CatalogueManager, type CatalogueApi } from "../components/CatalogueManager";
import { LeafletPicker, type PickerCoordinate } from "../components/LeafletPicker";
import { StatusBadge } from "../components/StatusBadge";

const currencyCode = "ILS";
// The Biddu-enclave service area — a sensible starting view before an admin taps to set a store
// that has no coordinates yet. Matches the landmarks screen default.
const defaultCoordinate: PickerCoordinate = { latitude: 31.83804, longitude: 35.14047 };

export function RestaurantDetailPage() {
  const { t } = useTranslation();
  const { restaurantId = "" } = useParams();
  const navigate = useNavigate();
  const [restaurant, setRestaurant] = useState<AdminRestaurantView | null>(null);
  const [orders, setOrders] = useState<{ id: string; status: string; totalMinor: number; createdAt: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [restaurantData, ordersData] = await Promise.all([
          getAdminRestaurant(restaurantId),
          getAdminRestaurantOrders(restaurantId)
        ]);
        setRestaurant(restaurantData);
        setOrders(ordersData.items);
      } catch (requestError) {
        setError(requestError instanceof ApiError ? requestError.message : t("restaurantDetail.loadError"));
      }
    }
    void load();
  }, [restaurantId]);

  // Bind the store-scoped admin catalogue endpoints to this store's id so the shared
  // CatalogueManager can drive full product CRUD without knowing which store it edits.
  const catalogueApi = useMemo<CatalogueApi>(
    () => ({
      listCategories: () => listStoreCategories(restaurantId),
      createCategory: (body) => createStoreCategory(restaurantId, body),
      updateCategory: (categoryId, body) => updateStoreCategory(restaurantId, categoryId, body),
      deleteCategory: (categoryId) => deleteStoreCategory(restaurantId, categoryId),
      listItems: () => listStoreItems(restaurantId),
      createItem: (body) => createStoreItem(restaurantId, body),
      updateItem: (itemId, body) => updateStoreItem(restaurantId, itemId, body),
      deleteItem: (itemId) => deleteStoreItem(restaurantId, itemId),
      setItemAvailability: (itemId, isAvailable) => setStoreItemAvailability(restaurantId, itemId, isAvailable)
    }),
    [restaurantId]
  );

  if (error) return <div className="error-banner">{error}</div>;
  if (!restaurant) return <div className="loading-state">{t("common.loading")}</div>;

  return (
    <div>
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

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">{t("restaurantDetail.totalOrders")}</div>
          <div className="stat-value">{restaurant.totalOrdersCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t("restaurantDetail.revenueDelivered")}</div>
          <div className="stat-value">{formatPrice(restaurant.revenueMinor)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t("restaurantDetail.currently")}</div>
          <div className="stat-value stat-value-sm">
            {restaurant.isOpen ? t("common.open") : t("common.closed")}
          </div>
        </div>
      </div>

      <StoreLocationCard
        restaurant={restaurant}
        onUpdated={(profile) => setRestaurant((current) => (current ? { ...current, ...profile } : current))}
      />

      <div className="card">
        <h2 className="card-title">{t("restaurantDetail.owner")}</h2>
        <div className="kv-row">
          <span className="kv-label">{t("common.name")}</span>
          <span className="kv-value">{restaurant.ownerFullName}</span>
        </div>
        <div className="kv-row">
          <span className="kv-label">{t("common.phone")}</span>
          <span className="kv-value">{restaurant.ownerPhone}</span>
        </div>

        <h2 className="card-title" style={{ marginTop: 18 }}>
          {t("restaurantDetail.recentOrders")}
        </h2>
        {orders === null || orders.length === 0 ? (
          <div className="empty-state">{t("restaurantDetail.noOrders")}</div>
        ) : (
          orders.slice(0, 10).map((order) => (
            <div className="kv-row" key={order.id}>
              <span className="kv-label">{formatDate(order.createdAt)}</span>
              <span className="kv-value">{formatPrice(order.totalMinor)}</span>
            </div>
          ))
        )}
      </div>

      <h2 className="card-title" style={{ marginTop: 4 }}>{t("restaurantDetail.products")}</h2>
      {/* Full product CRUD over this store, admin-scoped. Reuses the same editor the store owner
          sees in their own portal; the admin always holds full price control. */}
      <CatalogueManager
        api={catalogueApi}
        capabilities={{
          isSupermarket: restaurant.businessType === "SUPERMARKET",
          canManagePrices: true,
          canManageProducts: true,
          canManageMenu: true,
          canManageOrders: true
        }}
      />
    </div>
  );
}

/**
 * Sets a store's location and whether customers may see it. The map picker is the same Leaflet
 * component the landmarks screen uses. The toggle is admin-only — it is deliberately absent from
 * the store owner's own profile editor, because whether a store's address is public is a platform
 * decision per store, not the owner's to make.
 */
function StoreLocationCard(props: {
  restaurant: AdminRestaurantView;
  onUpdated: (profile: AdminRestaurantView) => void;
}) {
  const { t } = useTranslation();
  const hasCoordinates = props.restaurant.latitude !== null && props.restaurant.longitude !== null;
  const [coordinate, setCoordinate] = useState<PickerCoordinate>(
    hasCoordinates
      ? { latitude: props.restaurant.latitude as number, longitude: props.restaurant.longitude as number }
      : defaultCoordinate
  );
  const [coordinateSet, setCoordinateSet] = useState(hasCoordinates);
  const [addressLine, setAddressLine] = useState(props.restaurant.addressLine);
  const [showLocation, setShowLocation] = useState(props.restaurant.showLocationToCustomer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateStoreLocation(props.restaurant.id, {
        addressLine: addressLine.trim() || undefined,
        latitude: coordinateSet ? coordinate.latitude : undefined,
        longitude: coordinateSet ? coordinate.longitude : undefined,
        showLocationToCustomer: showLocation
      });
      props.onUpdated(updated as AdminRestaurantView);
      setNotice(t("restaurantDetail.locationSaved"));
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("common.genericActionError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="card-title">{t("restaurantDetail.locationTitle")}</h2>
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="empty-state">{notice}</div> : null}
      <div className="filters-row">
        <input
          className="text-input"
          onChange={(event) => setAddressLine(event.target.value)}
          placeholder={t("restaurants.addressLine")}
          value={addressLine}
        />
      </div>
      <p className="page-subtitle">{t("restaurantDetail.locationHint")}</p>
      <LeafletPicker
        onChange={(value) => {
          setCoordinate(value);
          setCoordinateSet(true);
        }}
        value={coordinate}
      />
      <div className="empty-state">
        {coordinateSet
          ? t("landmarks.coordinates", { lat: coordinate.latitude.toFixed(5), lng: coordinate.longitude.toFixed(5) })
          : t("restaurantDetail.locationUnset")}
      </div>
      <label className="checkbox-row" style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0" }}>
        <input
          checked={showLocation}
          onChange={(event) => setShowLocation(event.target.checked)}
          type="checkbox"
        />
        <span>{t("restaurantDetail.showLocationToCustomer")}</span>
      </label>
      <div className="btn-row">
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()} type="button">
          {busy ? t("common.working") : t("restaurantDetail.saveLocation")}
        </button>
      </div>
    </div>
  );
}

function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ${currencyCode}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}
