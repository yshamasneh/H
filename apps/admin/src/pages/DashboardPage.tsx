import { useEffect, useState } from "react";
import { ApiError, getDashboard, type DashboardOverview } from "../api";
import { useRealtimeEvent } from "../socket";

const currencyCode = "ILS";

export function DashboardPage() {
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setData(await getDashboard());
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not load the dashboard.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // The dashboard never trusts socket payloads as final state - any live event just triggers a
  // fresh REST fetch, matching the "REST is the source of truth" rule from architecture.md.
  useRealtimeEvent("order.created", () => void load());
  useRealtimeEvent("order.status.changed", () => void load());
  useRealtimeEvent("restaurant.pending.created", () => void load());

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Live overview - updates automatically as orders and approvals change</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {data === null ? (
        <div className="loading-state">Loading...</div>
      ) : (
        <>
          <div className="stat-grid">
            <StatCard hint="Placed since midnight" label="Orders today" value={String(data.ordersToday)} />
            <StatCard
              hint="Excludes cancelled/rejected orders"
              label="Revenue today"
              value={formatPrice(data.revenueTodayMinor)}
            />
            <StatCard hint="Not yet delivered" label="Active deliveries" value={String(data.activeDeliveries)} />
            <StatCard hint="Awaiting approval" label="Pending restaurants" value={String(data.pendingRestaurantApprovals)} />
            <StatCard hint="Approved and online" label="Online drivers" value={String(data.onlineDriversCount)} />
            <StatCard hint="New customers today" label="New signups" value={String(data.newCustomerSignupsToday)} />
          </div>

          <div className="card">
            <h2 className="card-title">Recent activity</h2>
            {data.activityFeed.length === 0 ? (
              <div className="empty-state">No order activity yet.</div>
            ) : (
              data.activityFeed.map((entry) => (
                <div className="activity-item" key={entry.id}>
                  <span>
                    <strong>{entry.restaurantName}</strong> - order moved to {entry.toStatus.replace(/_/g, " ")}
                  </span>
                  <span className="activity-meta">{formatDate(entry.createdAt)}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard(props: { label: string; value: string; hint: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{props.label}</div>
      <div className="stat-value">{props.value}</div>
      <div className="stat-hint">{props.hint}</div>
    </div>
  );
}

function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ${currencyCode}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString();
}
