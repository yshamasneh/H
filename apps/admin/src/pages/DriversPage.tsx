import { useEffect, useState } from "react";
import { ApiError, approveDriver, listAdminDrivers, reactivateDriver, rejectDriver, suspendDriver, type AdminDriverView } from "../api";
import { ReasonModal } from "../components/ReasonModal";
import { StatusBadge } from "../components/StatusBadge";

export function DriversPage() {
  const [drivers, setDrivers] = useState<AdminDriverView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ driver: AdminDriverView; kind: "reject" | "suspend" } | null>(null);

  async function load() {
    try {
      setDrivers(await listAdminDrivers());
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not load drivers.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function act(userId: string, action: () => Promise<unknown>) {
    setBusyId(userId);
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
          <h1 className="page-title">Drivers</h1>
          <p className="page-subtitle">Approve applications and manage online drivers</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="card">
        {drivers === null ? (
          <div className="loading-state">Loading...</div>
        ) : drivers.length === 0 ? (
          <div className="empty-state">No drivers yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Online</th>
                <th>Completed deliveries</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((driver) => (
                <tr key={driver.userId}>
                  <td>{driver.fullName}</td>
                  <td>{driver.phone}</td>
                  <td>
                    <StatusBadge status={driver.status} />
                  </td>
                  <td>
                    <StatusBadge status={driver.isOnline ? "ONLINE" : "OFFLINE"} />
                  </td>
                  <td>{driver.completedDeliveriesCount}</td>
                  <td>
                    <div className="btn-row">
                      {driver.status === "PENDING" ? (
                        <>
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={busyId === driver.userId}
                            onClick={() => act(driver.userId, () => approveDriver(driver.userId))}
                            type="button"
                          >
                            Approve
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            disabled={busyId === driver.userId}
                            onClick={() => setModal({ driver, kind: "reject" })}
                            type="button"
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                      {driver.status === "APPROVED" ? (
                        <button
                          className="btn btn-danger btn-sm"
                          disabled={busyId === driver.userId}
                          onClick={() => setModal({ driver, kind: "suspend" })}
                          type="button"
                        >
                          Suspend
                        </button>
                      ) : null}
                      {driver.status === "SUSPENDED" ? (
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={busyId === driver.userId}
                          onClick={() => act(driver.userId, () => reactivateDriver(driver.userId))}
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

      {modal ? (
        <ReasonModal
          confirmLabel={modal.kind === "reject" ? "Reject driver" : "Suspend driver"}
          description={`This will ${modal.kind} ${modal.driver.fullName}'s driver account.`}
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => {
            if (modal.kind === "reject") await rejectDriver(modal.driver.userId, reason);
            else await suspendDriver(modal.driver.userId, reason);
            setModal(null);
            await load();
          }}
          title={modal.kind === "reject" ? "Reject driver" : "Suspend driver"}
        />
      ) : null}
    </div>
  );
}
