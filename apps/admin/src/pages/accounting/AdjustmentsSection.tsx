import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, fetchAllPages, listAdminDrivers, listAdminRestaurants, readApiError } from "../../api";
import { getOrderFinancialRecord, recordAdjustment, type OrderFinancialRecord } from "../../api.accounting";
import {
  adjustmentNetMinor,
  adjustmentPartnerKeys,
  buildAdjustment,
  type AdjustmentPartyKind,
  type AdjustmentRowDraft
} from "../../accounting-forms";
import { ConfirmModal } from "../../components/ConfirmModal";
import { Field } from "../../components/Field";
import { Money } from "../../components/Money";
import { formatMinor } from "../../money";

/**
 * The only way to correct a wrong number in the books.
 *
 * Ledger history is immutable at the database level — a trigger refuses any edit or delete — so a
 * wrong balance is fixed by *adding* a signed, attributed entry, never by changing one. This form is
 * that entry. It is deliberately hard to get wrong: amounts are positive with an explicit
 * credit/charge direction (so a sign is never typed), every party is picked rather than pasted, and
 * a correction that does not net to zero has to be acknowledged, because it changes the total money
 * the ledger claims to hold.
 */

const kinds: AdjustmentPartyKind[] = ["DRIVER", "PARTNER", "BUSINESS"];

const emptyRows = (): AdjustmentRowDraft[] => [
  { kind: "DRIVER", partyId: "", direction: "CHARGE", amount: "" },
  { kind: "PARTNER", partyId: "", direction: "CREDIT", amount: "" }
];

type PartyOption = { id: string; label: string };

export function AdjustmentsSection({
  canRecord,
  initialOrderId,
  onChanged
}: {
  canRecord: boolean;
  /** Set when arriving from an order page, so the form opens already linked to it. */
  initialOrderId?: string;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [orderInput, setOrderInput] = useState(initialOrderId ?? "");
  const [linked, setLinked] = useState<OrderFinancialRecord | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [rows, setRows] = useState<AdjustmentRowDraft[]>(emptyRows);
  const [confirmUnbalanced, setConfirmUnbalanced] = useState(false);
  const [error, setError] = useState<{ message: string; row?: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ReturnType<typeof buildAdjustment> | null>(null);
  const [businesses, setBusinesses] = useState<PartyOption[]>([]);
  const [drivers, setDrivers] = useState<PartyOption[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const [stores, driverList] = await Promise.all([
          fetchAllPages((page, pageSize) => listAdminRestaurants({ page, pageSize })),
          listAdminDrivers()
        ]);
        setBusinesses(stores.map((store) => ({ id: store.id, label: store.name })));
        setDrivers(driverList.map((driver) => ({ id: driver.userId, label: `${driver.fullName} (${driver.phone})` })));
      } catch (requestError) {
        setError({ message: readApiError(requestError, t("accounting.loadError")) });
      }
    })();
  }, []);

  const lookupOrder = async (orderId: string) => {
    setOrderError(null);
    setLinked(null);
    if (!orderId.trim()) return;
    try {
      setLinked(await getOrderFinancialRecord(orderId.trim()));
    } catch (requestError) {
      setOrderError(
        requestError instanceof ApiError && requestError.statusCode === 404
          ? t("accounting.adjustments.orderNotFound")
          : readApiError(requestError, t("common.genericActionError"))
      );
    }
  };

  useEffect(() => {
    if (initialOrderId) void lookupOrder(initialOrderId);
  }, [initialOrderId]);

  const optionsFor = (kind: AdjustmentPartyKind): PartyOption[] =>
    kind === "PARTNER"
      ? adjustmentPartnerKeys.map((key) => ({ id: key, label: t(`accounting.adjustments.partnerKey.${key}`) }))
      : kind === "BUSINESS"
        ? businesses
        : drivers;

  const updateRow = (index: number, patch: Partial<AdjustmentRowDraft>) =>
    setRows((current) => current.map((row, position) => (position === index ? { ...row, ...patch } : row)));

  const netMinor = useMemo(() => adjustmentNetMinor(rows), [rows]);

  const currentInput = () => ({
    reason,
    note,
    orderFinancialRecordId: linked?.id ?? null,
    rows,
    confirmUnbalanced
  });

  const review = () => {
    setNotice(null);
    const result = buildAdjustment(currentInput());
    if (!result.ok) {
      setError({ message: t(`accounting.adjustments.errors.${result.error}`), row: result.row });
      return;
    }
    setError(null);
    setConfirming(result);
  };

  const submit = async () => {
    if (!confirming || !confirming.ok) return;
    const created = await recordAdjustment(confirming.body);
    setConfirming(null);
    setRows(emptyRows());
    setReason("");
    setNote("");
    setOrderInput("");
    setLinked(null);
    setConfirmUnbalanced(false);
    setNotice(t("accounting.adjustments.success", { id: created.id.slice(0, 8) }));
    onChanged?.();
  };

  if (!canRecord) {
    return <div className="empty-state">{t("accounting.adjustments.noPermission")}</div>;
  }

  return (
    <div className="card">
      <h2 className="card-title">{t("accounting.adjustments.title")}</h2>
      <p className="page-subtitle">{t("accounting.adjustments.intro")}</p>

      {notice ? <div className="notice-banner">{notice}</div> : null}
      {error && error.row === undefined ? <div className="error-banner">{error.message}</div> : null}

      <div className="form-grid">
        <Field className="span-all" label={t("accounting.adjustments.reason")}>
          <input
            className="text-input"
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("accounting.adjustments.reasonPlaceholder")}
            value={reason}
          />
        </Field>
        <Field label={t("accounting.adjustments.order")} error={orderError}>
          <div className="field-row">
            <input
              className="text-input"
              dir="ltr"
              onChange={(event) => setOrderInput(event.target.value)}
              placeholder={t("accounting.adjustments.orderPlaceholder")}
              value={orderInput}
            />
            <button className="btn btn-outline btn-sm" onClick={() => void lookupOrder(orderInput)} type="button">
              {t("accounting.adjustments.lookup")}
            </button>
          </div>
        </Field>
        <Field label={t("accounting.adjustments.note")}>
          <input
            className="text-input"
            maxLength={1000}
            onChange={(event) => setNote(event.target.value)}
            value={note}
          />
        </Field>
      </div>

      {linked ? (
        <div className="notice-banner">
          {t("accounting.adjustments.orderFound", {
            business: linked.businessName,
            outcome: t(`accounting.adjustments.outcome.${linked.outcome}`),
            amount: formatMinor(linked.cashCollectedMinor)
          })}{" "}
          <button
            className="btn btn-outline btn-sm"
            onClick={() => {
              setLinked(null);
              setOrderInput("");
            }}
            type="button"
          >
            {t("accounting.adjustments.unlink")}
          </button>
        </div>
      ) : null}

      <h3 className="form-section-title">{t("accounting.adjustments.entries")}</h3>
      <p className="field-hint">{t("accounting.adjustments.entriesHint")}</p>

      {rows.map((row, index) => (
        <div key={index}>
          <div className="entry-row">
            <select
              aria-label={t("accounting.adjustments.kind")}
              className="select"
              onChange={(event) => updateRow(index, { kind: event.target.value as AdjustmentPartyKind, partyId: "" })}
              value={row.kind}
            >
              {kinds.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`accounting.adjustments.kindLabel.${kind}`)}
                </option>
              ))}
            </select>
            <select
              aria-label={t("accounting.adjustments.party")}
              className="select"
              onChange={(event) => updateRow(index, { partyId: event.target.value })}
              value={row.partyId}
            >
              <option value="">{t("accounting.adjustments.choose")}</option>
              {optionsFor(row.kind).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              aria-label={t("accounting.adjustments.direction")}
              className="select"
              onChange={(event) => updateRow(index, { direction: event.target.value as "CREDIT" | "CHARGE" })}
              value={row.direction}
            >
              <option value="CREDIT">{t("accounting.adjustments.credit")}</option>
              <option value="CHARGE">{t("accounting.adjustments.charge")}</option>
            </select>
            <input
              aria-label={t("accounting.adjustments.amount")}
              className="text-input"
              dir="ltr"
              inputMode="decimal"
              onChange={(event) => updateRow(index, { amount: event.target.value })}
              placeholder={t("accounting.adjustments.amount")}
              value={row.amount}
            />
            <button
              className="btn btn-outline btn-sm"
              disabled={rows.length <= 1}
              onClick={() => setRows((current) => current.filter((_, position) => position !== index))}
              type="button"
            >
              {t("common.remove")}
            </button>
          </div>
          {error?.row === index ? <div className="field-error">{error.message}</div> : null}
        </div>
      ))}

      <div className="row-actions" style={{ marginTop: 8 }}>
        <button
          className="btn btn-outline btn-sm"
          onClick={() =>
            setRows((current) => [...current, { kind: "PARTNER", partyId: "", direction: "CREDIT", amount: "" }])
          }
          type="button"
        >
          {t("accounting.adjustments.addEntry")}
        </button>
        <strong>
          {t("accounting.adjustments.net")}: <Money minor={netMinor} signed />
        </strong>
      </div>

      {netMinor === 0 ? (
        <p className="field-hint">{t("accounting.adjustments.balanced")}</p>
      ) : (
        <div className="warning-banner" style={{ marginTop: 12 }}>
          {t("accounting.adjustments.unbalancedWarning", { amount: formatMinor(netMinor) })}
          <label className="checkbox-row">
            <input
              checked={confirmUnbalanced}
              onChange={(event) => setConfirmUnbalanced(event.target.checked)}
              type="checkbox"
            />
            {t("accounting.adjustments.confirmUnbalanced")}
          </label>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button className="btn btn-primary" onClick={review} type="button">
          {t("accounting.adjustments.submit")}
        </button>
      </div>

      {confirming ? (
        <ConfirmModal
          confirmLabel={t("accounting.adjustments.submit")}
          description={t("accounting.adjustments.confirmBody")}
          onCancel={() => setConfirming(null)}
          onConfirm={submit}
          title={t("accounting.adjustments.confirmTitle")}
          tone="primary"
        />
      ) : null}
    </div>
  );
}
