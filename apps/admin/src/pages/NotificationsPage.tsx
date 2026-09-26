import { useState } from "react";
import { useTranslation } from "react-i18next";
import { readApiError } from "../api";
import { broadcastAudiences, sendBroadcast, type BroadcastAudience } from "../api.notifications";
import { Field } from "../components/Field";

export function NotificationsPage() {
  const { t } = useTranslation();
  const [audience, setAudience] = useState<BroadcastAudience>("CUSTOMER");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function send() {
    if (title.trim().length < 2 || body.trim().length < 2) {
      setError(t("notifications.messageRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await sendBroadcast({ audience, title: title.trim(), body: body.trim() });
      setNotice(t("notifications.sentNotice", { count: result.recipients }));
      setTitle("");
      setBody("");
    } catch (requestError) {
      setError(readApiError(requestError, t("common.genericActionError")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t("notifications.title")}</h1>
      </div>

      <div className="card">
        <h2 className="card-title">{t("notifications.broadcastTitle")}</h2>
        <p className="page-subtitle">{t("notifications.broadcastDescription")}</p>
        {error ? <div className="error-banner">{error}</div> : null}
        {notice ? <div className="notice-banner">{notice}</div> : null}

        <div className="form-grid">
          <Field label={t("notifications.audience")}>
            <select
              className="select"
              onChange={(event) => setAudience(event.target.value as BroadcastAudience)}
              value={audience}
            >
              {broadcastAudiences.map((value) => (
                <option key={value} value={value}>
                  {t(`notifications.audiences.${value}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field className="span-all" label={t("notifications.messageTitle")}>
            <input className="text-input" maxLength={120} onChange={(event) => setTitle(event.target.value)} value={title} />
          </Field>
          <Field className="span-all" label={t("notifications.messageBody")}>
            <textarea
              className="text-input"
              maxLength={1000}
              onChange={(event) => setBody(event.target.value)}
              rows={4}
              value={body}
            />
          </Field>
        </div>

        <button className="btn btn-primary" disabled={busy} onClick={() => void send()} type="button">
          {t("notifications.send")}
        </button>
      </div>
    </div>
  );
}
