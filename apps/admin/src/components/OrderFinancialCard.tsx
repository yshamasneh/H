import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ApiError, readApiError } from "../api";
import { formatBp, getOrderFinancialRecord, type OrderFinancialRecord } from "../api.accounting";
import { useAuth } from "../auth";
import { Money } from "./Money";

/**
 * What the books say about one order: how its money was valued and who was credited what.
 *
 * `getOrderFinancialRecord` existed in the client with no screen using it, so the only way to check
 * why a driver or a store was credited a particular amount was to read the database. It also gives
 * the operator the exact order to correct: the link below opens the adjustment form already tied to
 * this record.
 *
 * An order that has not reached a financial outcome yet (only delivered and failed orders produce a
 * record) simply shows nothing rather than an error.
 */
export function OrderFinancialCard({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [record, setRecord] = useState<OrderFinancialRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canView = can("VIEW_ACCOUNTING");

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await getOrderFinancialRecord(orderId);
        if (!cancelled) setRecord(loaded);
      } catch (requestError) {
        if (cancelled) return;
        setRecord(null);
        if (!(requestError instanceof ApiError && requestError.statusCode === 404)) {
          setError(readApiError(requestError, t("orderFinancial.loadError")));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId, canView]);

  if (!canView) return null;
  if (error) return <div className="error-banner">{error}</div>;
  if (!record) return null;

  const balanced = record.reconciliation.balancedMinor === 0;
  const rows: [string, React.ReactNode][] = [
    [t("orderFinancial.outcome"), t(`orderFinancial.outcomes.${record.outcome}`)],
    [t("orderFinancial.rateVersion"), record.rateSetVersion],
    [
      t("orderFinancial.commissionRate"),
      record.commissionBp === null ? t("common.dash") : <span className="money">{formatBp(record.commissionBp)}</span>
    ],
    [t("orderFinancial.itemSubtotal"), <Money minor={record.itemSubtotalMinor} />],
    [t("orderFinancial.merchandiseDiscount"), <Money minor={record.merchandiseDiscountMinor} />],
    [t("orderFinancial.deliveryFee"), <Money minor={record.deliveryFeeMinor} />],
    [t("orderFinancial.cashCollected"), <Money minor={record.cashCollectedMinor} />],
    ...(record.cashRoundingMinor > 0
      ? ([[t("orderFinancial.cashRounding"), <Money minor={record.cashRoundingMinor} />]] as [string, React.ReactNode][])
      : []),
    [t("orderFinancial.commission"), <Money minor={record.commissionMinor} />],
    [t("orderFinancial.driverShare"), <Money minor={record.driverShareMinor} />]
  ];

  return (
    <div className="card">
      <h2 className="card-title">{t("orderFinancial.title")}</h2>
      {rows.map(([label, value]) => (
        <div className="kv-row" key={label}>
          <span className="kv-label">{label}</span>
          <span className="kv-value">{value}</span>
        </div>
      ))}
      {record.costDataComplete ? null : <div className="warning-banner">{t("orderFinancial.costIncomplete")}</div>}

      <h3 className="form-section-title">{t("orderFinancial.entries")}</h3>
      {record.entries.map((entry, index) => (
        <div className="kv-row" key={`${entry.payeeKey}-${entry.component}-${index}`}>
          <span className="kv-label">
            {entry.payeeName} · {t(`accounting.component.${entry.component}`, entry.component)}
          </span>
          <span className="kv-value">
            <Money minor={entry.amountMinor} signed={entry.amountMinor < 0} />
          </span>
        </div>
      ))}
      <div className="kv-row">
        <span className="kv-label">{t("orderFinancial.reconciliation")}</span>
        <span className={`badge ${balanced ? "badge-good" : "badge-danger"}`}>
          {balanced ? t("accounting.overview.balanced") : <Money minor={record.reconciliation.balancedMinor} signed />}
        </span>
      </div>

      {can("MANAGE_SETTLEMENTS") ? (
        <p style={{ marginTop: 12 }}>
          <Link className="btn btn-outline btn-sm" to={`/accounting?tab=adjustments&order=${record.orderId}`}>
            {t("orderFinancial.correct")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
