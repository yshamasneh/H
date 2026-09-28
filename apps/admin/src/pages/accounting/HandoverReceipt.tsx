import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { CashSettlement } from "../../api.accounting";
import { Money } from "../../components/Money";

/**
 * The record of one cash handover, laid out like a receipt: who handed over, who received, which
 * orders it settled, what was expected, what was counted, and why they differ. Everything on it is
 * the stored settlement exactly as the server returned it — nothing is recomputed here — so the
 * printed copy and the ledger cannot disagree.
 */
export function HandoverReceipt({ settlement, onClose }: { settlement: CashSettlement; onClose: () => void }) {
  const { t } = useTranslation();
  const settledTotal = settlement.allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0);

  return (
    <div className="reason-modal-backdrop receipt-backdrop" onClick={onClose}>
      <div
        aria-labelledby="handover-receipt-title"
        aria-modal="true"
        className="receipt print-area"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="receipt-header">
          <div>
            <h3 id="handover-receipt-title">{t("accounting.receipt.title")}</h3>
            <p className="receipt-reference" dir="ltr">{settlement.reference}</p>
          </div>
          <span className={settlement.discrepancyMinor === 0 ? "badge badge-good" : "badge badge-warn"}>
            {settlement.discrepancyMinor === 0 ? t("accounting.receipt.balanced") : t("accounting.receipt.withDifference")}
          </span>
        </div>

        <dl className="receipt-facts">
          <dt>{t("accounting.receipt.date")}</dt>
          <dd>{new Date(settlement.settledAt).toLocaleString()}</dd>
          <dt>{t("accounting.receipt.from")}</dt>
          <dd>{settlement.driverName}</dd>
          <dt>{t("accounting.receipt.receivedBy")}</dt>
          <dd>{settlement.receivedByName}</dd>
        </dl>

        <table className="data-table receipt-lines">
          <thead>
            <tr>
              <th>{t("accounting.cash.order")}</th>
              <th>{t("accounting.receipt.settledAmount")}</th>
            </tr>
          </thead>
          <tbody>
            {settlement.allocations.length === 0 ? (
              <tr>
                <td colSpan={2}>{t("accounting.receipt.noOrders")}</td>
              </tr>
            ) : (
              settlement.allocations.map((allocation) => (
                <tr key={allocation.custodyId}>
                  <td dir="ltr">
                    <Link className="text-link" to={`/orders/${allocation.orderId}`}>
                      #{allocation.orderId.slice(0, 8)}
                    </Link>
                  </td>
                  <td>
                    <Money minor={allocation.amountMinor} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <th>{t("accounting.receipt.settledTotal")}</th>
              <th>
                <Money minor={settledTotal} />
              </th>
            </tr>
          </tfoot>
        </table>

        <dl className="receipt-facts receipt-totals">
          <dt>{t("accounting.history.expected")}</dt>
          <dd>
            <Money minor={settlement.expectedAmountMinor} />
          </dd>
          <dt>{t("accounting.history.counted")}</dt>
          <dd>
            <strong>
              <Money minor={settlement.countedAmountMinor} />
            </strong>
          </dd>
          <dt>{t("accounting.history.discrepancy")}</dt>
          <dd>{settlement.discrepancyMinor === 0 ? t("common.dash") : <Money minor={settlement.discrepancyMinor} signed />}</dd>
          {settlement.discrepancyNote ? (
            <>
              <dt>{t("accounting.cash.discrepancyNote")}</dt>
              <dd>{settlement.discrepancyNote}</dd>
            </>
          ) : null}
          {settlement.note ? (
            <>
              <dt>{t("accounting.cash.noteLabel")}</dt>
              <dd>{settlement.note}</dd>
            </>
          ) : null}
        </dl>

        <div className="btn-row reason-modal-actions no-print">
          <button className="btn btn-outline" onClick={onClose} type="button">
            {t("common.close")}
          </button>
          <button className="btn btn-primary" onClick={() => window.print()} type="button">
            {t("accounting.receipt.print")}
          </button>
        </div>
      </div>
    </div>
  );
}
