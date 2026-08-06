import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  approveRestaurant,
  listAdminRestaurants,
  reactivateRestaurant,
  rejectRestaurant,
  suspendRestaurant,
  type RestaurantProfile
} from "../api";
import { ReasonModal } from "../components/ReasonModal";
import { StatusBadge } from "../components/StatusBadge";
import { useRealtimeEvent } from "../socket";

const statusOptions = ["", "PENDING", "APPROVED", "REJECTED", "SUSPENDED"];

export function RestaurantsPage() {
  const navigate = useNavigate();
  const [restaurants, setRestaurants] = useState<RestaurantProfile[] | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<RestaurantProfile | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      const page = await listAdminRestaurants(status ? { status } : {});
      setRestaurants(page.items);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not load restaurants.");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useRealtimeEvent("restaurant.pending.created", () => void load());

  async function act(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await action();
      await load();
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "This action could not be completed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Restaurants</h1>
          <p className="page-subtitle">Approve applications, and suspend or reactivate live restaurants</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="card">
        <div className="filters-row">
          <select className="select" onChange={(event) => setStatus(event.target.value)} value={status}>
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option || "All statuses"}
              </option>
            ))}
          </select>
        </div>

        {restaurants === null ? (
          <div className="loading-state">Loading...</div>
        ) : restaurants.length === 0 ? (
          <div className="empty-state">No restaurants match this filter.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Address</th>
                <th>Status</th>
                <th>Open</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {restaurants.map((restaurant) => (
                <tr className="clickable" key={restaurant.id}>
                  <td onClick={() => navigate(`/restaurants/${restaurant.id}`)}>{restaurant.name}</td>
                  <td onClick={() => navigate(`/restaurants/${restaurant.id}`)}>{restaurant.addressLine}</td>
                  <td>
                    <StatusBadge status={restaurant.status} />
                  </td>
                  <td>{restaurant.isOpen ? "Open" : "Closed"}</td>
                  <td>
                    <div className="btn-row">
                      {restaurant.status === "PENDING" ? (
                        <>
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={busyId === restaurant.id}
                            onClick={() => act(restaurant.id, () => approveRestaurant(restaurant.id))}
                            type="button"
                          >
                            Approve
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            disabled={busyId === restaurant.id}
                            onClick={() => act(restaurant.id, () => rejectRestaurant(restaurant.id))}
                            type="button"
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                      {restaurant.status === "APPROVED" ? (
                        <button
                          className="btn btn-danger btn-sm"
                          disabled={busyId === restaurant.id}
                          onClick={() => setSuspendTarget(restaurant)}
                          type="button"
                        >
                          Suspend
                        </button>
                      ) : null}
                      {restaurant.status === "SUSPENDED" ? (
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={busyId === restaurant.id}
                          onClick={() => act(restaurant.id, () => reactivateRestaurant(restaurant.id))}
                          type="button"
                        >
                          Reactivate
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {suspendTarget ? (
        <ReasonModal
          confirmLabel="Suspend restaurant"
          description={`Suspending "${suspendTarget.name}" will close it to new orders immediately.`}
          onCancel={() => setSuspendTarget(null)}
          onConfirm={async (reason) => {
            await suspendRestaurant(suspendTarget.id, reason);
            setSuspendTarget(null);
            await load();
          }}
          title="Suspend restaurant"
        />
      ) : null}
    </div>
  );
}
