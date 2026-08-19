import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import {
  decideOperatingCost,
  formatBp,
  formatMinor,
  getAccountingOverview,
  listDriverCash,
  listDriverCustody,
  listOperatingCosts,
  listPartnerBalances,
  listRateSets,
  recordCashSettlement,
  recordPartnerSettlement,
  type AccountingOverview,
  type DriverCash,
  type DriverCustodyLine,
  type OperatingCostEntry,
  type PartnerBalance,
  type RateSet
} from "../api.accounting";

/**
 * The books.
 *
 * Four questions, four sections, in the order they get asked: what does the platform hold, who is
 * owed what, which driver is still carrying cash, and what spending is waiting on a decision.
 *
 * Deliberately plain. This is the working tool the accounting layer needed to be usable at all;
 * the visual pass belongs to the design phase and nothing here presumes what that will look like.
 */

type Tab = "balances" | "cash" | "costs" | "rates";

export function AccountingPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("balances");
  const [overview, setOverview] = useState<AccountingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = () => setReloadToken((token) => token + 1);
  const report = (requestError: unknown, fallback: string) =>
    setError(requestError instanceof ApiError ? requestError.message : fallback);

  useEffect(() => {
    void (async () => {
      try {
        setOverview(await getAccountingOverview());
      } catch (requestError) {
        report(requestError, t("accounting.loadError"));
      }
    })();
  }, [reloadToken]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "balances", label: t("accounting.tabs.balances") },
    { key: "cash", label: t("accounting.tabs.cash") },
    { key: "costs", label: t("accounting.tabs.costs") },
    { key: "rates", label: t("accounting.tabs.rates") }
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("accounting.title")}</h1>
          <p className="page-subtitle">{t("accounting.subtitle")}</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {overview ? <OverviewCard overview={overview} /> : <div className="loading-state">{t("common.loading")}</div>}

      <div className="filters-row" style={{ marginTop: 16, marginBottom: 16 }}>
        {tabs.map((entry) => (
          <button
            className={entry.key === tab ? "primary-button" : "secondary-button"}
            key={entry.key}
            onClick={() => setTab(entry.key)}
            type="button"
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "balances" ? <BalancesSection onError={report} reloadToken={reloadToken} onChanged={reload} canPay={can("MANAGE_SETTLEMENTS")} /> : null}
      {tab === "cash" ? <DriverCashSection onError={report} reloadToken={reloadToken} onChanged={reload} canReceive={can("RECEIVE_DRIVER_CASH")} /> : null}
      {tab === "costs" ? <OperatingCostsSection onError={report} reloadToken={reloadToken} onChanged={reload} canApprove={can("APPROVE_OPERATING_COSTS")} /> : null}
      {tab === "rates" ? <RatesSection onError={report} reloadToken={reloadToken} /> : null}
    </div>
  );
}

type SectionProps = {
  onError: (error: unknown, fallback: string) => void;
  reloadToken: number;
  onChanged?: () => void;
};

/**
 * The platform-wide check. `ledgerImbalanceMinor` is the one number to look at first: every shekel
 * collected is owed to somebody, less whatever the operating costs consumed, so anything other
 * than zero means the ledger has drifted and needs investigating before anyone is paid.
 */
function OverviewCard({ overview }: { overview: AccountingOverview }) {
  const { t } = useTranslation();
  const balanced = overview.ledgerImbalanceMinor === 0;
  return (
    <div className="card">
      <table className="data-table">
        <tbody>
          <tr>
            <th>{t("accounting.overview.orders")}</th>
            <td>
              {overview.deliveredCount} {t("accounting.overview.delivered")} / {overview.failedCount}{" "}
              {t("accounting.overview.failed")}
            </td>
            <th>{t("accounting.overview.cashCollected")}</th>
            <td>{formatMinor(overview.cashCollectedMinor)}</td>
          </tr>
          <tr>
            <th>{t("accounting.overview.cashSettled")}</th>
            <td>{formatMinor(overview.cashSettledMinor)}</td>
            <th>{t("accounting.overview.cashOutstanding")}</th>
            <td>
              <strong>{formatMinor(overview.cashOutstandingMinor)}</strong>
            </td>
          </tr>
          <tr>
            <th>{t("accounting.overview.totalEarned")}</th>
            <td>{formatMinor(overview.totalEarnedMinor)}</td>
            <th>{t("accounting.overview.totalOutstanding")}</th>
            <td>
              <strong>{formatMinor(overview.totalOutstandingMinor)}</strong>
            </td>
          </tr>
          <tr>
            <th>{t("accounting.overview.operatingCosts")}</th>
            <td>{formatMinor(overview.approvedOperatingCostMinor)}</td>
            <th>{t("accounting.overview.pendingCosts")}</th>
            <td>{overview.pendingOperatingCostCount}</td>
          </tr>
          <tr>
            <th>{t("accounting.overview.imbalance")}</th>
            <td colSpan={3}>
              <span className={balanced ? "status-pill status-approved" : "status-pill status-error"}>
                {balanced ? t("accounting.overview.balanced") : formatMinor(overview.ledgerImbalanceMinor)}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Who is owed what, and what they have already been paid — never collapsed into one figure. */
function BalancesSection({ onError, reloadToken, onChanged, canPay }: SectionProps & { canPay: boolean }) {
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
            <>
              <tr key={balance.payeeKey}>
                <td>{balance.name}</td>
                <td>{t(`accounting.payeeType.${balance.payeeType}`)}</td>
                <td>{formatMinor(balance.earnedMinor)}</td>
                <td>{formatMinor(balance.paidMinor)}</td>
                <td>
                  <strong>{formatMinor(balance.outstandingMinor)}</strong>
                </td>
                <td>
                  <button
                    className="secondary-button"
                    onClick={() => setExpanded(expanded === balance.payeeKey ? null : balance.payeeKey)}
                    type="button"
                  >
                    {expanded === balance.payeeKey ? t("accounting.balances.hide") : t("accounting.balances.breakdown")}
                  </button>
                  {canPay && balance.outstandingMinor > 0 ? (
                    <button className="primary-button" onClick={() => setPaying(balance)} type="button">
                      {t("accounting.balances.pay")}
                    </button>
                  ) : null}
                </td>
              </tr>
              {expanded === balance.payeeKey ? (
                <tr key={`${balance.payeeKey}-breakdown`}>
                  <td colSpan={6}>
                    <table className="data-table">
                      <tbody>
                        {balance.byComponent.map((part) => (
                          <tr key={part.component}>
                            <td>{t(`accounting.component.${part.component}`, part.component)}</td>
                            <td>{part.entryCount}</td>
                            <td>{formatMinor(part.amountMinor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              ) : null}
            </>
          ))}
        </tbody>
      </table>

      {paying ? (
        <PayoutForm
          balance={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            onChanged?.();
          }}
          onError={onError}
        />
      ) : null}
    </div>
  );
}

function PayoutForm({
  balance,
  onClose,
  onDone,
  onError
}: {
  balance: PartnerBalance;
  onClose: () => void;
  onDone: () => void;
  onError: (error: unknown, fallback: string) => void;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState(formatMinor(balance.outstandingMinor));
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState<"CASH" | "BANK_TRANSFER" | "OFFSET">("CASH");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const amountMinor = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      onError(null, t("accounting.balances.invalidAmount"));
      return;
    }
    if (!reference.trim()) {
      onError(null, t("accounting.balances.referenceRequired"));
      return;
    }
    setBusy(true);
    try {
      await recordPartnerSettlement({
        ...(balance.partnerAccountId ? { partnerAccountId: balance.partnerAccountId } : {}),
        ...(balance.businessId ? { businessId: balance.businessId } : {}),
        ...(balance.driverUserId ? { driverUserId: balance.driverUserId } : {}),
        amountMinor,
        method,
        reference: reference.trim()
      });
      onDone();
    } catch (error) {
      onError(error, t("common.genericActionError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>{t("accounting.balances.payTitle", { name: balance.name })}</h3>
      <div className="filters-row">
        <input className="text-input" onChange={(event) => setAmount(event.target.value)} value={amount} />
        <input
          className="text-input"
          onChange={(event) => setReference(event.target.value)}
          placeholder={t("accounting.balances.referencePlaceholder")}
          value={reference}
        />
        <select className="text-input" onChange={(event) => setMethod(event.target.value as typeof method)} value={method}>
          <option value="CASH">{t("accounting.method.CASH")}</option>
          <option value="BANK_TRANSFER">{t("accounting.method.BANK_TRANSFER")}</option>
          <option value="OFFSET">{t("accounting.method.OFFSET")}</option>
        </select>
        <button className="primary-button" disabled={busy} onClick={() => void submit()} type="button">
          {busy ? t("common.working") : t("accounting.balances.recordPayout")}
        </button>
        <button className="secondary-button" onClick={onClose} type="button">
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
function DriverCashSection({ onError, reloadToken, onChanged, canReceive }: SectionProps & { canReceive: boolean }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<DriverCash[] | null>(null);
  const [openDriver, setOpenDriver] = useState<DriverCash | null>(null);
  const [custody, setCustody] = useState<DriverCustodyLine[] | null>(null);
  const [counted, setCounted] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setRows(await listDriverCash());
      } catch (error) {
        onError(error, t("accounting.loadError"));
      }
    })();
  }, [reloadToken]);

  const openHandover = async (driver: DriverCash) => {
    setOpenDriver(driver);
    setCounted(formatMinor(driver.outstandingMinor));
    setReference("");
    setCustody(null);
    try {
      setCustody(await listDriverCustody(driver.driverUserId));
    } catch (error) {
      onError(error, t("accounting.loadError"));
    }
  };

  const submitHandover = async () => {
    if (!openDriver) return;
    const countedAmountMinor = Math.round(Number(counted) * 100);
    if (!Number.isFinite(countedAmountMinor) || countedAmountMinor < 0) {
      onError(null, t("accounting.cash.invalidAmount"));
      return;
    }
    if (!reference.trim()) {
      onError(null, t("accounting.balances.referenceRequired"));
      return;
    }
    setBusy(true);
    try {
      await recordCashSettlement({
        driverUserId: openDriver.driverUserId,
        reference: reference.trim(),
        countedAmountMinor
      });
      setOpenDriver(null);
      onChanged?.();
    } catch (error) {
      onError(error, t("common.genericActionError"));
    } finally {
      setBusy(false);
    }
  };

  if (rows === null) return <div className="loading-state">{t("common.loading")}</div>;
  if (rows.length === 0) return <div className="empty-state">{t("accounting.cash.empty")}</div>;

  return (
    <div className="card">
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
                <small>{row.driverPhone}</small>
              </td>
              <td>{formatMinor(row.collectedMinor)}</td>
              <td>{formatMinor(row.settledMinor)}</td>
              <td>
                <strong>{formatMinor(row.outstandingMinor)}</strong>
              </td>
              <td>{row.outstandingOrderCount}</td>
              <td>
                {formatMinor(row.earningsMinor)} ({t("accounting.cash.paidLabel")} {formatMinor(row.earningsPaidMinor)})
              </td>
              <td>
                {canReceive && row.outstandingMinor > 0 ? (
                  <button className="primary-button" onClick={() => void openHandover(row)} type="button">
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

      {openDriver ? (
        <div className="card">
          <h3>{t("accounting.cash.handoverTitle", { name: openDriver.driverName })}</h3>
          <p className="page-subtitle">
            {t("accounting.cash.expected")}: <strong>{formatMinor(openDriver.outstandingMinor)}</strong>
          </p>
          <div className="filters-row">
            <input
              className="text-input"
              onChange={(event) => setCounted(event.target.value)}
              placeholder={t("accounting.cash.countedPlaceholder")}
              value={counted}
            />
            <input
              className="text-input"
              onChange={(event) => setReference(event.target.value)}
              placeholder={t("accounting.balances.referencePlaceholder")}
              value={reference}
            />
            <button className="primary-button" disabled={busy} onClick={() => void submitHandover()} type="button">
              {busy ? t("common.working") : t("accounting.cash.recordHandover")}
            </button>
            <button className="secondary-button" onClick={() => setOpenDriver(null)} type="button">
              {t("common.cancel")}
            </button>
          </div>
          {custody ? (
            <table className="data-table">
              <thead>
                <tr>
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
                    <td>{line.orderId.slice(0, 8)}</td>
                    <td>{new Date(line.collectedAt).toLocaleString()}</td>
                    <td>{formatMinor(line.collectedAmountMinor)}</td>
                    <td>{formatMinor(line.settledAmountMinor)}</td>
                    <td>{formatMinor(line.outstandingMinor)}</td>
                    <td>{t(`accounting.custodyStatus.${line.status}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The approval queue: what the supermarket side has asked to spend, and what was decided. */
function OperatingCostsSection({ onError, reloadToken, onChanged, canApprove }: SectionProps & { canApprove: boolean }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<OperatingCostEntry[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setEntries(await listOperatingCosts());
      } catch (error) {
        onError(error, t("accounting.loadError"));
      }
    })();
  }, [reloadToken]);

  const decide = async (entry: OperatingCostEntry, approve: boolean) => {
    setBusyId(entry.id);
    try {
      await decideOperatingCost(entry.id, { approve });
      onChanged?.();
    } catch (error) {
      onError(error, t("common.genericActionError"));
    } finally {
      setBusyId(null);
    }
  };

  if (entries === null) return <div className="loading-state">{t("common.loading")}</div>;
  if (entries.length === 0) return <div className="empty-state">{t("accounting.costs.empty")}</div>;

  return (
    <div className="card">
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
              <td>{formatMinor(entry.amountMinor)}</td>
              <td>{entry.periodLabel ?? new Date(entry.incurredOn).toLocaleDateString()}</td>
              <td>
                {t(`accounting.costStatus.${entry.status}`)}
                {entry.approverName ? (
                  <>
                    <br />
                    <small>{entry.approverName}</small>
                  </>
                ) : null}
              </td>
              <td>
                {entry.shares.length === 0
                  ? t("common.dash")
                  : entry.shares.map((share) => (
                      <div key={share.payeeKey}>
                        {share.payeeName}: {formatMinor(share.amountMinor)}
                      </div>
                    ))}
              </td>
              <td>
                {entry.status === "PROPOSED" && canApprove ? (
                  <>
                    <button
                      className="primary-button"
                      disabled={busyId === entry.id}
                      onClick={() => void decide(entry, true)}
                      type="button"
                    >
                      {t("common.approve")}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busyId === entry.id}
                      onClick={() => void decide(entry, false)}
                      type="button"
                    >
                      {t("common.reject")}
                    </button>
                  </>
                ) : (
                  t("common.dash")
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Every published rate set. Read-only here: a rate changes by publishing a version, never by edit. */
function RatesSection({ onError, reloadToken }: SectionProps) {
  const { t } = useTranslation();
  const [rates, setRates] = useState<RateSet[] | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setRates(await listRateSets());
      } catch (error) {
        onError(error, t("accounting.loadError"));
      }
    })();
  }, [reloadToken]);

  if (rates === null) return <div className="loading-state">{t("common.loading")}</div>;

  return (
    <div className="card">
      <p className="page-subtitle">{t("accounting.rates.note")}</p>
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("accounting.rates.version")}</th>
            <th>{t("accounting.rates.effectiveFrom")}</th>
            <th>{t("accounting.rates.commission")}</th>
            <th>{t("accounting.rates.subscription")}</th>
            <th>{t("accounting.rates.marginSplit")}</th>
            <th>{t("accounting.rates.costSplit")}</th>
            <th>{t("accounting.rates.driverShare")}</th>
            <th>{t("accounting.rates.note_")}</th>
          </tr>
        </thead>
        <tbody>
          {rates.map((rate) => (
            <tr key={rate.id}>
              <td>
                {rate.version}
                {rate.isCurrent ? <strong> ({t("accounting.rates.current")})</strong> : null}
              </td>
              <td>{new Date(rate.effectiveFrom).toLocaleDateString()}</td>
              <td>
                {formatBp(rate.restaurantCommissionBp)} / {formatBp(rate.promotionalCommissionBp)}
              </td>
              <td>{formatMinor(rate.monthlySubscriptionMinor)}</td>
              <td>
                {formatBp(rate.supermarketPartnerMarginBp)} / {formatBp(rate.ownerAMarginBp)} /{" "}
                {formatBp(rate.ownerBMarginBp)}
              </td>
              <td>
                {formatBp(rate.supermarketPartnerCostBp)} / {formatBp(rate.ownerACostBp)} /{" "}
                {formatBp(rate.ownerBCostBp)}
              </td>
              <td>{formatBp(rate.driverDeliveryShareBp)}</td>
              <td>{rate.note ?? t("common.dash")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
