import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth";

export function LoginPage() {
  const { t } = useTranslation();
  const { signIn, error } = useAuth();
  const [countryCode, setCountryCode] = useState("+970");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await signIn(countryCode, phoneNumber, password);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <h1 className="login-title">{t("login.title")}</h1>
        <p className="login-subtitle">{t("login.subtitle")}</p>

        {error ? <div className="error-banner">{error}</div> : null}

        <label className="field-label" htmlFor="phone">
          {t("login.phoneLabel")}
        </label>
        <div className="field-row">
          <select className="select" onChange={(event) => setCountryCode(event.target.value)} value={countryCode}>
            <option value="+970">+970</option>
            <option value="+972">+972</option>
          </select>
          <input
            className="text-input"
            id="phone"
            onChange={(event) => setPhoneNumber(event.target.value)}
            placeholder="0590000001"
            value={phoneNumber}
          />
        </div>

        <label className="field-label" htmlFor="password">
          {t("login.passwordLabel")}
        </label>
        <input
          className="text-input full-width"
          id="password"
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          value={password}
        />

        <button className="btn btn-primary full-width" disabled={submitting} style={{ marginTop: 20 }} type="submit">
          {submitting ? t("login.signingIn") : t("login.signIn")}
        </button>
      </form>
    </div>
  );
}
