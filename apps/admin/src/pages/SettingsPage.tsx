import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, getPlatformSettings, updatePlatformSettings, type PlatformSettings } from "../api";

export function SettingsPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setSettings(await getPlatformSettings());
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("settings.loadError"));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleSubstitution() {
    if (!settings) return;
    setBusy(true);
    try {
      const updated = await updatePlatformSettings({
        substitutionOptionEnabled: !settings.substitutionOptionEnabled
      });
      setSettings(updated);
      setNotice(t("settings.savedNotice"));
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("common.genericActionError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("settings.title")}</h1>
          <p className="page-subtitle">{t("settings.subtitle")}</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="empty-state">{notice}</div> : null}

      {settings === null ? (
        <div className="card"><div className="loading-state">{t("common.loading")}</div></div>
      ) : (
        <div className="card">
          <h2 className="card-title">{t("settings.substitution.title")}</h2>
          <p className="page-subtitle">{t("settings.substitution.description")}</p>
          <p className="page-subtitle">
            <strong>
              {settings.substitutionOptionEnabled
                ? t("settings.substitution.stateOn")
                : t("settings.substitution.stateOff")}
            </strong>
          </p>
          <div className="btn-row">
            <button
              className={`btn btn-sm ${settings.substitutionOptionEnabled ? "btn-outline" : "btn-primary"}`}
              disabled={busy}
              onClick={() => void toggleSubstitution()}
              type="button"
            >
              {settings.substitutionOptionEnabled
                ? t("settings.substitution.disable")
                : t("settings.substitution.enable")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
