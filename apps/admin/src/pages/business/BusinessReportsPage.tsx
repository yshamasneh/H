import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { readApiError } from "../../api";
import { getBusinessStats, type BusinessStats, type PeriodStats } from "../../api.business";
import { Money } from "../../components/Money";

/**
 * Sales at a glance for the store: today, this month, and all time.
 *
 * The figures are exactly what the API reports and the footnote says what they do and do not
 * include — "sales" counts delivered orders' full totals (fees included) while "orders" counts
 * every status — because a number without its definition invites the wrong conclusion.
 */

const periods: (keyof BusinessStats)[] = ["today", "month", "total"];

export function BusinessReportsPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<BusinessStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setStats(await getBusinessStats());
      setError(null);
    } catch (requestError) {
      setError(readApiError(requestError, t("businessReports.loadError")));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("businessReports.title")}</h1>
          <p className="page-subtitle">{t("businessReports.subtitle")}</p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => void load()} type="button">
          {t("businessReports.refresh")}
        </button>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {stats === null ? (
        error ? null : <div className="loading-state">{t("common.loading")}</div>
      ) : (
        <>
          {periods.map((period) => (
            <PeriodRow key={period} label={t(`businessReports.${period}`)} stats={stats[period]} />
          ))}
          <p className="field-hint">{t("businessReports.note")}</p>
        </>
      )}
    </div>
  );
}

function PeriodRow({ label, stats }: { label: string; stats: PeriodStats }) {
  const { t } = useTranslation();
  return (
    <div>
      <h2 className="form-section-title">{label}</h2>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">{t("businessReports.sales")}</div>
          <div className="stat-value">
            <Money minor={stats.salesMinor} />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t("businessReports.orders")}</div>
          <div className="stat-value money">{stats.ordersCount}</div>
        </div>
      </div>
    </div>
  );
}
