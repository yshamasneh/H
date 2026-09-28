import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { readApiError } from "../../api";
import {
  formatMinor,
  listCashSettlements,
  listDriverCash,
  listDriverCustody,
  recordCashSettlement,
  type CashSettlement,
  type DriverCash,
  type DriverCustodyLine
} from "../../api.accounting";
import { carryingDays, expectedHandoverMinor, handoverDifferenceMinor, overdueCarryingDays } from "../../cash-handover";
import { Field } from "../../components/Field";
import { Money } from "../../components/Money";
import { parseMoneyToMinor } from "../../money";
import { telHref } from "../../tel";
import { HandoverReceipt } from "./HandoverReceipt";
import { suggestReference, type SectionProps } from "./types";

/**
 * Cash still in drivers' pockets, and getting it back.
 *
 * Reported entirely separately from what each driver has earned: a driver holding 320.00 of
 * customers' money and being owed 14.00 in pay are two different facts about two different
 * pockets, and adding them together is how a cash business loses track.
 *
 * The flow reads top to bottom: who is carrying cash and for how long; receive it (which orders,
 * count it, record it); and a receipt of exactly what was recorded, which can be printed and is
 * available again from the driver's history or the History tab.
 */
export function DriverCashSection({
  onError,
  reloadToken,
  onChanged,
  canReceive
}: Omit<SectionProps, "onChanged"> & { canReceive: boolean; onChanged: (message?: string) => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<DriverCash[] | null>(null);
  const [openDriver, setOpenDriver] = useState<DriverCash | null>(null);
  const [historyDriver, setHistoryDriver] = useState<DriverCash | null>(null);
  const [receipt, setReceipt] = useState<CashSettlement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setRows(await listDriverCash());
      } catch (requestError) {
        onError(requestError, t("accounting.loadError"));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken]);

  if (rows === null) return <div className="loading-state">{t("common.loading")}</div>;
  if (rows.length === 0) return <div className="empty-state">{t("accounting.cash.empty")}</div>;

  // Whoever is carrying the most is dealt with first; drivers holding nothing go to the bottom.
  const sorted = [...rows].sort((left, right) => right.outstandingMinor - left.outstandingMinor);
  const holding = sorted.filter((row) => row.outstandingMinor > 0);
  const totalHeldMinor = holding.reduce((sum, row) => sum + row.outstandingMinor, 0);
  const now = new Date();

  return (
    <div className="card">
      <p className="cash-summary">
        {holding.length === 0 ? (
          t("accounting.cash.allHandedOver")
        ) : (
          <>
            {t("accounting.cash.summary", { count: holding.length })} <strong><Money minor={totalHeldMinor} /></strong>
          </>
        )}
      </p>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("common.name")}</th>
              <th>{t("accounting.cash.outstanding")}</th>
              <th>{t("accounting.cash.carryingSince")}</th>
              <th>{t("accounting.cash.openOrders")}</th>
              <th>{t("accounting.cash.collected")}</th>
              <th>{t("accounting.cash.settled")}</th>
              <th>{t("accounting.cash.earnings")}</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const days = carryingDays(row.oldestOutstandingAt, now);
              const phoneLink = telHref(row.driverPhone);
              return (
                <tr className={row.outstandingMinor > 0 ? undefined : "row-muted"} key={row.driverUserId}>
                  <td>
                    {row.driverName}
                    <br />
                    {phoneLink ? (
                      <a className="phone-link" href={phoneLink}>
                        <bdi className="phone-number" dir="ltr">{row.driverPhone}</bdi>
                      </a>
                    ) : (
                      <small dir="ltr">{row.driverPhone}</small>
                    )}
                  </td>
                  <td>
                    <strong>
                      <Money minor={row.outstandingMinor} />
                    </strong>
                  </td>
                  <td>
                    {row.oldestOutstandingAt && row.outstandingMinor > 0 ? (
                      <>
                        {new Date(row.oldestOutstandingAt).toLocaleDateString()}
                        <br />
                        <span className={days >= overdueCarryingDays ? "badge badge-warn" : "badge"}>
                          {days === 0 ? t("accounting.cash.today") : t("accounting.cash.days", { count: days })}
                        </span>
                      </>
                    ) : (
                      t("common.dash")
                    )}
                  </td>
                  <td>{row.outstandingOrderCount}</td>
                  <td>
                    <Money minor={row.collectedMinor} />
                  </td>
                  <td>
                    <Money minor={row.settledMinor} />
                  </td>
                  <td>
                    <Money minor={row.earningsMinor} /> ({t("accounting.cash.paidLabel")} <Money minor={row.earningsPaidMinor} />)
                  </td>
                  <td>
                    <div className="row-actions">
                      {canReceive && row.outstandingMinor > 0 ? (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => {
                            setHistoryDriver(null);
                            setOpenDriver(row);
                          }}
                          type="button"
                        >
                          {t("accounting.cash.recordHandover")}
                        </button>
                      ) : null}
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => {
                          setOpenDriver(null);
                          setHistoryDriver(historyDriver?.driverUserId === row.driverUserId ? null : row);
                        }}
                        type="button"
                      >
                        {t("accounting.cash.history")}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openDriver ? (
        <HandoverForm
          driver={openDriver}
          key={openDriver.driverUserId}
          onCancel={() => setOpenDriver(null)}
          onError={onError}
          onRecorded={(settlement) => {
            setOpenDriver(null);
            setReceipt(settlement);
            onChanged(t("accounting.cash.recorded", { name: settlement.driverName }));
          }}
        />
      ) : null}

      {historyDriver ? (
        <DriverHandoverHistory
          driver={historyDriver}
          key={historyDriver.driverUserId}
          onError={onError}
          onOpenReceipt={setReceipt}
          reloadToken={reloadToken}
        />
      ) : null}

      {receipt ? <HandoverReceipt onClose={() => setReceipt(null)} settlement={receipt} /> : null}
    </div>
  );
}

/**
 * Receiving one driver's cash, in the order it happens at the counter: pick the orders (or leave
 * them all for oldest-first), count the money, record it. The rules — a stable idempotency
 * reference, a required reason when the count differs — are the ones this form always had.
 */
function HandoverForm(props: {
  driver: DriverCash;
  onCancel: () => void;
  onRecorded: (settlement: CashSettlement) => void;
  onError: SectionProps["onError"];
}) {
  const { t } = useTranslation();
  const { driver } = props;
  const [custody, setCustody] = useState<DriverCustodyLine[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [counted, setCounted] = useState(formatMinor(driver.outstandingMinor));
  // Fixed for the life of the form: a retry after a dropped connection re-sends the same reference,
  // and the server refuses the duplicate instead of recording the handover twice.
  const [reference, setReference] = useState(() => suggestReference("HANDOVER"));
  const [note, setNote] = useState("");
  const [discrepancyNote, setDiscrepancyNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setCustody(await listDriverCustody(driver.driverUserId));
      } catch (requestError) {
        props.onError(requestError, t("accounting.loadError"));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver.driverUserId]);

  const expectedMinor = expectedHandoverMinor(driver.outstandingMinor, custody ?? [], selected);
  const countedMinor = parseMoneyToMinor(counted);
  const differenceMinor = handoverDifferenceMinor(countedMinor, expectedMinor);

  const toggle = (custodyId: string) => {
    const next = new Set(selected);
    if (next.has(custodyId)) next.delete(custodyId);
    else next.add(custodyId);
    setSelected(next);
    setCounted(formatMinor(expectedHandoverMinor(driver.outstandingMinor, custody ?? [], next)));
  };

  const submit = async () => {
    if (countedMinor === null) return setError(t("accounting.cash.invalidAmount"));
    if (reference.trim().length < 3) return setError(t("accounting.balances.referenceRequired"));
    if (differenceMinor !== 0 && !discrepancyNote.trim()) return setError(t("accounting.cash.discrepancyNoteRequired"));
    setBusy(true);
    setError(null);
    try {
      const settlement = await recordCashSettlement({
        driverUserId: driver.driverUserId,
        reference: reference.trim(),
        countedAmountMinor: countedMinor,
        ...(selected.size > 0 ? { custodyIds: [...selected] } : {}),
        ...(differenceMinor !== 0 ? { discrepancyNote: discrepancyNote.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {})
      });
      props.onRecorded(settlement);
    } catch (requestError) {
      setError(readApiError(requestError, t("common.genericActionError")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card handover-card" style={{ marginTop: 16 }}>
      <h3 className="card-title">{t("accounting.cash.handoverTitle", { name: driver.driverName })}</h3>
      {error ? <div className="error-banner">{error}</div> : null}

      <h4 className="handover-step">{t("accounting.cash.stepOrders")}</h4>
      <p className="field-hint">{t("accounting.cash.selectOrders")}</p>
      {custody ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("accounting.cash.select")}</th>
                <th>{t("accounting.cash.order")}</th>
                <th>{t("accounting.cash.collectedAt")}</th>
                <th>{t("accounting.cash.collected")}</th>
                <th>{t("accounting.cash.settled")}</th>
                <th>{t("accounting.cash.outstanding")}</th>
                <th>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {custody.map((line) => (
                <tr key={line.custodyId}>
                  <td>
                    <input
                      aria-label={t("accounting.cash.selectOrder", { order: line.orderId.slice(0, 8) })}
                      checked={selected.has(line.custodyId)}
                      onChange={() => toggle(line.custodyId)}
                      type="checkbox"
                    />
                  </td>
                  <td dir="ltr">
                    <Link className="text-link" to={`/orders/${line.orderId}`}>
                      #{line.orderId.slice(0, 8)}
                    </Link>
                  </td>
                  <td>{new Date(line.collectedAt).toLocaleString()}</td>
                  <td>
                    <Money minor={line.collectedAmountMinor} />
                  </td>
                  <td>
                    <Money minor={line.settledAmountMinor} />
                  </td>
                  <td>
                    <Money minor={line.outstandingMinor} />
                  </td>
                  <td>{t(`accounting.custodyStatus.${line.status}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="loading-state">{t("common.loading")}</div>
      )}

      <h4 className="handover-step">{t("accounting.cash.stepCount")}</h4>
      <p className="page-subtitle">
        {t("accounting.cash.expected")}:{" "}
        <strong>
          <Money minor={expectedMinor} />
        </strong>
      </p>
      <div className="form-grid">
        <Field label={t("accounting.cash.amountLabel")}>
          <input
            className="text-input"
            dir="ltr"
            inputMode="decimal"
            onChange={(event) => setCounted(event.target.value)}
            placeholder={t("accounting.cash.countedPlaceholder")}
            value={counted}
          />
        </Field>
        <Field label={t("accounting.cash.referenceLabel")}>
          <input
            className="text-input"
            dir="ltr"
            onChange={(event) => setReference(event.target.value)}
            placeholder={t("accounting.balances.referencePlaceholder")}
            value={reference}
          />
        </Field>
        <Field label={t("accounting.cash.noteLabel")}>
          <input className="text-input" maxLength={500} onChange={(event) => setNote(event.target.value)} value={note} />
        </Field>
      </div>

      {differenceMinor === null ? null : differenceMinor === 0 ? (
        <p className="field-hint">{t("accounting.cash.matches")}</p>
      ) : (
        <div className="warning-banner">
          {differenceMinor < 0
            ? t("accounting.cash.shortBy", { amount: formatMinor(-differenceMinor) })
            : t("accounting.cash.overBy", { amount: formatMinor(differenceMinor) })}
          <Field label={t("accounting.cash.discrepancyNote")}>
            <input
              className="text-input full-width"
              maxLength={500}
              onChange={(event) => setDiscrepancyNote(event.target.value)}
              value={discrepancyNote}
            />
          </Field>
        </div>
      )}
      {differenceMinor !== null && differenceMinor < 0 ? <p className="field-hint">{t("accounting.cash.partialHint")}</p> : null}

      <h4 className="handover-step">{t("accounting.cash.stepRecord")}</h4>
      <div className="row-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => void submit()} type="button">
          {busy ? t("common.working") : t("accounting.cash.recordHandover")}
        </button>
        <button className="btn btn-outline" onClick={props.onCancel} type="button">
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

/** Every handover this driver has made, newest first, each with its receipt. */
function DriverHandoverHistory(props: {
  driver: DriverCash;
  reloadToken: number;
  onError: SectionProps["onError"];
  onOpenReceipt: (settlement: CashSettlement) => void;
}) {
  const { t } = useTranslation();
  const [handovers, setHandovers] = useState<CashSettlement[] | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setHandovers(await listCashSettlements(props.driver.driverUserId));
      } catch (requestError) {
        props.onError(requestError, t("accounting.loadError"));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.driver.driverUserId, props.reloadToken]);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 className="card-title">{t("accounting.cash.historyTitle", { name: props.driver.driverName })}</h3>
      {handovers === null ? (
        <div className="loading-state">{t("common.loading")}</div>
      ) : handovers.length === 0 ? (
        <div className="empty-state">{t("accounting.cash.noHistory")}</div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("accounting.history.paidAt")}</th>
                <th>{t("accounting.history.counted")}</th>
                <th>{t("accounting.history.discrepancy")}</th>
                <th>{t("accounting.history.orders")}</th>
                <th>{t("accounting.history.reference")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {handovers.map((handover) => (
                <tr key={handover.id}>
                  <td>{new Date(handover.settledAt).toLocaleString()}</td>
                  <td>
                    <Money minor={handover.countedAmountMinor} />
                  </td>
                  <td>{handover.discrepancyMinor === 0 ? t("common.dash") : <Money minor={handover.discrepancyMinor} signed />}</td>
                  <td>{handover.allocations.length}</td>
                  <td dir="ltr">{handover.reference}</td>
                  <td>
                    <button className="btn btn-outline btn-sm" onClick={() => props.onOpenReceipt(handover)} type="button">
                      {t("accounting.receipt.open")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
