import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createDriver, readApiError, type AdminDriverView } from "../api";
import { generateDriverPassword, isStrongPassword } from "../drivers-view";
import { Field } from "./Field";

/**
 * Creating a driver account — the only way one is made. The administrator enters the driver's
 * name and phone, sets (or generates) the first password, and then sees exactly what to hand the
 * driver to sign in. The account is ready to go on shift at once; no approval step follows.
 */
export function CreateDriverModal(props: { onClose: () => void; onCreated: (driver: AdminDriverView) => void }) {
  const { t } = useTranslation();
  const [fullName, setFullName] = useState("");
  const [countryCode, setCountryCode] = useState("+970");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [password, setPassword] = useState(() => generateDriverPassword());
  const [showPassword, setShowPassword] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ driver: AdminDriverView; password: string } | null>(null);

  const nameError = fullName.trim().length > 0 && fullName.trim().length < 2 ? t("driverAccounts.errors.name") : null;
  const passwordError = password && !isStrongPassword(password) ? t("driverAccounts.errors.password") : null;
  const canSubmit = fullName.trim().length >= 2 && phoneNumber.trim().length >= 7 && isStrongPassword(password) && !submitting;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const driver = await createDriver({ fullName: fullName.trim(), countryCode, phoneNumber: phoneNumber.trim(), password });
      setCreated({ driver, password });
      props.onCreated(driver);
    } catch (requestError) {
      setError(readApiError(requestError, t("common.genericActionError")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="reason-modal-backdrop" onClick={props.onClose}>
      <div aria-modal="true" className="reason-modal driver-modal" onClick={(event) => event.stopPropagation()} role="dialog">
        {created ? (
          <>
            <h3>{t("driverAccounts.createdTitle")}</h3>
            <p>{t("driverAccounts.createdBody", { name: created.driver.fullName })}</p>
            <div className="driver-credentials">
              <div className="kv-row">
                <span className="kv-label">{t("driverAccounts.loginPhone")}</span>
                <bdi className="kv-value" dir="ltr">{created.driver.phone}</bdi>
              </div>
              <div className="kv-row">
                <span className="kv-label">{t("driverAccounts.password")}</span>
                <bdi className="kv-value driver-password" dir="ltr">{created.password}</bdi>
              </div>
            </div>
            <p className="field-hint">{t("driverAccounts.shareHint")}</p>
            <div className="btn-row reason-modal-actions">
              <button
                className="btn btn-outline"
                onClick={() => void navigator.clipboard?.writeText(`${created.driver.phone}\n${created.password}`).catch(() => undefined)}
                type="button"
              >
                {t("driverAccounts.copy")}
              </button>
              <button autoFocus className="btn btn-primary" onClick={props.onClose} type="button">
                {t("common.done")}
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) void submit();
            }}
          >
            <h3>{t("driverAccounts.createTitle")}</h3>
            <p>{t("driverAccounts.createBody")}</p>
            <div className="form-stack">
              <Field error={nameError} label={t("driverAccounts.fullName")}>
                <input autoFocus className="text-input" onChange={(event) => setFullName(event.target.value)} value={fullName} />
              </Field>
              <Field label={t("driverAccounts.phone")}>
                <div className="driver-phone-row" dir="ltr">
                  <select className="select" onChange={(event) => setCountryCode(event.target.value)} value={countryCode}>
                    <option value="+970">+970</option>
                    <option value="+972">+972</option>
                  </select>
                  <input
                    className="text-input"
                    inputMode="tel"
                    onChange={(event) => setPhoneNumber(event.target.value)}
                    placeholder="059XXXXXXX"
                    value={phoneNumber}
                  />
                </div>
              </Field>
              <Field error={passwordError} hint={t("driverAccounts.passwordHint")} label={t("driverAccounts.firstPassword")}>
                <div className="driver-phone-row" dir="ltr">
                  <input
                    className="text-input"
                    onChange={(event) => setPassword(event.target.value)}
                    type={showPassword ? "text" : "password"}
                    value={password}
                  />
                  <button className="btn btn-outline btn-sm" onClick={() => setShowPassword(!showPassword)} type="button">
                    {showPassword ? t("driverAccounts.hide") : t("driverAccounts.show")}
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => setPassword(generateDriverPassword())} type="button">
                    {t("driverAccounts.generate")}
                  </button>
                </div>
              </Field>
            </div>
            {error ? <p className="reason-modal-error">{error}</p> : null}
            <div className="btn-row reason-modal-actions">
              <button className="btn btn-outline" onClick={props.onClose} type="button">
                {t("common.cancel")}
              </button>
              <button className="btn btn-primary" disabled={!canSubmit} type="submit">
                {submitting ? t("common.working") : t("driverAccounts.create")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
