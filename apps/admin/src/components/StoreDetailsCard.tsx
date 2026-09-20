import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, updateAdminRestaurant, type RestaurantProfile } from "../api";
import { buildProfileUpdate, profileToDraft, type ProfileDraft } from "../business-profile";
import { Field } from "./Field";

/**
 * A platform admin editing a store's name, description, address and opening hours.
 *
 * Coordinates and the customer-visibility flag have their own card next to this one, and a store's
 * status (approved / suspended) changes through its own actions, so none of those are on this form.
 * The same validation the store owner's own settings screen uses is applied here, so the two can
 * never disagree about what a valid profile is; only fields that changed are sent.
 */
export function StoreDetailsCard({
  restaurant,
  onUpdated
}: {
  restaurant: RestaurantProfile;
  onUpdated: (profile: RestaurantProfile) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ProfileDraft>(() => profileToDraft(restaurant));
  const [error, setError] = useState<{ key?: string; message?: string; field?: keyof ProfileDraft } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (change: Partial<ProfileDraft>) => {
    setNotice(null);
    setDraft((previous) => ({ ...previous, ...change }));
  };
  const fieldError = (field: keyof ProfileDraft) =>
    error?.key && error.field === field ? t(`businessSettings.errors.${error.key}`) : null;

  const save = async () => {
    setNotice(null);
    const result = buildProfileUpdate(draft, restaurant);
    if (!result.ok) return setError({ key: result.error, field: result.field });
    setError(null);
    if (!result.changed) return setNotice(t("businessSettings.nothingToSave"));
    setBusy(true);
    try {
      const saved = await updateAdminRestaurant(restaurant.id, result.body);
      onUpdated(saved);
      setDraft(profileToDraft(saved));
      setNotice(t("common.saved"));
    } catch (requestError) {
      setError({ message: requestError instanceof ApiError ? requestError.message : t("common.genericActionError") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2 className="card-title">{t("restaurantDetail.detailsTitle")}</h2>
      <p className="page-subtitle">{t("restaurantDetail.detailsHint")}</p>
      {error?.message ? <div className="error-banner">{error.message}</div> : null}
      {notice ? <div className="notice-banner">{notice}</div> : null}
      <div className="form-grid">
        <Field error={fieldError("name")} label={t("businessSettings.name")}>
          <input className="text-input" maxLength={120} onChange={(e) => patch({ name: e.target.value })} value={draft.name} />
        </Field>
        <Field error={fieldError("addressLine")} label={t("businessSettings.address")}>
          <input
            className="text-input"
            maxLength={200}
            onChange={(e) => patch({ addressLine: e.target.value })}
            value={draft.addressLine}
          />
        </Field>
        <Field className="span-all" error={fieldError("description")} label={t("businessSettings.description")}>
          <textarea
            className="text-input"
            maxLength={500}
            onChange={(e) => patch({ description: e.target.value })}
            value={draft.description}
          />
        </Field>
        <Field error={fieldError("opensAt")} label={t("businessSettings.opensAt")}>
          <input className="text-input" dir="ltr" onChange={(e) => patch({ opensAt: e.target.value })} type="time" value={draft.opensAt} />
        </Field>
        <Field error={fieldError("closesAt")} label={t("businessSettings.closesAt")}>
          <input className="text-input" dir="ltr" onChange={(e) => patch({ closesAt: e.target.value })} type="time" value={draft.closesAt} />
        </Field>
      </div>
      <p className="field-hint">{t("businessSettings.hoursHint")}</p>
      <button className="btn btn-primary" disabled={busy} onClick={() => void save()} type="button">
        {busy ? t("common.working") : t("businessSettings.save")}
      </button>
    </div>
  );
}
