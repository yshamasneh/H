import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, approveDriver, listAdminDrivers, reactivateDriver, rejectDriver, suspendDriver, type AdminDriverView } from "../api";
import { ReasonModal } from "../components/ReasonModal";
import { StatusBadge } from "../components/StatusBadge";

export function DriversPage() {
  const { t } = useTranslation();
  const [drivers, setDrivers] = useState<AdminDriverView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ driver: AdminDriverView; kind: "reject" | "suspend" } | null>(null);

  async function load() {
    try {
      setDrivers(await listAdminDrivers());
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("drivers.loadError"));
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
      setError(requestError instanceof ApiError ? requestError.message : t("common.genericActionError"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("drivers.title")}</h1>
          <p className="page-subtitle">{t("drivers.subtitle")}</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="card">
        {drivers === null ? (
          <div className="loading-state">{t("common.loading")}</div>
        ) : drivers.length === 0 ? (
          <div className="empty-state">{t("drivers.empty")}</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("common.name")}</th>
                <th>{t("common.phone")}</th>
                <th>{t("common.status")}</th>
                <th>{t("drivers.online")}</th>
                <th>{t("drivers.completedDeliveries")}</th>
                <th>{t("common.actions")}</th>
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
                            {t("common.approve")}
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            disabled={busyId === driver.userId}
                            onClick={() => setModal({ driver, kind: "reject" })}
                            type="button"
                          >
                            {t("common.reject")}
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
                          {t("common.suspend")}
                        </button>
                      ) : null}
                      {driver.status === "SUSPENDED" ? (
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={busyId === driver.userId}
                          onClick={() => act(driver.userId, () => reactivateDriver(driver.userId))}
                          type="button"
                        >
                          {t("common.reactivate")}
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
          confirmLabel={modal.kind === "reject" ? t("drivers.rejectTitle") : t("drivers.suspendTitle")}
          description={
            modal.kind === "reject"
              ? t("drivers.rejectDescription", { name: modal.driver.fullName })
              : t("drivers.suspendDescription", { name: modal.driver.fullName })
          }
          onCancel={() => setModal(null)}
          onConfirm={async (reason) => {
            if (modal.kind === "reject") await rejectDriver(modal.driver.userId, reason);
            else await suspendDriver(modal.driver.userId, reason);
            setModal(null);
            await load();
          }}
          title={modal.kind === "reject" ? t("drivers.rejectTitle") : t("drivers.suspendTitle")}
        />
      ) : null}
    </div>
  );
}
