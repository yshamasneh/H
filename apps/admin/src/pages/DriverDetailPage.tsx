import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  approveDriver,
  getAdminDriver,
  reactivateDriver,
  readApiError,
  rejectDriver,
  setDriverPassword,
  suspendDriver,
  updateDriver,
  type AdminDriverDetail
} from "../api";
import { useAuth } from "../auth";
import { Field } from "../components/Field";
import { Money } from "../components/Money";
import { ReasonModal } from "../components/ReasonModal";
import { StatusBadge } from "../components/StatusBadge";
import { connectionState } from "../driver-tracking";
import { generateDriverPassword, isStrongPassword } from "../drivers-view";
import { connectionBadge } from "./DriversPage";
import { PhoneNumber } from "./UsersPage";

/** The part of a stored "+970599…" number after its country code, for editing. */
function splitPhone(phone: string): { countryCode: string; phoneNumber: string } {
  const match = /^(\+97[02])(\d+)$/.exec(phone);
  return match ? { countryCode: match[1], phoneNumber: `0${match[2]}` } : { countryCode: "+970", phoneNumber: phone };
}

/**
 * One driver: who they are and how to reach them, whether they are on shift right now, what they
 * have delivered, and the account controls — correct the name or phone, set a new password, or
 * suspend / reactivate. Every control maps to an existing MANAGE_DRIVERS endpoint.
 */
export function DriverDetailPage() {
  const { t } = useTranslation();
  const { driverUserId = "" } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [driver, setDriver] = useState<AdminDriverDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ fullName: "", countryCode: "+970", phoneNumber: "" });
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reasonKind, setReasonKind] = useState<"reject" | "suspend" | null>(null);

  async function load() {
    try {
      setDriver(await getAdminDriver(driverUserId));
      setError(null);
    } catch (requestError) {
      setError(readApiError(requestError, t("drivers.loadError")));
    }
  }

  useEffect(() => {
    setDriver(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverUserId]);

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      await load();
      return true;
    } catch (requestError) {
      setError(readApiError(requestError, t("common.genericActionError")));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <button className="btn btn-outline btn-sm" onClick={() => navigate("/drivers")} type="button">
      {t("common.back")}
    </button>
  );
  if (!driver) {
    return (
      <div>
        {back}
        {error ? <div className="error-banner">{error}</div> : <div className="loading-state">{t("common.loading")}</div>}
      </div>
    );
  }

  const connection = connectionState(driver, Date.now());
  const draftValid = draft.fullName.trim().length >= 2 && draft.phoneNumber.trim().length >= 7;

  return (
    <div>
      <div className="page-header">
        <div>
          {back}
          <h1 className="page-title">{driver.fullName}</h1>
          <p className="page-subtitle">
            <StatusBadge status={driver.status} /> <StatusBadge status={connectionBadge(connection)} />
          </p>
        </div>
        <div className="btn-row">
          {driver.status === "APPROVED" ? (
            <button className="btn btn-danger" disabled={busy} onClick={() => setReasonKind("suspend")} type="button">
              {t("common.suspend")}
            </button>
          ) : null}
          {driver.status === "SUSPENDED" ? (
            <button className="btn btn-primary" disabled={busy} onClick={() => void run(() => reactivateDriver(driver.userId), t("driverAccounts.reactivatedNotice"))} type="button">
              {t("common.reactivate")}
            </button>
          ) : null}
          {driver.status === "PENDING" ? (
            <>
              <button className="btn btn-primary" disabled={busy} onClick={() => void run(() => approveDriver(driver.userId), t("driverAccounts.approvedNotice"))} type="button">
                {t("common.approve")}
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={() => setReasonKind("reject")} type="button">
                {t("common.reject")}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="notice-banner">{notice}</div> : null}
      {driver.status === "SUSPENDED" ? <div className="warning-banner">{t("driverAccounts.suspendedBanner")}</div> : null}

      <div className="detail-grid">
        <div className="card">
          <h2 className="card-title">{t("driverAccounts.accountTitle")}</h2>
          {editing ? (
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                if (!draftValid) return;
                void run(
                  () => updateDriver(driver.userId, { fullName: draft.fullName.trim(), countryCode: draft.countryCode, phoneNumber: draft.phoneNumber.trim() }),
                  t("driverAccounts.savedNotice")
                ).then((ok) => ok && setEditing(false));
              }}
            >
              <Field label={t("driverAccounts.fullName")}>
                <input autoFocus className="text-input" onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} value={draft.fullName} />
              </Field>
              <Field hint={t("driverAccounts.phoneChangeHint")} label={t("driverAccounts.phone")}>
                <div className="driver-phone-row" dir="ltr">
                  <select className="select" onChange={(event) => setDraft({ ...draft, countryCode: event.target.value })} value={draft.countryCode}>
                    <option value="+970">+970</option>
                    <option value="+972">+972</option>
                  </select>
                  <input className="text-input" inputMode="tel" onChange={(event) => setDraft({ ...draft, phoneNumber: event.target.value })} value={draft.phoneNumber} />
                </div>
              </Field>
              <div className="btn-row">
                <button className="btn btn-primary btn-sm" disabled={busy || !draftValid} type="submit">
                  {t("driverAccounts.save")}
                </button>
                <button className="btn btn-outline btn-sm" onClick={() => setEditing(false)} type="button">
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="kv-row">
                <span className="kv-label">{t("driverAccounts.loginPhone")}</span>
                <span className="kv-value">
                  <PhoneNumber phone={driver.phone} />
                </span>
              </div>
              <div className="kv-row">
                <span className="kv-label">{t("driverAccounts.onShift")}</span>
                <span className="kv-value">{driver.isOnline ? t("common.yes") : t("common.no")}</span>
              </div>
              <div className="kv-row">
                <span className="kv-label">{t("driverAccounts.lastLocation")}</span>
                <span className="kv-value">{driver.lastLocationAt ? new Date(driver.lastLocationAt).toLocaleString() : "—"}</span>
              </div>
              <div className="kv-row">
                <span className="kv-label">{t("driverAccounts.created")}</span>
                <span className="kv-value">{new Date(driver.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="btn-row" style={{ marginTop: 12 }}>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    setDraft({ fullName: driver.fullName, ...splitPhone(driver.phone) });
                    setEditing(true);
                  }}
                  type="button"
                >
                  {t("driverAccounts.edit")}
                </button>
                <button className="btn btn-outline btn-sm" onClick={() => setNewPassword(generateDriverPassword())} type="button">
                  {t("driverAccounts.resetPassword")}
                </button>
              </div>
            </>
          )}
          {newPassword !== null ? (
            <div className="driver-reset">
              <Field
                error={newPassword && !isStrongPassword(newPassword) ? t("driverAccounts.errors.password") : null}
                hint={t("driverAccounts.resetHint")}
                label={t("driverAccounts.newPassword")}
              >
                <div className="driver-phone-row" dir="ltr">
                  <input className="text-input" onChange={(event) => setNewPassword(event.target.value)} value={newPassword} />
                  <button className="btn btn-outline btn-sm" onClick={() => setNewPassword(generateDriverPassword())} type="button">
                    {t("driverAccounts.generate")}
                  </button>
                </div>
              </Field>
              <div className="btn-row">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy || !isStrongPassword(newPassword)}
                  onClick={() =>
                    void run(() => setDriverPassword(driver.userId, newPassword), t("driverAccounts.passwordSetNotice", { password: newPassword })).then(
                      (ok) => ok && setNewPassword(null)
                    )
                  }
                  type="button"
                >
                  {t("driverAccounts.setPassword")}
                </button>
                <button className="btn btn-outline btn-sm" onClick={() => setNewPassword(null)} type="button">
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="card">
          <h2 className="card-title">{t("driverAccounts.workTitle")}</h2>
          <div className="kv-row">
            <span className="kv-label">{t("drivers.completedDeliveries")}</span>
            <span className="kv-value">{driver.completedDeliveriesCount}</span>
          </div>
          <div className="kv-row">
            <span className="kv-label">{t("driverAccounts.failedDeliveries")}</span>
            <span className="kv-value">{driver.failedDeliveriesCount}</span>
          </div>
          <div className="kv-row">
            <span className="kv-label">{t("driverAccounts.activeDelivery")}</span>
            <span className="kv-value">
              {driver.activeDeliveryId ? t("driverAccounts.activeYes") : t("driverAccounts.activeNo")}
            </span>
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <Link className="btn btn-outline btn-sm" to="/drivers/live">
              {t("liveDrivers.openMap")}
            </Link>
            {can("VIEW_ACCOUNTING") ? (
              <Link className="btn btn-outline btn-sm" to="/accounting?tab=cash">
                {t("driverAccounts.cash")}
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">{t("driverAccounts.recentTitle")}</h2>
        {driver.recentDeliveries.length === 0 ? (
          <div className="empty-state">{t("driverAccounts.noDeliveries")}</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("driverAccounts.order")}</th>
                  <th>{t("driverAccounts.store")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("driverAccounts.total")}</th>
                  <th>{t("driverAccounts.assigned")}</th>
                  <th>{t("driverAccounts.finished")}</th>
                </tr>
              </thead>
              <tbody>
                {driver.recentDeliveries.map((delivery) => (
                  <tr key={delivery.deliveryId}>
                    <td>
                      {can("VIEW_ALL_ORDERS") ? (
                        <Link to={`/orders/${delivery.orderId}`}>#{delivery.orderId.slice(0, 8)}</Link>
                      ) : (
                        `#${delivery.orderId.slice(0, 8)}`
                      )}
                    </td>
                    <td>{delivery.storeName}</td>
                    <td>
                      <StatusBadge status={delivery.status} />
                    </td>
                    <td>
                      <Money minor={delivery.totalMinor} />
                    </td>
                    <td>{delivery.assignedAt ? new Date(delivery.assignedAt).toLocaleString() : "—"}</td>
                    <td>{delivery.finishedAt ? new Date(delivery.finishedAt).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {reasonKind ? (
        <ReasonModal
          confirmLabel={reasonKind === "reject" ? t("drivers.rejectTitle") : t("drivers.suspendTitle")}
          description={
            reasonKind === "reject"
              ? t("drivers.rejectDescription", { name: driver.fullName })
              : t("drivers.suspendDescription", { name: driver.fullName })
          }
          onCancel={() => setReasonKind(null)}
          onConfirm={async (reason) => {
            if (reasonKind === "reject") await rejectDriver(driver.userId, reason);
            else await suspendDriver(driver.userId, reason);
            setReasonKind(null);
            setNotice(reasonKind === "reject" ? t("driverAccounts.rejectedNotice") : t("driverAccounts.suspendedNotice"));
            await load();
          }}
          title={reasonKind === "reject" ? t("drivers.rejectTitle") : t("drivers.suspendTitle")}
        />
      ) : null}
    </div>
  );
}
