import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { ApiError, readApiError } from "../api";
import { useAuth } from "../auth";
import {
  decideOperatingCost,
  formatMinor,
  getAccountingOverview,
  listDriverCash,
  listDriverCustody,
  listOperatingCosts,
  listPartnerBalances,
  recordCashSettlement,
  recordPartnerSettlement,
  type AccountingOverview,
  type DriverCash,
  type DriverCustodyLine,
  type OperatingCostEntry,
  type PartnerBalance
} from "../api.accounting";
import { ConfirmModal } from "../components/ConfirmModal";
import { Field } from "../components/Field";
import { Money } from "../components/Money";
import { ReasonModal } from "../components/ReasonModal";
import { parseMoneyToMinor, parsePositiveMoneyToMinor } from "../money";
import { AdjustmentsSection } from "./accounting/AdjustmentsSection";
import { HistorySection } from "./accounting/HistorySection";
import { RatesSection } from "./accounting/RatesSection";
import { suggestReference, type SectionProps } from "./accounting/types";

/**
 * The books.
 *
 * Six questions, six tabs, in the order they get asked: who is owed what, which driver is still
 * carrying cash, what spending is waiting on a decision, what the rates are, what has actually been
 * paid, and — when a number turns out wrong — how to correct it.
 *
 * Every write here goes through a confirmation or an idempotency reference: the ledger underneath
 * is append-only, so a mistaken entry is corrected by another entry, never undone.
 */

type Tab = "balances" | "cash" | "costs" | "rates" | "history" | "adjustments";
const tabKeys: Tab[] = ["balances", "cash", "costs", "rates", "history", "adjustments"];

export function AccountingPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab");
  const tab: Tab = tabKeys.includes(requestedTab as Tab) ? (requestedTab as Tab) : "balances";
  const [overview, setOverview] = useState<AccountingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = () => setReloadToken((token) => token + 1);
  const report = (requestError: unknown, fallback: string) =>
    setError(readApiError(requestError, fallback));
  const changed = (message?: string) => {
    if (message) setNotice(message);
    reload();
  };
  const selectTab = (next: Tab) => {
    setError(null);
    setNotice(null);
    setParams(next === "balances" ? {} : { tab: next });
  };

  useEffect(() => {
    void (async () => {
      try {
        setOverview(await getAccountingOverview());
        setError(null);
      } catch (requestError) {
        report(requestError, t("accounting.loadError"));
      }
    })();
  }, [reloadToken]);

  const sectionProps: SectionProps = { onError: report, reloadToken, onChanged: reload };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("accounting.title")}</h1>
          <p className="page-subtitle">{t("accounting.subtitle")}</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="notice-banner">{notice}</div> : null}

      {overview ? <OverviewCard overview={overview} /> : error ? null : <div className="loading-state">{t("common.loading")}</div>}

      <div className="tab-row">
        {tabKeys.map((key) => (
          <button
            className={`btn btn-sm ${key === tab ? "btn-primary" : "btn-outline"}`}
            key={key}
            onClick={() => selectTab(key)}
            type="button"
          >
            {t(`accounting.tabs.${key}`)}
          </button>
        ))}
      </div>

      {tab === "balances" ? (
        <BalancesSection {...sectionProps} canPay={can("MANAGE_SETTLEMENTS")} onChanged={changed} />
      ) : null}
      {tab === "cash" ? (
        <DriverCashSection {...sectionProps} canReceive={can("RECEIVE_DRIVER_CASH")} onChanged={changed} />
      ) : null}
      {tab === "costs" ? (
        <OperatingCostsSection {...sectionProps} canApprove={can("APPROVE_OPERATING_COSTS")} onChanged={changed} />
      ) : null}
      {tab === "rates" ? <RatesSection {...sectionProps} canManage={can("MANAGE_ACCOUNTING_SETTINGS")} /> : null}
      {tab === "history" ? <HistorySection {...sectionProps} /> : null}
      {tab === "adjustments" ? (
        <AdjustmentsSection
          canRecord={can("MANAGE_SETTLEMENTS")}
          initialOrderId={params.get("order") ?? undefined}
          onChanged={reload}
        />
      ) : null}
    </div>
  );
}

/**
 * The platform-wide check. `ledgerImbalanceMinor` is the one number to look at first: every shekel
 * collected is owed to somebody, less whatever the operating costs consumed, so anything other
 * than zero means the ledger has drifted and needs investigating before anyone is paid.
 */
function OverviewCard({ overview }: { overview: AccountingOverview }) {
  const { t } = useTranslation();
  const balanced = overview.ledgerImbalanceMinor === 0;
  const costDataComplete = overview.costDataIncompleteCount === 0;
  return (
    <div className="card">
      <div className="table-scroll">
        <table className="data-table">
          <tbody>
            <tr>
              <th>{t("accounting.overview.orders")}</th>
              <td>
                {overview.deliveredCount} {t("accounting.overview.delivered")} / {overview.failedCount}{" "}
                {t("accounting.overview.failed")}
              </td>
              <th>{t("accounting.overview.cashCollected")}</th>
              <td>
                <Money minor={overview.cashCollectedMinor} />
              </td>
            </tr>
            <tr>
              <th>{t("accounting.overview.cashSettled")}</th>
              <td>
                <Money minor={overview.cashSettledMinor} />
              </td>
              <th>{t("accounting.overview.cashOutstanding")}</th>
              <td>
                <strong>
                  <Money minor={overview.cashOutstandingMinor} />
                </strong>
              </td>
            </tr>
            <tr>
              <th>{t("accounting.overview.totalEarned")}</th>
              <td>
                <Money minor={overview.totalEarnedMinor} />
              </td>
              <th>{t("accounting.overview.totalOutstanding")}</th>
              <td>
                <strong>
                  <Money minor={overview.totalOutstandingMinor} />
                </strong>
              </td>
            </tr>
            <tr>
              <th>{t("accounting.overview.operatingCosts")}</th>
              <td>
                <Money minor={overview.approvedOperatingCostMinor} />
              </td>
              <th>{t("accounting.overview.pendingCosts")}</th>
              <td>{overview.pendingOperatingCostCount}</td>
            </tr>
            <tr>
              <th>{t("accounting.overview.imbalance")}</th>
              <td colSpan={3}>
                <span className={balanced ? "badge badge-good" : "badge badge-danger"}>
                  {balanced ? t("accounting.overview.balanced") : <Money minor={overview.ledgerImbalanceMinor} signed />}
                </span>
              </td>
            </tr>
            <tr>
              <th>{t("accounting.overview.costDataIncomplete")}</th>
              <td colSpan={3}>
                <span className={costDataComplete ? "badge badge-good" : "badge badge-danger"}>
                  {costDataComplete ? t("accounting.overview.costDataComplete") : overview.costDataIncompleteCount}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {costDataComplete ? null : (
        // This is the one drift the imbalance figure above cannot show: those orders balance to
        // the agora and still paid the wrong parties, so it gets its own banner rather than a row
        // someone has to notice.
        <div className="error-banner" style={{ marginTop: 12 }}>
          {t("accounting.overview.costDataIncompleteWarning", { count: overview.costDataIncompleteCount })}
        </div>
      )}
    </div>
  );
}

/** Who is owed what, and what they have already been paid — never collapsed into one figure. */
function BalancesSection({
  onError,
  reloadToken,
  onChanged,
  canPay
}: Omit<SectionProps, "onChanged"> & { canPay: boolean; onChanged: (message?: string) => void }) {
  const { t } = useTranslation();
  const [balances, setBalances] = useState<PartnerBalance[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [paying, setPaying] = useState<PartnerBalance | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setBalances(await listPartnerBalances());
      } catch (error) {
        onError(error, t("accounting.loadError"));
      }
    })();
  }, [reloadToken]);

  if (balances === null) return <div className="loading-state">{t("common.loading")}</div>;
  if (balances.length === 0) return <div className="empty-state">{t("accounting.balances.empty")}</div>;

  return (
    <div className="card">
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("accounting.balances.party")}</th>
              <th>{t("accounting.balances.kind")}</th>
              <th>{t("accounting.balances.earned")}</th>
              <th>{t("accounting.balances.paid")}</th>
              <th>{t("accounting.balances.outstanding")}</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {balances.map((balance) => (
              <Fragment key={balance.payeeKey}>
                <tr>
                  <td>{balance.name}</td>
                  <td>{t(`accounting.payeeType.${balance.payeeType}`)}</td>
                  <td>
                    <Money minor={balance.earnedMinor} />
                  </td>
                  <td>
                    <Money minor={balance.paidMinor} />
                  </td>
                  <td>
                    <strong>
                      <Money minor={balance.outstandingMinor} signed={balance.outstandingMinor < 0} />
                    </strong>
                    {balance.outstandingMinor < 0 ? (
                      <>
                        <br />
                        <small>{t("accounting.balances.negative")}</small>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => setExpanded(expanded === balance.payeeKey ? null : balance.payeeKey)}
                        type="button"
                      >
                        {expanded === balance.payeeKey ? t("accounting.balances.hide") : t("accounting.balances.breakdown")}
                      </button>
                      {canPay && balance.outstandingMinor > 0 ? (
                        <button className="btn btn-primary btn-sm" onClick={() => setPaying(balance)} type="button">
                          {t("accounting.balances.pay")}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
                {expanded === balance.payeeKey ? (
                  <tr>
                    <td colSpan={6}>
                      <table className="data-table">
                        <tbody>
                          {balance.byComponent.map((part) => (
                            <tr key={part.component}>
                              <td>{t(`accounting.component.${part.component}`, part.component)}</td>
                              <td>{part.entryCount}</td>
                              <td>
                                <Money minor={part.amountMinor} signed={part.amountMinor < 0} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {paying ? (
        <PayoutForm
          balance={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            onChanged(t("accounting.balances.recorded", { name: paying.name }));
          }}
        />
      ) : null}
    </div>
  );
}

function PayoutForm({
  balance,
  onClose,
  onDone
}: {
  balance: PartnerBalance;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState(formatMinor(balance.outstandingMinor));
  // Fixed for the life of the form: a retry after a dropped connection re-sends the same reference,
  // and the server refuses the duplicate instead of paying twice.
  const [reference, setReference] = useState(() => suggestReference("PAYOUT"));
  const [method, setMethod] = useState<"CASH" | "BANK_TRANSFER" | "OFFSET">("CASH");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const amountMinor = parsePositiveMoneyToMinor(amount);
    if (amountMinor === null) return setError(t("accounting.balances.invalidAmount"));
    if (amountMinor > balance.outstandingMinor) {
      return setError(t("accounting.balances.exceedsBalance", { amount: formatMinor(balance.outstandingMinor) }));
    }
    if (reference.trim().length < 3) return setError(t("accounting.balances.referenceRequired"));
    setBusy(true);
    setError(null);
    try {
      await recordPartnerSettlement({
        ...(balance.partnerAccountId ? { partnerAccountId: balance.partnerAccountId } : {}),
        ...(balance.businessId ? { businessId: balance.businessId } : {}),
        ...(balance.driverUserId ? { driverUserId: balance.driverUserId } : {}),
        amountMinor,
        method,
        reference: reference.trim(),
        ...(note.trim() ? { note: note.trim() } : {})
      });
      onDone();
    } catch (requestError) {
      setError(readApiError(requestError, t("common.genericActionError")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 className="card-title">{t("accounting.balances.payTitle", { name: balance.name })}</h3>
      {error ? <div className="error-banner">{error}</div> : null}
      <div className="form-grid">
        <Field
          hint={t("accounting.balances.owedHint", { amount: formatMinor(balance.outstandingMinor) })}
          label={t("accounting.balances.amountLabel")}
        >
          <input
            className="text-input"
            dir="ltr"
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
            value={amount}
          />
        </Field>
        <Field label={t("accounting.balances.methodLabel")}>
          <select className="select" onChange={(event) => setMethod(event.target.value as typeof method)} value={method}>
            <option value="CASH">{t("accounting.method.CASH")}</option>
            <option value="BANK_TRANSFER">{t("accounting.method.BANK_TRANSFER")}</option>
            <option value="OFFSET">{t("accounting.method.OFFSET")}</option>
          </select>
        </Field>
        <Field label={t("accounting.balances.referenceLabel")}>
          <input
            className="text-input"
            dir="ltr"
            onChange={(event) => setReference(event.target.value)}
            placeholder={t("accounting.balances.referencePlaceholder")}
            value={reference}
          />
        </Field>
        <Field label={t("accounting.balances.noteLabel")}>
          <input className="text-input" maxLength={500} onChange={(event) => setNote(event.target.value)} value={note} />
        </Field>
      </div>
      <div className="row-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => void submit()} type="button">
          {busy ? t("common.working") : t("accounting.balances.recordPayout")}
        </button>
        <button className="btn btn-outline" onClick={onClose} type="button">
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

/**
 * Cash still in drivers' pockets. Reported entirely separately from what each driver has earned:
 * a driver holding 320.00 of customers' money and being owed 14.00 in pay are two different facts
 * about two different pockets, and adding them together is how a cash business loses track.
 */
function DriverCashSection({
  onError,
  reloadToken,
  onChanged,
  canReceive
}: Omit<SectionProps, "onChanged"> & { canReceive: boolean; onChanged: (message?: string) => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<DriverCash[] | null>(null);
  const [openDriver, setOpenDriver] = useState<DriverCash | null>(null);
  const [custody, setCustody] = useState<DriverCustodyLine[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [counted, setCounted] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [discrepancyNote, setDiscrepancyNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setRows(await listDriverCash());
      } catch (requestError) {
        onError(requestError, t("accounting.loadError"));
      }
    })();
  }, [reloadToken]);

  const openHandover = async (driver: DriverCash) => {
    setOpenDriver(driver);
    setCounted(formatMinor(driver.outstandingMinor));
    setReference(suggestReference("HANDOVER"));
    setNote("");
    setDiscrepancyNote("");
    setSelected(new Set());
    setError(null);
    setCustody(null);
    try {
      setCustody(await listDriverCustody(driver.driverUserId));
    } catch (requestError) {
      onError(requestError, t("accounting.loadError"));
    }
  };

  // What the receiver should be holding: the whole balance, or just the ticked orders.
  const expectedMinor = !openDriver
    ? 0
    : selected.size === 0
      ? openDriver.outstandingMinor
      : (custody ?? []).filter((line) => selected.has(line.custodyId)).reduce((sum, line) => sum + line.outstandingMinor, 0);
  const countedMinor = parseMoneyToMinor(counted);
  const differenceMinor = countedMinor === null ? null : countedMinor - expectedMinor;

  const toggle = (custodyId: string) => {
    const next = new Set(selected);
    if (next.has(custodyId)) next.delete(custodyId);
    else next.add(custodyId);
    setSelected(next);
    const expected =
      next.size === 0
        ? (openDriver?.outstandingMinor ?? 0)
        : (custody ?? []).filter((line) => next.has(line.custodyId)).reduce((sum, line) => sum + line.outstandingMinor, 0);
    setCounted(formatMinor(expected));
  };

  const submitHandover = async () => {
    if (!openDriver) return;
    if (countedMinor === null) return setError(t("accounting.cash.invalidAmount"));
    if (reference.trim().length < 3) return setError(t("accounting.balances.referenceRequired"));
    if (differenceMinor !== 0 && !discrepancyNote.trim()) return setError(t("accounting.cash.discrepancyNoteRequired"));
    setBusy(true);
    setError(null);
    try {
      await recordCashSettlement({
        driverUserId: openDriver.driverUserId,
        reference: reference.trim(),
        countedAmountMinor: countedMinor,
        ...(selected.size > 0 ? { custodyIds: [...selected] } : {}),
        ...(differenceMinor !== 0 ? { discrepancyNote: discrepancyNote.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {})
      });
      const name = openDriver.driverName;
      setOpenDriver(null);
      onChanged(t("accounting.cash.recorded", { name }));
    } catch (requestError) {
      setError(readApiError(requestError, t("common.genericActionError")));
    } finally {
      setBusy(false);
    }
  };

  if (rows === null) return <div className="loading-state">{t("common.loading")}</div>;
  if (rows.length === 0) return <div className="empty-state">{t("accounting.cash.empty")}</div>;

  return (
    <div className="card">
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("common.name")}</th>
              <th>{t("accounting.cash.collected")}</th>
              <th>{t("accounting.cash.settled")}</th>
              <th>{t("accounting.cash.outstanding")}</th>
              <th>{t("accounting.cash.openOrders")}</th>
              <th>{t("accounting.cash.earnings")}</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.driverUserId}>
                <td>
                  {row.driverName}
                  <br />
                  <small dir="ltr">{row.driverPhone}</small>
                </td>
                <td>
                  <Money minor={row.collectedMinor} />
                </td>
                <td>
                  <Money minor={row.settledMinor} />
                </td>
                <td>
                  <strong>
                    <Money minor={row.outstandingMinor} />
                  </strong>
                </td>
                <td>{row.outstandingOrderCount}</td>
                <td>
                  <Money minor={row.earningsMinor} /> ({t("accounting.cash.paidLabel")}{" "}
                  <Money minor={row.earningsPaidMinor} />)
                </td>
                <td>
                  {canReceive && row.outstandingMinor > 0 ? (
                    <button className="btn btn-primary btn-sm" onClick={() => void openHandover(row)} type="button">
                      {t("accounting.cash.recordHandover")}
                    </button>
                  ) : (
                    t("common.dash")
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openDriver ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="card-title">{t("accounting.cash.handoverTitle", { name: openDriver.driverName })}</h3>
          {error ? <div className="error-banner">{error}</div> : null}
          <p className="page-subtitle">
            {t("accounting.cash.expected")}: <strong><Money minor={expectedMinor} /></strong>
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
          {differenceMinor !== null && differenceMinor < 0 ? (
            <p className="field-hint">{t("accounting.cash.partialHint")}</p>
          ) : null}

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
                          checked={selected.has(line.custodyId)}
                          onChange={() => toggle(line.custodyId)}
                          type="checkbox"
                        />
                      </td>
                      <td dir="ltr">{line.orderId.slice(0, 8)}</td>
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

          <div className="row-actions" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" disabled={busy} onClick={() => void submitHandover()} type="button">
              {busy ? t("common.working") : t("accounting.cash.recordHandover")}
            </button>
            <button className="btn btn-outline" onClick={() => setOpenDriver(null)} type="button">
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const costStatuses = ["", "PROPOSED", "APPROVED", "REJECTED"] as const;

/** The approval queue: what the supermarket side has asked to spend, and what was decided. */
function OperatingCostsSection({
  onError,
  reloadToken,
  onChanged,
  canApprove
}: Omit<SectionProps, "onChanged"> & { canApprove: boolean; onChanged: (message?: string) => void }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<OperatingCostEntry[] | null>(null);
  const [status, setStatus] = useState<(typeof costStatuses)[number]>("");
  const [approving, setApproving] = useState<OperatingCostEntry | null>(null);
  const [rejecting, setRejecting] = useState<OperatingCostEntry | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setEntries(await listOperatingCosts(status || undefined));
      } catch (error) {
        onError(error, t("accounting.loadError"));
      }
    })();
  }, [reloadToken, status]);

  if (entries === null) return <div className="loading-state">{t("common.loading")}</div>;

  return (
    <div className="card">
      <div className="filters-row">
        <select
          aria-label={t("accounting.costs.filterLabel")}
          className="select"
          onChange={(event) => setStatus(event.target.value as typeof status)}
          value={status}
        >
          {costStatuses.map((value) => (
            <option key={value} value={value}>
              {value === "" ? t("common.all") : t(`accounting.costStatus.${value}`)}
            </option>
          ))}
        </select>
      </div>
      {entries.length === 0 ? (
        <div className="empty-state">{t("accounting.costs.empty")}</div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("accounting.costs.business")}</th>
                <th>{t("accounting.costs.category")}</th>
                <th>{t("accounting.costs.description")}</th>
                <th>{t("accounting.costs.amount")}</th>
                <th>{t("accounting.costs.period")}</th>
                <th>{t("common.status")}</th>
                <th>{t("accounting.costs.split")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.businessName}</td>
                  <td>{t(`accounting.costCategory.${entry.category}`, entry.category)}</td>
                  <td>
                    {entry.description}
                    <br />
                    <small>
                      {t("accounting.costs.proposedBy")} {entry.proposedByName}
                    </small>
                  </td>
                  <td>
                    <Money minor={entry.amountMinor} />
                  </td>
                  <td>{entry.periodLabel ?? new Date(entry.incurredOn).toLocaleDateString()}</td>
                  <td>
                    {t(`accounting.costStatus.${entry.status}`)}
                    {entry.approverName ? (
                      <>
                        <br />
                        <small>{entry.approverName}</small>
                      </>
                    ) : null}
                    {entry.decisionNote ? (
                      <>
                        <br />
                        <small>{entry.decisionNote}</small>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {entry.shares.length === 0
                      ? t("common.dash")
                      : entry.shares.map((share) => (
                          <div key={share.payeeKey}>
                            {share.payeeName}: <Money minor={share.amountMinor} />
                          </div>
                        ))}
                  </td>
                  <td>
                    {entry.status === "PROPOSED" && canApprove ? (
                      <div className="row-actions">
                        <button className="btn btn-primary btn-sm" onClick={() => setApproving(entry)} type="button">
                          {t("common.approve")}
                        </button>
                        <button className="btn btn-outline btn-sm" onClick={() => setRejecting(entry)} type="button">
                          {t("common.reject")}
                        </button>
                      </div>
                    ) : (
                      t("common.dash")
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {approving ? (
        <ConfirmModal
          confirmLabel={t("accounting.costs.approveConfirm")}
          description={t("accounting.costs.approveBody", { amount: formatMinor(approving.amountMinor) })}
          onCancel={() => setApproving(null)}
          onConfirm={async () => {
            await decideOperatingCost(approving.id, { approve: true });
            setApproving(null);
            onChanged(t("accounting.costs.decided"));
          }}
          title={t("accounting.costs.approveTitle")}
          tone="primary"
        />
      ) : null}
      {rejecting ? (
        <ReasonModal
          confirmLabel={t("accounting.costs.rejectConfirm")}
          description={t("accounting.costs.rejectBody")}
          onCancel={() => setRejecting(null)}
          onConfirm={async (reason) => {
            await decideOperatingCost(rejecting.id, { approve: false, note: reason });
            setRejecting(null);
            onChanged(t("accounting.costs.decided"));
          }}
          title={t("accounting.costs.rejectTitle")}
        />
      ) : null}
    </div>
  );
}
