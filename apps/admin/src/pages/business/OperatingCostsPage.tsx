import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, request } from "../../api";
import { formatMinor, type OperatingCostEntry } from "../../api.accounting";

/**
 * What the supermarket side does with costs: report them, and see what was decided.
 *
 * There is no approve button here and there never will be. A cost entered on this screen is
 * PROPOSED and stays that way until the platform decides — the partner reports and requests, it
 * does not decide, and the interface says so rather than merely hiding a control.
 */

const categories = ["WAREHOUSE_RENT", "STAFF_SALARY", "UTILITIES", "MAINTENANCE", "OTHER"] as const;

const listOwnCosts = () => request<OperatingCostEntry[]>("/api/v1/restaurant/me/operating-costs");
const proposeCost = (body: {
  category: string;
  description: string;
  amountMinor: number;
  incurredOn: string;
  isRecurring?: boolean;
  periodLabel?: string;
}) => request<OperatingCostEntry>("/api/v1/restaurant/me/operating-costs", { method: "POST", body });

export function OperatingCostsPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<OperatingCostEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    category: "WAREHOUSE_RENT" as string,
    description: "",
    amount: "",
    incurredOn: new Date().toISOString().slice(0, 10),
    isRecurring: false,
    periodLabel: new Date().toISOString().slice(0, 7)
  });

  const load = async () => {
    try {
      setEntries(await listOwnCosts());
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("operatingCosts.loadError"));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submit = async () => {
    setError(null);
    const amountMinor = Math.round(Number(draft.amount) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setError(t("operatingCosts.invalidAmount"));
      return;
    }
    if (draft.description.trim().length < 3) {
      setError(t("operatingCosts.descriptionRequired"));
      return;
    }
    setBusy(true);
    try {
      await proposeCost({
        category: draft.category,
        description: draft.description.trim(),
        amountMinor,
        incurredOn: draft.incurredOn,
        isRecurring: draft.isRecurring,
        ...(draft.isRecurring ? { periodLabel: draft.periodLabel } : {})
      });
      // Reset only after the request succeeded, so a rejected entry keeps what was typed.
      setDraft({ ...draft, description: "", amount: "" });
      await load();
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("common.genericActionError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("operatingCosts.title")}</h1>
          <p className="page-subtitle">{t("operatingCosts.subtitle")}</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="card">
        <h3>{t("operatingCosts.reportTitle")}</h3>
        <div className="filters-row">
          <select
            className="text-input"
            onChange={(event) => setDraft({ ...draft, category: event.target.value })}
            value={draft.category}
          >
            {categories.map((category) => (
              <option key={category} value={category}>
                {t(`accounting.costCategory.${category}`)}
              </option>
            ))}
          </select>
          <input
            className="text-input"
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            placeholder={t("operatingCosts.descriptionPlaceholder")}
            value={draft.description}
          />
          <input
            className="text-input"
            onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
            placeholder={t("operatingCosts.amountPlaceholder")}
            value={draft.amount}
          />
          <input
            className="text-input"
            onChange={(event) => setDraft({ ...draft, incurredOn: event.target.value })}
            type="date"
            value={draft.incurredOn}
          />
          <button
            className={draft.isRecurring ? "primary-button" : "secondary-button"}
            onClick={() => setDraft({ ...draft, isRecurring: !draft.isRecurring })}
            type="button"
          >
            {t("operatingCosts.monthly")}
          </button>
          {draft.isRecurring ? (
            <input
              className="text-input"
              onChange={(event) => setDraft({ ...draft, periodLabel: event.target.value })}
              placeholder="YYYY-MM"
              value={draft.periodLabel}
            />
          ) : null}
          <button className="primary-button" disabled={busy} onClick={() => void submit()} type="button">
            {busy ? t("common.working") : t("operatingCosts.submit")}
          </button>
        </div>
        <p className="page-subtitle">{t("operatingCosts.approvalNote")}</p>
      </div>

      <div className="card">
        {entries === null ? (
          <div className="loading-state">{t("common.loading")}</div>
        ) : entries.length === 0 ? (
          <div className="empty-state">{t("operatingCosts.empty")}</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("accounting.costs.category")}</th>
                <th>{t("accounting.costs.description")}</th>
                <th>{t("accounting.costs.amount")}</th>
                <th>{t("accounting.costs.period")}</th>
                <th>{t("common.status")}</th>
                <th>{t("operatingCosts.yourShare")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const ownShare = entry.shares.find((share) => share.payeeKey === `BUSINESS:${entry.businessId}`);
                return (
                  <tr key={entry.id}>
                    <td>{t(`accounting.costCategory.${entry.category}`, entry.category)}</td>
                    <td>{entry.description}</td>
                    <td>{formatMinor(entry.amountMinor)}</td>
                    <td>{entry.periodLabel ?? new Date(entry.incurredOn).toLocaleDateString()}</td>
                    <td>
                      {t(`accounting.costStatus.${entry.status}`)}
                      {entry.decisionNote ? (
                        <>
                          <br />
                          <small>{entry.decisionNote}</small>
                        </>
                      ) : null}
                    </td>
                    <td>{ownShare ? formatMinor(ownShare.amountMinor) : t("common.dash")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
