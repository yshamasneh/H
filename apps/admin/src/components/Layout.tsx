import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth";
import { setLanguage, supportedLanguages, type SupportedLanguage } from "../i18n";

const navItems = [
  { to: "/", labelKey: "layout.nav.dashboard", icon: "▦", end: true },
  { to: "/restaurants", labelKey: "layout.nav.restaurants", icon: "♨" },
  { to: "/orders", labelKey: "layout.nav.orders", icon: "≡" },
  { to: "/drivers", labelKey: "layout.nav.drivers", icon: "✈" },
  { to: "/users", labelKey: "layout.nav.users", icon: "●" },
  { to: "/audit-log", labelKey: "layout.nav.auditLog", icon: "☷" }
];

const languageLabels: Record<SupportedLanguage, string> = { ar: "العربية", en: "English" };

export function Layout({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { user, signOut } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">TQ</div>
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-title">{t("layout.brandTitle")}</span>
            <span className="sidebar-brand-subtitle">{t("layout.brandSubtitle")}</span>
          </div>
        </div>
        {navItems.map((item) => (
          <NavLink
            className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            end={item.end}
            key={item.to}
            to={item.to}
          >
            <span className="nav-link-icon">{item.icon}</span>
            {t(item.labelKey)}
          </NavLink>
        ))}
        <div className="language-switch" role="group" aria-label={t("layout.language")}>
          {supportedLanguages.map((language) => (
            <button
              className={`language-switch-option${i18n.language === language ? " active" : ""}`}
              key={language}
              onClick={() => setLanguage(language)}
              type="button"
            >
              {languageLabels[language]}
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          {t("layout.signedInAs")}
          <br />
          <strong style={{ color: "#e7ecf7" }}>{user?.fullName}</strong>
          <button className="sign-out-button" onClick={() => void signOut()} type="button">
            {t("layout.signOut")}
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
