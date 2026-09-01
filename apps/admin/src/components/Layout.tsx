import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth";
import type { Permission } from "../api";
import { setLanguage, supportedLanguages, type SupportedLanguage } from "../i18n";

type NavItem = {
  to: string;
  labelKey: string;
  icon: string;
  end?: boolean;
  /** Omitted means every signed-in user of this shell sees it. */
  permission?: Permission;
  /** Restricts an item to one vertical, for features only a supermarket has. */
  businessType?: "SUPERMARKET";
};

const platformNav: NavItem[] = [
  { to: "/", labelKey: "layout.nav.dashboard", icon: "▦", end: true },
  { to: "/restaurants", labelKey: "layout.nav.restaurants", icon: "♨", permission: "MANAGE_BUSINESSES" },
  { to: "/orders", labelKey: "layout.nav.orders", icon: "≡", permission: "VIEW_ALL_ORDERS" },
  { to: "/drivers", labelKey: "layout.nav.drivers", icon: "✈", permission: "MANAGE_DRIVERS" },
  { to: "/users", labelKey: "layout.nav.users", icon: "●", permission: "MANAGE_USERS" },
  { to: "/landmarks", labelKey: "layout.nav.landmarks", icon: "⚑", permission: "MANAGE_LANDMARKS" },
  { to: "/accounting", labelKey: "layout.nav.accounting", icon: "₪", permission: "VIEW_ACCOUNTING" },
  { to: "/audit-log", labelKey: "layout.nav.auditLog", icon: "☷", permission: "VIEW_AUDIT_LOG" }
];

const businessNav: NavItem[] = [
  { to: "/business", labelKey: "layout.nav.liveOrders", icon: "◉", end: true, permission: "VIEW_ORDERS" },
  { to: "/business/catalogue", labelKey: "layout.nav.catalogue", icon: "▤", permission: "MANAGE_PRODUCTS" },
  {
    to: "/business/inventory",
    labelKey: "layout.nav.inventory",
    icon: "▧",
    permission: "MANAGE_INVENTORY",
    businessType: "SUPERMARKET"
  },
  {
    to: "/business/operating-costs",
    labelKey: "layout.nav.operatingCosts",
    icon: "₪",
    permission: "PROPOSE_OPERATING_COSTS",
    businessType: "SUPERMARKET"
  },
  { to: "/business/staff", labelKey: "layout.nav.staff", icon: "◍", permission: "MANAGE_BUSINESS_STAFF" }
];

const languageLabels: Record<SupportedLanguage, string> = { ar: "العربية", en: "English" };

export function Layout({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { user, access, can, signOut } = useAuth();

  const isBusinessShell = user?.role === "RESTAURANT";
  const items = (isBusinessShell ? businessNav : platformNav).filter(
    (item) =>
      (!item.permission || can(item.permission)) &&
      (!item.businessType || access?.business?.businessType === item.businessType)
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">TQ</div>
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-title">
              {isBusinessShell ? (access?.business?.name ?? t("layout.brandTitle")) : t("layout.brandTitle")}
            </span>
            <span className="sidebar-brand-subtitle">
              {isBusinessShell
                ? t(`layout.businessSubtitle.${access?.business?.businessType ?? "RESTAURANT"}`)
                : t("layout.brandSubtitle")}
            </span>
          </div>
        </div>
        {items.map((item) => (
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
          <strong className="sidebar-user">{user?.fullName}</strong>
          {access?.roleKey ? <br /> : null}
          {access?.roleKey ? t(`role.${access.roleKey}`, access.roleKey) : null}
          <button className="sign-out-button" onClick={() => void signOut()} type="button">
            {t("layout.signOut")}
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
