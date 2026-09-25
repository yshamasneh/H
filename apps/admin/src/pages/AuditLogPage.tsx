import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pager } from "../components/Pager";
import { listAuditLog, readApiError, type AuditLogEntry } from "../api";

const listPageSize = 20;

export function AuditLogPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const result = await listAuditLog({ action: action || undefined, page, pageSize: listPageSize });
        setEntries(result.items);
        setTotal(result.total);
      } catch (requestError) {
        setError(readApiError(requestError, t("auditLog.loadError")));
      }
    }
    void load();
  }, [action, page]);

  useEffect(() => {
    setPage(1);
  }, [action]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("auditLog.title")}</h1>
          <p className="page-subtitle">{t("auditLog.subtitle")}</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="card">
        <div className="filters-row">
          <input
            className="text-input"
            onChange={(event) => setAction(event.target.value)}
            placeholder={t("auditLog.filterPlaceholder")}
            value={action}
          />
        </div>

        {entries === null ? (
          <div className="loading-state">{t("common.loading")}</div>
        ) : entries.length === 0 ? (
          <div className="empty-state">{t("auditLog.empty")}</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("auditLog.when")}</th>
                <th>{t("auditLog.admin")}</th>
                <th>{t("auditLog.action")}</th>
                <th>{t("auditLog.entity")}</th>
                <th>{t("auditLog.reason")}</th>
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
                  <td>{entry.reason ?? t("common.dash")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pager onPage={setPage} page={page} pageSize={listPageSize} total={total} />
      </div>
    </div>
  );
}
