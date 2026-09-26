import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth";
import type { Permission } from "../api";
import { setLanguage, supportedLanguages, type SupportedLanguage } from "../i18n";
import { LiveQueueProvider, useLiveQueue } from "../live-queue";
import { NewOrderPopup } from "./NewOrderPopup";
import { FeedbackToast, SoundToggle } from "./SoundToggle";

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
  { to: "/offers", labelKey: "layout.nav.offers", icon: "%", permission: "MANAGE_OFFERS" },
  { to: "/notifications", labelKey: "layout.nav.notifications", icon: "✉", permission: "MANAGE_NOTIFICATIONS" },
  { to: "/landmarks", labelKey: "layout.nav.landmarks", icon: "⚑", permission: "MANAGE_LANDMARKS" },
  { to: "/accounting", labelKey: "layout.nav.accounting", icon: "₪", permission: "VIEW_ACCOUNTING" },
  { to: "/settings", labelKey: "layout.nav.settings", icon: "⚙", permission: "MANAGE_PLATFORM_SETTINGS" },
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
  { to: "/business/reports", labelKey: "layout.nav.reports", icon: "▥", permission: "MANAGE_BUSINESS_SETTINGS" },
  { to: "/business/settings", labelKey: "layout.nav.businessSettings", icon: "⚙", permission: "MANAGE_BUSINESS_SETTINGS" },
  { to: "/business/staff", labelKey: "layout.nav.staff", icon: "◍", permission: "MANAGE_BUSINESS_STAFF" }
];

const languageLabels: Record<SupportedLanguage, string> = { ar: "العربية", en: "English" };

export function Layout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // The business shell holds the live order queue once, above every page, so the new-order sound
  // and popup follow the person to whatever screen they are on.
  if (user?.role === "RESTAURANT") {
    return (
      <LiveQueueProvider>
        <Shell isBusinessShell>{children}</Shell>
        <NewOrderPopup />
        <FeedbackToast />
      </LiveQueueProvider>
    );
  }
  return <Shell isBusinessShell={false}>{children}</Shell>;
}

function Shell({ children, isBusinessShell }: { children: ReactNode; isBusinessShell: boolean }) {
  const { t, i18n } = useTranslation();
  const { user, access, can, signOut } = useAuth();

  const items = (isBusinessShell ? businessNav : platformNav).filter(
    (item) =>
      (!item.permission || can(item.permission)) &&
      (!item.businessType || access?.business?.businessType === item.businessType)
  );
  const brandTitle = isBusinessShell ? (access?.business?.name ?? t("layout.brandTitle")) : t("layout.brandTitle");

  return (
    <div className="app-shell">
      {/* Below 860px (a tablet held upright, a phone) the sidebar gives way to this bar: the same
          navigation as a row of large, scrollable tabs, with the sound state always in view. */}
      <header className="topbar">
        <div className="topbar-row">
          <span className="topbar-brand">{brandTitle}</span>
          {isBusinessShell ? <SoundToggle variant="topbar" /> : null}
        </div>
        <nav aria-label={t("layout.navigation")} className="topbar-nav">
          {items.map((item) => (
            <NavLink
              className={({ isActive }) => `topbar-link${isActive ? " active" : ""}`}
              end={item.end}
              key={item.to}
              to={item.to}
            >
              <span aria-hidden="true">{item.icon}</span>
              {t(item.labelKey)}
              {item.to === "/business" ? <NewCountBadge /> : null}
            </NavLink>
          ))}
        </nav>
      </header>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">TQ</div>
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-title">{brandTitle}</span>
            <span className="sidebar-brand-subtitle">
              {isBusinessShell
                ? t(`layout.businessSubtitle.${access?.business?.businessType ?? "RESTAURANT"}`)
                : t("layout.brandSubtitle")}
            </span>
          </div>
        </div>
        {isBusinessShell ? <SoundToggle variant="sidebar" /> : null}
        {items.map((item) => (
          <NavLink
            className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            end={item.end}
            key={item.to}
            to={item.to}
          >
            <span className="nav-link-icon">{item.icon}</span>
            {t(item.labelKey)}
            {item.to === "/business" ? <NewCountBadge /> : null}
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

/** How many orders are waiting to be accepted, on the Live Orders link, so it is visible from any page. */
function NewCountBadge() {
  const count = useLiveQueue()?.queue?.new.length ?? 0;
  if (count === 0) return null;
  return <span className="nav-count-badge">{count}</span>;
}
