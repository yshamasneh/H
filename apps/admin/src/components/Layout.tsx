import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth";

const navItems = [
  { to: "/", label: "Dashboard", icon: "▦", end: true },
  { to: "/restaurants", label: "Restaurants", icon: "♨" },
  { to: "/orders", label: "Orders", icon: "≡" },
  { to: "/drivers", label: "Drivers", icon: "✈" },
  { to: "/users", label: "Users", icon: "●" },
  { to: "/audit-log", label: "Audit Log", icon: "☷" }
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">TQ</div>
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-title">TasawaQ Ops</span>
            <span className="sidebar-brand-subtitle">Operations Console</span>
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
            {item.label}
          </NavLink>
        ))}
        <div className="sidebar-footer">
          Signed in as
          <br />
          <strong style={{ color: "#e7ecf7" }}>{user?.fullName}</strong>
          <button className="sign-out-button" onClick={() => void signOut()} type="button">
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
