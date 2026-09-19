import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  buildRateSet,
  rateSetToDraft,
  type RateSetDraft
} from "../../accounting-forms";
import {
  createRateSet,
  formatBp,
  formatMinor,
  generateSubscriptions,
  listRateSets,
  type RateSet,
  type SubscriptionRun
} from "../../api.accounting";
import { ConfirmModal } from "../../components/ConfirmModal";
import { Field } from "../../components/Field";
import { Money } from "../../components/Money";
import { parsePercentToBp, parseWholeNumber } from "../../money";
import type { SectionProps } from "./types";

/**
 * Every published rate set, and the two things an operator does with the rates: publish a new
 * version, and raise a month's subscriptions.
 *
 * A rate set is immutable (a database trigger refuses edits), so "changing a rate" always means
 * publishing a new version that takes effect from a date. Orders already delivered keep the
 * version they were valued under; that is the whole point of versioning, and the form says so.
 */
export function RatesSection({ onError, reloadToken, onChanged, canManage }: SectionProps & { canManage: boolean }) {
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
  const current = rates.find((rate) => rate.isCurrent) ?? rates[0];

  return (
    <>
      {canManage && current ? <PublishRateSet current={current} onPublished={() => onChanged?.()} /> : null}
      {canManage ? <GenerateSubscriptions onDone={() => onChanged?.()} /> : null}

      <div className="card">
        <p className="page-subtitle">{t("accounting.rates.note")}</p>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("accounting.rates.version")}</th>
                <th>{t("accounting.rates.effectiveFrom")}</th>
                <th>{t("accounting.rates.commission")}</th>
                <th>{t("accounting.rates.commissionWeightsCol")}</th>
                <th>{t("accounting.rates.subscription")}</th>
                <th>{t("accounting.rates.marginSplit")}</th>
                <th>{t("accounting.rates.costSplit")}</th>
                <th>{t("accounting.rates.driverShare")}</th>
                <th>{t("accounting.rates.deliveryWeightsCol")}</th>
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
                  <td className="money">
                    {formatBp(rate.restaurantCommissionBp)} / {formatBp(rate.promotionalCommissionBp)}
                  </td>
                  <td className="money">
                    {rate.commissionOwnerAWeight} / {rate.commissionOwnerBWeight}
                  </td>
                  <td>
                    <Money minor={rate.monthlySubscriptionMinor} />
                  </td>
                  <td className="money">
                    {formatBp(rate.supermarketPartnerMarginBp)} / {formatBp(rate.ownerAMarginBp)} /{" "}
                    {formatBp(rate.ownerBMarginBp)}
                  </td>
                  <td className="money">
                    {formatBp(rate.supermarketPartnerCostBp)} / {formatBp(rate.ownerACostBp)} /{" "}
                    {formatBp(rate.ownerBCostBp)}
                  </td>
                  <td className="money">{formatBp(rate.driverDeliveryShareBp)}</td>
                  <td className="money">
                    {rate.deliveryOpsRemainderWeight} / {rate.ownerADeliveryRemainderWeight} /{" "}
                    {rate.ownerBDeliveryRemainderWeight}
                  </td>
                  <td>{rate.note ?? t("common.dash")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/** Which column of the rates table a changed field belongs to, so the confirmation can name it. */
const changeLabelKey: Record<string, string> = {
  restaurantCommissionBp: "accounting.rates.restaurantCommission",
  promotionalCommissionBp: "accounting.rates.promotionalCommission",
  monthlySubscriptionMinor: "accounting.rates.monthlySubscription",
  commissionOwnerAWeight: "accounting.rates.commissionWeightsCol",
  commissionOwnerBWeight: "accounting.rates.commissionWeightsCol",
  supermarketPartnerMarginBp: "accounting.rates.marginSplit",
  ownerAMarginBp: "accounting.rates.marginSplit",
  ownerBMarginBp: "accounting.rates.marginSplit",
  supermarketPartnerCostBp: "accounting.rates.costSplit",
  ownerACostBp: "accounting.rates.costSplit",
  ownerBCostBp: "accounting.rates.costSplit",
  driverDeliveryShareBp: "accounting.rates.driverShare",
  deliveryOpsRemainderWeight: "accounting.rates.deliveryWeightsCol",
  ownerADeliveryRemainderWeight: "accounting.rates.deliveryWeightsCol",
  ownerBDeliveryRemainderWeight: "accounting.rates.deliveryWeightsCol"
};

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

function PublishRateSet({ current, onPublished }: { current: RateSet; onPublished: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RateSetDraft>(() => rateSetToDraft(current, tomorrow()));
  const [error, setError] = useState<{ key: string; field?: keyof RateSetDraft } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ReturnType<typeof buildRateSet> | null>(null);

  const set = (field: keyof RateSetDraft) => (event: { target: { value: string } }) =>
    setDraft((previous) => ({ ...previous, [field]: event.target.value }));
  const fieldError = (field: keyof RateSetDraft) =>
    error?.field === field ? t(`accounting.rates.errors.${error.key}`) : null;

  const splitTotal = (fields: (keyof RateSetDraft)[]) => {
    const parts = fields.map((field) => parsePercentToBp(draft[field]));
    return parts.some((part) => part === null) ? null : parts.reduce<number>((sum, part) => sum + (part ?? 0), 0);
  };
  const marginTotal = splitTotal(["supermarketPartnerMargin", "ownerAMargin", "ownerBMargin"]);
  const costTotal = splitTotal(["supermarketPartnerCost", "ownerACost", "ownerBCost"]);

  const review = () => {
    setNotice(null);
    const result = buildRateSet(draft, current, current.effectiveFrom);
    if (!result.ok) {
      setError({ key: result.error, field: result.field });
      return;
    }
    setError(null);
    setConfirming(result);
  };

  const submit = async () => {
    if (!confirming || !confirming.ok) return;
    const created = await createRateSet(confirming.body);
    setConfirming(null);
    setOpen(false);
    setDraft(rateSetToDraft(created, tomorrow()));
    setNotice(t("accounting.rates.success", { version: created.version }));
    onPublished();
  };

  const percentField = (field: keyof RateSetDraft, label: string) => (
    <Field error={fieldError(field)} label={label}>
      <input className="text-input" dir="ltr" inputMode="decimal" onChange={set(field)} value={draft[field]} />
    </Field>
  );
  const weightField = (field: keyof RateSetDraft, label: string) => (
    <Field error={fieldError(field)} label={label}>
      <input className="text-input" dir="ltr" inputMode="numeric" onChange={set(field)} value={draft[field]} />
    </Field>
  );

  const changeSummary =
    confirming && confirming.ok
      ? confirming.changedKeys.length === 0
        ? t("accounting.rates.noChanges")
        : [...new Set(confirming.changedKeys.map((key) => t(changeLabelKey[key])))].join("، ")
      : "";

  return (
    <div className="card">
      {notice ? <div className="notice-banner">{notice}</div> : null}
      {!open ? (
        <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)} type="button">
          {t("accounting.rates.open")}
        </button>
      ) : (
        <>
          <h2 className="card-title">{t("accounting.rates.publish")}</h2>
          <p className="page-subtitle">{t("accounting.rates.publishIntro")}</p>
          {error && !error.field ? <div className="error-banner">{t(`accounting.rates.errors.${error.key}`)}</div> : null}

          <div className="form-grid">
            <Field error={fieldError("effectiveFrom")} label={t("accounting.rates.effectiveFrom")}>
              <input className="text-input" onChange={set("effectiveFrom")} type="date" value={draft.effectiveFrom} />
            </Field>
            <Field className="span-all" label={t("accounting.rates.noteLabel")}>
              <input className="text-input" maxLength={500} onChange={set("note")} value={draft.note} />
            </Field>
          </div>

          <h3 className="form-section-title">{t("accounting.rates.commission")}</h3>
          <div className="form-grid">
            {percentField("restaurantCommission", t("accounting.rates.restaurantCommission"))}
            {percentField("promotionalCommission", t("accounting.rates.promotionalCommission"))}
            <Field error={fieldError("monthlySubscription")} label={t("accounting.rates.monthlySubscription")}>
              <input
                className="text-input"
                dir="ltr"
                inputMode="decimal"
                onChange={set("monthlySubscription")}
                value={draft.monthlySubscription}
              />
            </Field>
          </div>
          <h3 className="form-section-title">{t("accounting.rates.commissionWeights")}</h3>
          <div className="form-grid">
            {weightField("commissionOwnerAWeight", t("accounting.rates.ownerA"))}
            {weightField("commissionOwnerBWeight", t("accounting.rates.ownerB"))}
          </div>
          {error?.field === "commissionOwnerAWeight" ? (
            <div className="field-error">{t(`accounting.rates.errors.${error.key}`)}</div>
          ) : null}

          <h3 className="form-section-title">{t("accounting.rates.marginSection")}</h3>
          <div className="form-grid">
            {percentField("supermarketPartnerMargin", t("accounting.rates.supermarketPartner"))}
            {percentField("ownerAMargin", t("accounting.rates.ownerAPercent"))}
            {percentField("ownerBMargin", t("accounting.rates.ownerBPercent"))}
          </div>
          <p className="field-hint">
            {marginTotal === null ? t("common.dash") : t("accounting.rates.splitTotal", { total: marginTotal / 100 })}
          </p>

          <h3 className="form-section-title">{t("accounting.rates.costSection")}</h3>
          <div className="form-grid">
            {percentField("supermarketPartnerCost", t("accounting.rates.supermarketPartner"))}
            {percentField("ownerACost", t("accounting.rates.ownerAPercent"))}
            {percentField("ownerBCost", t("accounting.rates.ownerBPercent"))}
          </div>
          <p className="field-hint">
            {costTotal === null ? t("common.dash") : t("accounting.rates.splitTotal", { total: costTotal / 100 })}
          </p>

          <h3 className="form-section-title">{t("accounting.rates.deliverySection")}</h3>
          <div className="form-grid">{percentField("driverDeliveryShare", t("accounting.rates.driverShareLabel"))}</div>
          <h3 className="form-section-title">{t("accounting.rates.remainderWeights")}</h3>
          <div className="form-grid">
            {weightField("deliveryOpsRemainderWeight", t("accounting.rates.deliveryOps"))}
            {weightField("ownerADeliveryRemainderWeight", t("accounting.rates.ownerA"))}
            {weightField("ownerBDeliveryRemainderWeight", t("accounting.rates.ownerB"))}
          </div>

          <div className="row-actions" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" onClick={review} type="button">
              {t("accounting.rates.submit")}
            </button>
            <button
              className="btn btn-outline"
              onClick={() => {
                setOpen(false);
                setError(null);
                setDraft(rateSetToDraft(current, tomorrow()));
              }}
              type="button"
            >
              {t("common.cancel")}
            </button>
          </div>
        </>
      )}

      {confirming && confirming.ok ? (
        <ConfirmModal
          confirmLabel={t("accounting.rates.submit")}
          description={t("accounting.rates.confirmBody", {
            date: new Date(confirming.body.effectiveFrom).toLocaleDateString(),
            changes: changeSummary
          })}
          onCancel={() => setConfirming(null)}
          onConfirm={submit}
          title={t("accounting.rates.confirmTitle")}
          tone="primary"
        />
      ) : null}
    </div>
  );
}

function GenerateSubscriptions({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubscriptionRun | null>(null);
  const [confirming, setConfirming] = useState<{ periodYear: number; periodMonth: number } | null>(null);

  const review = () => {
    setResult(null);
    const periodYear = parseWholeNumber(year, 2000);
    const periodMonth = parseWholeNumber(month, 1);
    if (periodYear === null || periodYear > 2200 || periodMonth === null || periodMonth > 12) {
      setError(t("accounting.subscriptions.invalidPeriod"));
      return;
    }
    setError(null);
    setConfirming({ periodYear, periodMonth });
  };

  return (
    <div className="card">
      <h2 className="card-title">{t("accounting.subscriptions.title")}</h2>
      <p className="page-subtitle">{t("accounting.subscriptions.intro")}</p>
      {error ? <div className="error-banner">{error}</div> : null}
      {result ? (
        <div className="notice-banner">
          {t("accounting.subscriptions.result", {
            created: result.created,
            skipped: result.skipped,
            amount: formatMinor(result.totalMinor)
          })}
        </div>
      ) : null}
      <div className="filters-row">
        <Field label={t("accounting.subscriptions.year")}>
          <input className="text-input" dir="ltr" inputMode="numeric" onChange={(e) => setYear(e.target.value)} value={year} />
        </Field>
        <Field label={t("accounting.subscriptions.month")}>
          <input className="text-input" dir="ltr" inputMode="numeric" onChange={(e) => setMonth(e.target.value)} value={month} />
        </Field>
      </div>
      <button className="btn btn-outline" onClick={review} type="button">
        {t("accounting.subscriptions.generate")}
      </button>

      {confirming ? (
        <ConfirmModal
          confirmLabel={t("accounting.subscriptions.generate")}
          description={t("accounting.subscriptions.confirmBody")}
          onCancel={() => setConfirming(null)}
          onConfirm={async () => {
            const run = await generateSubscriptions(confirming);
            setConfirming(null);
            setResult(run);
            onDone();
          }}
          title={t("accounting.subscriptions.confirmTitle", { month: confirming.periodMonth, year: confirming.periodYear })}
          tone="primary"
        />
      ) : null}
    </div>
  );
}
