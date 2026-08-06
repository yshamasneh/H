import { useEffect, useState } from "react";
import { ApiError, listAuditLog, type AuditLogEntry } from "../api";

export function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [action, setAction] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const page = await listAuditLog({ action: action || undefined });
        setEntries(page.items);
      } catch (requestError) {
        setError(requestError instanceof ApiError ? requestError.message : "Could not load the audit log.");
      }
    }
    void load();
  }, [action]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Log</h1>
          <p className="page-subtitle">Every admin action, who performed it, and why</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="card">
        <div className="filters-row">
          <input
            className="text-input"
            onChange={(event) => setAction(event.target.value)}
            placeholder="Filter by action, e.g. RESTAURANT_SUSPENDED"
            value={action}
          />
        </div>

        {entries === null ? (
          <div className="loading-state">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="empty-state">No matching audit log entries.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Admin</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.createdAt).toLocaleString()}</td>
                  <td>{entry.actorFullName}</td>
                  <td>{entry.action}</td>
                  <td>
                    {entry.entityType} ({entry.entityId.slice(0, 8)})
                  </td>
                  <td>{entry.reason ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
