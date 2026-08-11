import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  approveRestaurant,
  createBusiness,
  listAdminRestaurants,
  reactivateRestaurant,
  rejectRestaurant,
  suspendRestaurant,
  type RestaurantProfile
} from "../api";
import { useAuth } from "../auth";
import { ReasonModal } from "../components/ReasonModal";
import { StatusBadge } from "../components/StatusBadge";
import { useRealtimeEvent } from "../socket";

const statusOptions = ["", "PENDING", "APPROVED", "REJECTED", "SUSPENDED"];

export function RestaurantsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { can } = useAuth();
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
      setError(requestError instanceof ApiError ? requestError.message : t("restaurants.loadError"));
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
      setError(requestError instanceof ApiError ? requestError.message : t("common.genericActionError"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("restaurants.title")}</h1>
          <p className="page-subtitle">{t("restaurants.subtitle")}</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {can("MANAGE_BUSINESSES") ? <CreateBusinessCard onCreated={() => void load()} /> : null}

      <div className="card">
        <div className="filters-row">
          <select className="select" onChange={(event) => setStatus(event.target.value)} value={status}>
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option ? t(`status.${option}`) : t("restaurants.allStatuses")}
              </option>
            ))}
          </select>
        </div>

        {restaurants === null ? (
          <div className="loading-state">{t("common.loading")}</div>
        ) : restaurants.length === 0 ? (
          <div className="empty-state">{t("restaurants.empty")}</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("common.name")}</th>
                <th>{t("restaurants.address")}</th>
                <th>{t("common.status")}</th>
                <th>{t("common.open")}</th>
                <th>{t("common.actions")}</th>
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
                  <td>{restaurant.isOpen ? t("common.open") : t("common.closed")}</td>
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
                            {t("common.approve")}
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            disabled={busyId === restaurant.id}
                            onClick={() => act(restaurant.id, () => rejectRestaurant(restaurant.id))}
                            type="button"
                          >
                            {t("common.reject")}
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
                          {t("common.suspend")}
                        </button>
                      ) : null}
                      {restaurant.status === "SUSPENDED" ? (
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={busyId === restaurant.id}
                          onClick={() => act(restaurant.id, () => reactivateRestaurant(restaurant.id))}
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

      {suspendTarget ? (
        <ReasonModal
          confirmLabel={t("restaurants.suspendConfirm")}
          description={t("restaurants.suspendDescription", { name: suspendTarget.name })}
          onCancel={() => setSuspendTarget(null)}
          onConfirm={async (reason) => {
            await suspendRestaurant(suspendTarget.id, reason);
            setSuspendTarget(null);
            await load();
          }}
          title={t("restaurants.suspendTitle")}
        />
      ) : null}
    </div>
  );
}

/**
 * Creates a business together with its owner account. The API delegates to the same registration
 * path a self-signup uses, so the owner always gets the membership row that grants them access.
 */
function CreateBusinessCard({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    businessName: "",
    ownerFullName: "",
    countryCode: "+970",
    phoneNumber: "",
    password: "",
    addressLine: "",
    businessType: "RESTAURANT" as "RESTAURANT" | "SUPERMARKET",
    approveImmediately: true
  });

  const isComplete =
    draft.businessName.trim() &&
    draft.ownerFullName.trim() &&
    draft.phoneNumber.trim() &&
    draft.addressLine.trim() &&
    draft.password.length >= 8;

  return (
    <div className="card">
      <h2 className="card-title">{t("restaurants.createTitle")}</h2>
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="empty-state">{notice}</div> : null}
      <div className="filters-row">
        <select
          className="select"
          onChange={(event) =>
            setDraft({ ...draft, businessType: event.target.value as "RESTAURANT" | "SUPERMARKET" })
          }
          value={draft.businessType}
        >
          <option value="RESTAURANT">{t("restaurants.typeRestaurant")}</option>
          <option value="SUPERMARKET">{t("restaurants.typeSupermarket")}</option>
        </select>
        <input
          className="text-input"
          onChange={(event) => setDraft({ ...draft, businessName: event.target.value })}
          placeholder={t("restaurants.businessName")}
          value={draft.businessName}
        />
        <input
          className="text-input"
          onChange={(event) => setDraft({ ...draft, addressLine: event.target.value })}
          placeholder={t("restaurants.addressLine")}
          value={draft.addressLine}
        />
      </div>
      <div className="filters-row">
        <input
          className="text-input"
          onChange={(event) => setDraft({ ...draft, ownerFullName: event.target.value })}
          placeholder={t("restaurants.ownerFullName")}
          value={draft.ownerFullName}
        />
        <input
          className="text-input"
          onChange={(event) => setDraft({ ...draft, countryCode: event.target.value })}
          placeholder={t("restaurants.countryCode")}
          style={{ maxWidth: 90 }}
          value={draft.countryCode}
        />
        <input
          className="text-input"
          onChange={(event) => setDraft({ ...draft, phoneNumber: event.target.value })}
          placeholder={t("restaurants.ownerPhone")}
          value={draft.phoneNumber}
        />
        <input
          className="text-input"
          onChange={(event) => setDraft({ ...draft, password: event.target.value })}
          placeholder={t("restaurants.ownerPassword")}
          type="password"
          value={draft.password}
        />
        <select
          className="select"
          onChange={(event) => setDraft({ ...draft, approveImmediately: event.target.value === "true" })}
          value={String(draft.approveImmediately)}
        >
          <option value="true">{t("restaurants.approveNow")}</option>
          <option value="false">{t("restaurants.leavePending")}</option>
        </select>
        <button
          className="btn btn-primary btn-sm"
          disabled={!isComplete}
          onClick={async () => {
            try {
              await createBusiness({
                businessName: draft.businessName.trim(),
                ownerFullName: draft.ownerFullName.trim(),
                countryCode: draft.countryCode.trim(),
                phoneNumber: draft.phoneNumber.trim(),
                password: draft.password,
                addressLine: draft.addressLine.trim(),
                businessType: draft.businessType,
                approveImmediately: draft.approveImmediately
              });
              setNotice(t("restaurants.createdNotice"));
              setError(null);
              setDraft({ ...draft, businessName: "", ownerFullName: "", phoneNumber: "", password: "", addressLine: "" });
              onCreated();
            } catch (requestError) {
              setError(requestError instanceof ApiError ? requestError.message : t("common.genericActionError"));
            }
          }}
          type="button"
        >
          {t("restaurants.create")}
        </button>
      </div>
      <div className="empty-state">{t("restaurants.createHint")}</div>
    </div>
  );
}
