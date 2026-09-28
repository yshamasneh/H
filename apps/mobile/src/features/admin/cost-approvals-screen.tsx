import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import {
  decideAdminOperatingCost,
  fetchAdminAccess,
  listAdminOperatingCosts,
  type AdminAccess,
  type AdminOperatingCost
} from "../../core/api";
import { getAccessToken } from "../../core/session";
import i18n from "../../i18n";
import {
  ActionButton,
  ActionRow,
  AdminPage,
  Card,
  CardTitle,
  EmptyState,
  ErrorBanner,
  FilterChips,
  Input,
  KeyValue,
  LoadingState,
  Meta,
  StatusPill,
  formatDate,
  readAdminError,
  useAdminStyles
} from "./ui";
import { formatMinorExact, hasAdminPermission } from "./users.rules";

type Filter = "PROPOSED" | "APPROVED" | "REJECTED" | "ALL";
const filters: Filter[] = ["PROPOSED", "APPROVED", "REJECTED", "ALL"];

async function requireToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error(i18n.t("common:sessionExpired"));
  return token;
}

/**
 * The operating-cost approval queue, on the phone: what the supermarket side has asked to spend,
 * approved or rejected with a reason — a decision that should not wait for a desk. Same endpoint and
 * permission (APPROVE_OPERATING_COSTS) as the web console; an approval is written to the ledger and
 * cannot be edited, so it is confirmed first, exactly as on the web.
 */
export function AdminCostApprovalsScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation(["admin", "common"]);
  const adminStyles = useAdminStyles();
  // "failed": the access check itself could not be read. The list is still requested (the server
  // enforces VIEW_ACCOUNTING either way) but no decision buttons are offered.
  const [access, setAccess] = useState<AdminAccess | null | "failed">(null);
  const [filter, setFilter] = useState<Filter>("PROPOSED");
  const [entries, setEntries] = useState<AdminOperatingCost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; kind: "approve" | "reject" } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const canView = access === "failed" ? true : access ? hasAdminPermission(access, "VIEW_ACCOUNTING") : null;
  const canDecide = access !== "failed" && access !== null && hasAdminPermission(access, "APPROVE_OPERATING_COSTS");

  useEffect(() => {
    let cancelled = false;
    requireToken()
      .then(fetchAdminAccess)
      .then((result) => !cancelled && setAccess(result))
      .catch(() => !cancelled && setAccess("failed"));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    setEntries(null);
    requireToken()
      .then((token) => listAdminOperatingCosts(token, filter === "ALL" ? undefined : filter))
      .then((result) => {
        if (cancelled) return;
        setEntries(result);
        setError(null);
      })
      .catch((requestError) => !cancelled && setError(readAdminError(requestError)));
    return () => {
      cancelled = true;
    };
  }, [canView, filter, reload]);

  async function decide(entry: AdminOperatingCost, approve: boolean) {
    setBusy(true);
    try {
      await decideAdminOperatingCost(await requireToken(), entry.id, approve ? { approve: true } : { approve: false, note: reason.trim() });
      setPending(null);
      setReason("");
      setReload((value) => value + 1);
    } catch (requestError) {
      setError(readAdminError(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage onBack={onBack} subtitle={t("costs.subtitle")} title={t("costs.title")}>
      {canView === false ? (
        <EmptyState message={t("costs.noPermission")} />
      ) : (
        <>
          <FilterChips
            onChange={setFilter}
            options={filters.map((value) => ({ value, label: value === "ALL" ? t("costs.filterAll") : t(`costs.status.${value}`) }))}
            value={filter}
          />
          <ErrorBanner message={error} />
          {entries === null ? (
            error ? null : <LoadingState />
          ) : entries.length === 0 ? (
            <EmptyState message={filter === "PROPOSED" ? t("costs.emptyQueue") : t("costs.empty")} />
          ) : (
            entries.map((entry) => {
              const open = pending?.id === entry.id ? pending : null;
              return (
                <Card key={entry.id}>
                  <View style={adminStyles.rowBetween}>
                    <View style={{ flex: 1 }}>
                      <CardTitle>{formatMinorExact(entry.amountMinor)}</CardTitle>
                      <Meta>{entry.businessName}</Meta>
                    </View>
                    <StatusPill status={entry.status === "PROPOSED" ? "PENDING" : entry.status} />
                  </View>
                  <KeyValue label={t("costs.category")} value={t(`costs.categories.${entry.category}`, entry.category)} />
                  <KeyValue label={t("costs.description")} value={entry.description} />
                  <KeyValue label={t("costs.period")} value={entry.periodLabel ?? formatDate(entry.incurredOn)} />
                  <KeyValue label={t("costs.proposedBy")} value={entry.proposedByName} />
                  {entry.shares.map((share) => (
                    <KeyValue key={share.payeeKey} label={share.payeeName} value={formatMinorExact(share.amountMinor)} />
                  ))}
                  {entry.approverName ? <KeyValue label={t("costs.decidedBy")} value={entry.approverName} /> : null}
                  {entry.decisionNote ? <Meta>{entry.decisionNote}</Meta> : null}

                  {entry.status === "PROPOSED" && canDecide ? (
                    open ? (
                      <View style={adminStyles.reasonBox}>
                        {open.kind === "approve" ? (
                          <Meta>{t("costs.approveBody", { amount: formatMinorExact(entry.amountMinor) })}</Meta>
                        ) : (
                          <Input multiline onChangeText={setReason} placeholder={t("costs.rejectPlaceholder")} value={reason} />
                        )}
                        <ActionRow>
                          <ActionButton
                            disabled={open.kind === "reject" && !reason.trim()}
                            label={open.kind === "approve" ? t("costs.confirmApprove") : t("costs.confirmReject")}
                            loading={busy}
                            onPress={() => void decide(entry, open.kind === "approve")}
                            variant={open.kind === "approve" ? "primary" : "danger"}
                          />
                          <ActionButton label={t("common:cancel")} onPress={() => setPending(null)} variant="secondary" />
                        </ActionRow>
                      </View>
                    ) : (
                      <ActionRow>
                        <ActionButton label={t("common:approve")} onPress={() => setPending({ id: entry.id, kind: "approve" })} />
                        <ActionButton
                          label={t("common:reject")}
                          onPress={() => {
                            setReason("");
                            setPending({ id: entry.id, kind: "reject" });
                          }}
                          variant="danger"
                        />
                      </ActionRow>
                    )
                  ) : null}
                </Card>
              );
            })
          )}
        </>
      )}
    </AdminPage>
  );
}
