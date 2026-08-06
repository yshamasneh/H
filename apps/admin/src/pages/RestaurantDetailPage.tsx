import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  getAdminRestaurant,
  getAdminRestaurantMenu,
  getAdminRestaurantOrders,
  type AdminMenuView,
  type AdminRestaurantView
} from "../api";
import { StatusBadge } from "../components/StatusBadge";

const currencyCode = "ILS";

export function RestaurantDetailPage() {
  const { restaurantId = "" } = useParams();
  const navigate = useNavigate();
  const [restaurant, setRestaurant] = useState<AdminRestaurantView | null>(null);
  const [menu, setMenu] = useState<AdminMenuView | null>(null);
  const [orders, setOrders] = useState<{ id: string; status: string; totalMinor: number; createdAt: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [restaurantData, menuData, ordersData] = await Promise.all([
          getAdminRestaurant(restaurantId),
          getAdminRestaurantMenu(restaurantId),
          getAdminRestaurantOrders(restaurantId)
        ]);
        setRestaurant(restaurantData);
        setMenu(menuData);
        setOrders(ordersData.items);
      } catch (requestError) {
        setError(requestError instanceof ApiError ? requestError.message : "Could not load this restaurant.");
      }
    }
    void load();
  }, [restaurantId]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!restaurant) return <div className="loading-state">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <button className="btn btn-outline btn-sm" onClick={() => navigate("/restaurants")} type="button">
            Back
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
          <div className="stat-label">Total orders</div>
          <div className="stat-value">{restaurant.totalOrdersCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Revenue (delivered)</div>
          <div className="stat-value">{formatPrice(restaurant.revenueMinor)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Currently</div>
          <div className="stat-value" style={{ fontSize: 18 }}>
            {restaurant.isOpen ? "Open" : "Closed"}
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="card">
          <h2 className="card-title">Menu</h2>
          {menu === null || menu.categories.length === 0 ? (
            <div className="empty-state">No menu items yet.</div>
          ) : (
            menu.categories.map((category) => (
              <div key={category.id} style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>
                  {category.name} {category.isActive ? "" : "(inactive)"}
                </div>
                {category.items.map((item) => (
                  <div className="kv-row" key={item.id}>
                    <span className="kv-label">
                      {item.name} {item.isAvailable ? "" : "(unavailable)"}
                    </span>
                    <span className="kv-value">{formatPrice(item.priceMinor)}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="card">
          <h2 className="card-title">Owner</h2>
          <div className="kv-row">
            <span className="kv-label">Name</span>
            <span className="kv-value">{restaurant.ownerFullName}</span>
          </div>
          <div className="kv-row">
            <span className="kv-label">Phone</span>
            <span className="kv-value">{restaurant.ownerPhone}</span>
          </div>

          <h2 className="card-title" style={{ marginTop: 18 }}>
            Recent orders
          </h2>
          {orders === null || orders.length === 0 ? (
            <div className="empty-state">No orders yet.</div>
          ) : (
            orders.slice(0, 10).map((order) => (
              <div className="kv-row" key={order.id}>
                <span className="kv-label">{formatDate(order.createdAt)}</span>
                <span className="kv-value">{formatPrice(order.totalMinor)}</span>
              </div>
            ))
          )}
        </div>
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
