import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  listCashSettlements,
  listPartnerSettlements,
  type CashSettlement,
  type PartnerSettlement
} from "../../api.accounting";
import { Money } from "../../components/Money";
import type { SectionProps } from "./types";

/**
 * What has actually happened to the money: payouts made and cash handed over.
 *
 * Both lists existed in the API and the client with nothing reading them, so once a payout was
 * recorded there was no way to see it again — the balance simply dropped, with no record of why.
 */
export function HistorySection({ onError, reloadToken }: SectionProps) {
  const { t } = useTranslation();
  const [payouts, setPayouts] = useState<PartnerSettlement[] | null>(null);
  const [handovers, setHandovers] = useState<CashSettlement[] | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [nextPayouts, nextHandovers] = await Promise.all([listPartnerSettlements(), listCashSettlements()]);
        setPayouts(nextPayouts);
        setHandovers(nextHandovers);
      } catch (error) {
        onError(error, t("accounting.loadError"));
      }
    })();
  }, [reloadToken]);

  if (payouts === null || handovers === null) return <div className="loading-state">{t("common.loading")}</div>;

  return (
    <>
      <div className="card">
        <h2 className="card-title">{t("accounting.history.payouts")}</h2>
        {payouts.length === 0 ? (
          <div className="empty-state">{t("accounting.history.emptyPayouts")}</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("accounting.history.paidAt")}</th>
                  <th>{t("accounting.balances.party")}</th>
                  <th>{t("accounting.history.amount")}</th>
                  <th>{t("accounting.history.method")}</th>
                  <th>{t("accounting.history.reference")}</th>
                  <th>{t("accounting.history.paidBy")}</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((payout) => (
                  <tr key={payout.id}>
                    <td>{new Date(payout.paidAt).toLocaleString()}</td>
                    <td>
                      {payout.payeeName}
                      <br />
                      <small>{t(`accounting.payeeType.${payout.payeeType}`)}</small>
                    </td>
                    <td>
                      <Money minor={payout.amountMinor} />
                    </td>
                    <td>{t(`accounting.method.${payout.method}`)}</td>
                    <td dir="ltr">{payout.reference}</td>
                    <td>
                      {payout.paidByName}
                      {payout.note ? (
                        <>
                          <br />
                          <small>{payout.note}</small>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {payouts.length >= 200 ? <p className="field-hint">{t("accounting.history.limit")}</p> : null}
      </div>

      <div className="card">
        <h2 className="card-title">{t("accounting.history.handovers")}</h2>
        {handovers.length === 0 ? (
          <div className="empty-state">{t("accounting.history.emptyHandovers")}</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("accounting.history.paidAt")}</th>
                  <th>{t("common.name")}</th>
                  <th>{t("accounting.history.expected")}</th>
                  <th>{t("accounting.history.counted")}</th>
                  <th>{t("accounting.history.discrepancy")}</th>
                  <th>{t("accounting.history.orders")}</th>
                  <th>{t("accounting.history.reference")}</th>
                  <th>{t("accounting.history.receivedBy")}</th>
                </tr>
              </thead>
              <tbody>
                {handovers.map((handover) => (
                  <tr key={handover.id}>
                    <td>{new Date(handover.settledAt).toLocaleString()}</td>
                    <td>{handover.driverName}</td>
                    <td>
                      <Money minor={handover.expectedAmountMinor} />
                    </td>
                    <td>
                      <Money minor={handover.countedAmountMinor} />
                    </td>
                    <td>
                      {handover.discrepancyMinor === 0 ? (
                        t("common.dash")
                      ) : (
                        <>
                          <Money minor={handover.discrepancyMinor} signed />
                          {handover.discrepancyNote ? (
                            <>
                              <br />
                              <small>{handover.discrepancyNote}</small>
                            </>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td>{handover.allocations.length}</td>
                    <td dir="ltr">{handover.reference}</td>
                    <td>{handover.receivedByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
