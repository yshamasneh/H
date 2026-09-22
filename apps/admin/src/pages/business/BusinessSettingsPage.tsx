import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, readApiError } from "../../api";
import { getBusinessProfile, updateBusinessProfile, type BusinessProfile } from "../../api.business";
import { useAuth } from "../../auth";
import { Field } from "../../components/Field";
import { LeafletPicker } from "../../components/LeafletPicker";
import { buildProfileUpdate, profileToDraft, type ProfileDraft } from "../../business-profile";

/**
 * A store's own profile: what it is called, where it is, and when it is open.
 *
 * Until now a store owner could only flip open/closed. The name, address, delivery starting point
 * and opening hours all existed in the API and on mobile but had no place here.
 *
 * The logo is intentionally not on this screen (image handling is separate work); the save sends
 * only the fields that changed, so the logo is never touched.
 */

// The Biddu-enclave service area — the same starting view the platform screens use for a store that
// has no coordinates yet.
const defaultCoordinate = { latitude: 31.83804, longitude: 35.14047 };
const round6 = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

export function BusinessSettingsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canEdit = can("MANAGE_BUSINESS_SETTINGS");
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [error, setError] = useState<{ key?: string; message?: string; field?: keyof ProfileDraft } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await getBusinessProfile();
        setProfile(loaded);
        setDraft(profileToDraft(loaded));
      } catch (requestError) {
        setError({ message: requestError instanceof ApiError ? requestError.message : t("businessSettings.loadError") });
      }
    })();
  }, []);

  if (!profile || !draft) {
    return error ? <div className="error-banner">{error.message}</div> : <div className="loading-state">{t("common.loading")}</div>;
  }

  const patch = (change: Partial<ProfileDraft>) => {
    setNotice(null);
    setDraft((previous) => (previous ? { ...previous, ...change } : previous));
  };
  const fieldError = (field: keyof ProfileDraft) =>
    error?.key && error.field === field ? t(`businessSettings.errors.${error.key}`) : null;

  const save = async () => {
    setNotice(null);
    const result = buildProfileUpdate(draft, profile);
    if (!result.ok) {
      setError({ key: result.error, field: result.field });
      return;
    }
    setError(null);
    if (!result.changed) {
      setNotice(t("businessSettings.nothingToSave"));
      return;
    }
    setBusy(true);
    try {
      const saved = await updateBusinessProfile(result.body);
      setProfile(saved);
      setDraft(profileToDraft(saved));
      setNotice(t("common.saved"));
    } catch (requestError) {
      setError({ message: readApiError(requestError, t("common.genericActionError")) });
    } finally {
      setBusy(false);
    }
  };

  const hasLocation = draft.latitude !== null && draft.longitude !== null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("businessSettings.title")}</h1>
          <p className="page-subtitle">{t("businessSettings.subtitle")}</p>
        </div>
      </div>

      {error?.message ? <div className="error-banner">{error.message}</div> : null}
      {notice ? <div className="notice-banner">{notice}</div> : null}
      {canEdit ? null : <div className="warning-banner">{t("businessSettings.readOnly")}</div>}

      <fieldset disabled={!canEdit || busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="card">
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
          </div>
        </div>

        <div className="card">
          <h2 className="card-title">{t("businessSettings.location")}</h2>
          <p className="page-subtitle">{t("businessSettings.locationHint")}</p>
          {error?.key && error.field === "latitude" ? <div className="field-error">{t(`businessSettings.errors.${error.key}`)}</div> : null}
          {hasLocation ? (
            <div className="map-block">
              <LeafletPicker
                onChange={(value) => patch({ latitude: round6(value.latitude), longitude: round6(value.longitude) })}
                value={{ latitude: draft.latitude!, longitude: draft.longitude! }}
              />
              <p className="field-hint money">
                {t("businessSettings.latitude")} {draft.latitude} · {t("businessSettings.longitude")} {draft.longitude}
              </p>
            </div>
          ) : (
            <div>
              <p className="field-hint">{t("businessSettings.locationUnset")}</p>
              <button
                className="btn btn-outline"
                onClick={() => patch({ latitude: defaultCoordinate.latitude, longitude: defaultCoordinate.longitude })}
                type="button"
              >
                {t("businessSettings.setLocation")}
              </button>
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="card-title">{t("businessSettings.hours")}</h2>
          <p className="page-subtitle">{t("businessSettings.hoursHint")}</p>
          <div className="form-grid">
            <Field error={fieldError("opensAt")} label={t("businessSettings.opensAt")}>
              <input
                className="text-input"
                dir="ltr"
                onChange={(e) => patch({ opensAt: e.target.value })}
                type="time"
                value={draft.opensAt}
              />
            </Field>
            <Field error={fieldError("closesAt")} label={t("businessSettings.closesAt")}>
              <input
                className="text-input"
                dir="ltr"
                onChange={(e) => patch({ closesAt: e.target.value })}
                type="time"
                value={draft.closesAt}
              />
            </Field>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => patch({ opensAt: "", closesAt: "" })} type="button">
            {t("businessSettings.clearHours")}
          </button>
        </div>

        {canEdit ? (
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()} type="button">
            {busy ? t("common.working") : t("businessSettings.save")}
          </button>
        ) : null}
      </fieldset>
    </div>
  );
}
