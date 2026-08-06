import { useEffect, useState } from "react";
import { ApiError, listAdminUsers, type AdminUserView } from "../api";
import { StatusBadge } from "../components/StatusBadge";

const roleOptions = ["", "CUSTOMER", "RESTAURANT", "DRIVER", "ADMIN"];

export function UsersPage() {
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
        setError(requestError instanceof ApiError ? requestError.message : "Could not load users.");
      }
    }
    const timeout = setTimeout(() => void load(), 250);
    return () => clearTimeout(timeout);
  }, [role, search]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle">Every account across every role</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="card">
        <div className="filters-row">
          <select className="select" onChange={(event) => setRole(event.target.value)} value={role}>
            {roleOptions.map((option) => (
              <option key={option} value={option}>
                {option || "All roles"}
              </option>
            ))}
          </select>
          <input
            className="text-input"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or phone"
            value={search}
          />
        </div>

        {users === null ? (
          <div className="loading-state">Loading...</div>
        ) : users.length === 0 ? (
          <div className="empty-state">No users match this filter.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.fullName}</td>
                  <td>{user.phone}</td>
                  <td>{user.role}</td>
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
