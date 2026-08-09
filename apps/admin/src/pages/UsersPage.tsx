import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, listAdminUsers, type AdminUserView } from "../api";
import { StatusBadge } from "../components/StatusBadge";

const roleOptions = ["", "CUSTOMER", "RESTAURANT", "DRIVER", "ADMIN"];

export function UsersPage() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<AdminUserView[] | null>(null);
  const [role, setRole] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const page = await listAdminUsers({ role: role || undefined, search: search || undefined });
        setUsers(page.items);
      } catch (requestError) {
        setError(requestError instanceof ApiError ? requestError.message : t("users.loadError"));
      }
    }
    const timeout = setTimeout(() => void load(), 250);
    return () => clearTimeout(timeout);
  }, [role, search]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("users.title")}</h1>
          <p className="page-subtitle">{t("users.subtitle")}</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="card">
        <div className="filters-row">
          <select className="select" onChange={(event) => setRole(event.target.value)} value={role}>
            {roleOptions.map((option) => (
              <option key={option} value={option}>
                {option ? t(`role.${option}`) : t("users.allRoles")}
              </option>
            ))}
          </select>
          <input
            className="text-input"
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("users.searchPlaceholder")}
            value={search}
          />
        </div>

        {users === null ? (
          <div className="loading-state">{t("common.loading")}</div>
        ) : users.length === 0 ? (
          <div className="empty-state">{t("users.empty")}</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("common.name")}</th>
                <th>{t("common.phone")}</th>
                <th>{t("users.role")}</th>
                <th>{t("common.status")}</th>
                <th>{t("users.joined")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.fullName}</td>
                  <td>{user.phone}</td>
                  <td>{t(`role.${user.role}`)}</td>
                  <td>
                    <StatusBadge status={user.isActive ? "ACTIVE" : "INACTIVE"} />
                  </td>
                  <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
