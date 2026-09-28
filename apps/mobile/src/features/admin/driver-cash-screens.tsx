import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  fetchAdminAccess,
  getAdminAccountingOverview,
  listAdminCashSettlements,
  listAdminDriverCash,
  listAdminDriverCustody,
  recordAdminCashSettlement,
  type AdminAccess,
  type AdminAccountingOverview,
  type AdminCashSettlement,
  type AdminDriverCash,
  type AdminDriverCustodyLine
} from "../../core/api";
import { getAccessToken } from "../../core/session";
import i18n from "../../i18n";
import { useTheme } from "../../theme/theme-context";
import { radius, spacing, type ThemeColors } from "../../theme/tokens";
import { text } from "../../theme/typography";
import {
  carryingDays,
  expectedHandoverMinor,
  formatMinorPlain,
  handoverDifferenceMinor,
  overdueCarryingDays,
  parseMoneyToMinor,
  suggestReference
} from "./cash.rules";
import {
  ActionButton,
  ActionRow,
  AdminPage,
  Card,
  CardTitle,
  EmptyState,
  ErrorBanner,
  Input,
  KeyValue,
  LoadingState,
  Meta,
  PhoneNumber,
  StatCard,
  formatDate,
  readAdminError,
  useAdminStyles
} from "./ui";
import { formatMinorExact, hasAdminPermission } from "./users.rules";

async function requireToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error(i18n.t("common:sessionExpired"));
  return token;
}

function useAccess(): AdminAccess | null | "failed" {
  const [access, setAccess] = useState<AdminAccess | null | "failed">(null);
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
  return access;
}

/**
 * Drivers' cash, on the phone. Receiving cash happens in person — at the store, at the end of a
 * shift — which is exactly when an administrator is not at a desk, so the whole handover lives here
 * too, with the same meaning as on the web console: the same endpoint, the same idempotency
 * reference, the same rule that a count which differs from what was expected needs a reason.
 */
export function AdminDriverCashScreen(props: { onBack: () => void; onOpenDriver: (driver: AdminDriverCash) => void }) {
  const { t } = useTranslation(["admin", "common"]);
  const adminStyles = useAdminStyles();
  const access = useAccess();
  const [rows, setRows] = useState<AdminDriverCash[] | null>(null);
  const [overview, setOverview] = useState<AdminAccountingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const permitted = access === "failed" ? true : access ? hasAdminPermission(access, "VIEW_ACCOUNTING") : null;

  useEffect(() => {
    if (!permitted) return;
    let cancelled = false;
    (async () => {
      const token = await requireToken();
      const [cash, books] = await Promise.all([listAdminDriverCash(token), getAdminAccountingOverview(token)]);
      if (cancelled) return;
      setRows(cash);
      setOverview(books);
      setError(null);
    })().catch((requestError) => !cancelled && setError(readAdminError(requestError)));
    return () => {
      cancelled = true;
    };
  }, [permitted]);

  const sorted = rows ? [...rows].sort((left, right) => right.outstandingMinor - left.outstandingMinor) : null;
  const holding = sorted?.filter((row) => row.outstandingMinor > 0) ?? [];
  const now = new Date();

  return (
    <AdminPage onBack={props.onBack} subtitle={t("driverCash.subtitle")} title={t("driverCash.title")}>
      {permitted === false ? (
        <EmptyState message={t("driverCash.noPermission")} />
      ) : (
        <>
          <ErrorBanner message={error} />
          {sorted === null ? (
            error ? null : <LoadingState />
          ) : (
            <>
              <View style={adminStyles.grid}>
                <StatCard
                  hint={t("driverCash.heldHint", { count: holding.length })}
                  label={t("driverCash.held")}
                  value={formatMinorExact(holding.reduce((sum, row) => sum + row.outstandingMinor, 0))}
                />
                {overview ? (
                  <StatCard
                    hint={t("driverCash.settledHint")}
                    label={t("driverCash.settledTotal")}
                    value={formatMinorExact(overview.cashSettledMinor)}
                  />
                ) : null}
              </View>
              {sorted.length === 0 ? (
                <EmptyState message={t("driverCash.empty")} />
              ) : holding.length === 0 ? (
                <Meta>{t("driverCash.allHandedOver")}</Meta>
              ) : null}
              {sorted.map((row) => {
                const days = carryingDays(row.oldestOutstandingAt, now);
                return (
                  <Card key={row.driverUserId} onPress={() => props.onOpenDriver(row)}>
                    <View style={adminStyles.rowBetween}>
                      <View style={{ flex: 1 }}>
                        <CardTitle>{row.driverName}</CardTitle>
                        <PhoneNumber phone={row.driverPhone} />
                      </View>
                      <DriverHeld amountMinor={row.outstandingMinor} overdue={row.outstandingMinor > 0 && days >= overdueCarryingDays} />
                    </View>
                    {row.outstandingMinor > 0 ? (
                      <>
                        <KeyValue label={t("driverCash.openOrders")} value={String(row.outstandingOrderCount)} />
                        <KeyValue
                          label={t("driverCash.carryingSince")}
                          value={
                            row.oldestOutstandingAt
                              ? `${formatDate(row.oldestOutstandingAt)} · ${days === 0 ? t("driverCash.today") : t("driverCash.days", { count: days })}`
                              : "—"
                          }
                        />
                      </>
                    ) : (
                      <Meta>{t("driverCash.nothingHeld")}</Meta>
                    )}
                    <Meta>{t("driverCash.openDriver")}</Meta>
                  </Card>
                );
              })}
            </>
          )}
        </>
      )}
    </AdminPage>
  );
}

function DriverHeld({ amountMinor, overdue }: { amountMinor: number; overdue: boolean }) {
  const { colors } = useTheme();
  const styles = useScreenStyles();
  return (
    <View style={[styles.heldBadge, overdue ? { backgroundColor: colors.warningSubtle } : null]}>
      <Text style={[styles.heldAmount, overdue ? { color: colors.warning } : null]}>{formatMinorExact(amountMinor)}</Text>
    </View>
  );
}

/**
 * One driver: receive their cash (orders, count, record), see the receipt of what was recorded,
 * and every handover they have made before.
 */
export function AdminDriverCashDetailScreen(props: { driverUserId: string; onBack: () => void; onOpenOrder: (orderId: string) => void }) {
  const { t } = useTranslation(["admin", "common"]);
  const adminStyles = useAdminStyles();
  const screenStyles = useScreenStyles();
  const access = useAccess();
  const [driver, setDriver] = useState<AdminDriverCash | null>(null);
  const [history, setHistory] = useState<AdminCashSettlement[] | null>(null);
  const [receipt, setReceipt] = useState<AdminCashSettlement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const canView = access === "failed" ? true : access ? hasAdminPermission(access, "VIEW_ACCOUNTING") : null;
  const canReceive = access !== "failed" && access !== null && hasAdminPermission(access, "RECEIVE_DRIVER_CASH");

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    (async () => {
      const token = await requireToken();
      const [cash, settlements] = await Promise.all([
        listAdminDriverCash(token),
        listAdminCashSettlements(token, props.driverUserId)
      ]);
      if (cancelled) return;
      setDriver(cash.find((row) => row.driverUserId === props.driverUserId) ?? null);
      setHistory(settlements);
      setError(null);
    })().catch((requestError) => !cancelled && setError(readAdminError(requestError)));
    return () => {
      cancelled = true;
    };
  }, [canView, props.driverUserId, reload]);

  const title = driver?.driverName ?? t("driverCash.title");
  if (canView === false) {
    return (
      <AdminPage onBack={props.onBack} title={title}>
        <EmptyState message={t("driverCash.noPermission")} />
      </AdminPage>
    );
  }

  return (
    <AdminPage onBack={props.onBack} subtitle={t("driverCash.detailSubtitle")} title={title}>
      <ErrorBanner message={error} />
      {receipt ? (
        <ReceiptCard onDone={() => setReceipt(null)} onOpenOrder={props.onOpenOrder} settlement={receipt} />
      ) : null}
      {driver === null || history === null ? (
        error ? null : <LoadingState />
      ) : (
        <>
          <Card>
            <View style={adminStyles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Meta>{t("driverCash.held")}</Meta>
                <Text style={screenStyles.bigAmount}>{formatMinorExact(driver.outstandingMinor)}</Text>
              </View>
              <PhoneNumber phone={driver.driverPhone} />
            </View>
            <KeyValue label={t("driverCash.collected")} value={formatMinorExact(driver.collectedMinor)} />
            <KeyValue label={t("driverCash.handedOver")} value={formatMinorExact(driver.settledMinor)} />
            <KeyValue
              label={t("driverCash.earnings")}
              value={`${formatMinorExact(driver.earningsMinor)} · ${t("driverCash.earningsPaid", { amount: formatMinorExact(driver.earningsPaidMinor) })}`}
            />
            <Meta>{t("driverCash.separateNote")}</Meta>
          </Card>

          {driver.outstandingMinor > 0 && canReceive && !receipt ? (
            <HandoverForm
              driver={driver}
              key={`${driver.driverUserId}-${reload}`}
              onRecorded={(settlement) => {
                setReceipt(settlement);
                setReload((value) => value + 1);
              }}
            />
          ) : null}
          {driver.outstandingMinor > 0 && !canReceive && access !== null ? <Meta>{t("driverCash.cannotReceive")}</Meta> : null}

          <CardTitle>{t("driverCash.historyTitle")}</CardTitle>
          {history.length === 0 ? (
            <EmptyState message={t("driverCash.noHistory")} />
          ) : (
            history.map((settlement) => (
              <Card key={settlement.id} onPress={() => setReceipt(settlement)}>
                <View style={adminStyles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <CardTitle>{formatMinorExact(settlement.countedAmountMinor)}</CardTitle>
                    <Meta>{formatDate(settlement.settledAt)}</Meta>
                  </View>
                  <Meta>{t("driverCash.ordersCount", { count: settlement.allocations.length })}</Meta>
                </View>
                {settlement.discrepancyMinor !== 0 ? (
                  <KeyValue label={t("driverCash.difference")} value={signed(settlement.discrepancyMinor)} />
                ) : null}
                <Meta>{t("driverCash.openReceipt")}</Meta>
              </Card>
            ))
          )}
        </>
      )}
    </AdminPage>
  );
}

function signed(minor: number): string {
  return minor > 0 ? `+${formatMinorExact(minor)}` : formatMinorExact(minor);
}

function HandoverForm(props: { driver: AdminDriverCash; onRecorded: (settlement: AdminCashSettlement) => void }) {
  const { t } = useTranslation(["admin", "common"]);
  const styles = useScreenStyles();
  const adminStyles = useAdminStyles();
  const { driver } = props;
  const [custody, setCustody] = useState<AdminDriverCustodyLine[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [counted, setCounted] = useState(formatMinorPlain(driver.outstandingMinor));
  // Fixed for the life of the form: a retry re-sends it and the server refuses a duplicate.
  const [reference] = useState(() => suggestReference("HANDOVER"));
  const [note, setNote] = useState("");
  const [discrepancyNote, setDiscrepancyNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    requireToken()
      .then((token) => listAdminDriverCustody(token, driver.driverUserId))
      .then((lines) => !cancelled && setCustody(lines))
      .catch((requestError) => !cancelled && setError(readAdminError(requestError)));
    return () => {
      cancelled = true;
    };
  }, [driver.driverUserId]);

  const expectedMinor = expectedHandoverMinor(driver.outstandingMinor, custody ?? [], selected);
  const countedMinor = parseMoneyToMinor(counted);
  const differenceMinor = handoverDifferenceMinor(countedMinor, expectedMinor);
  const needsReason = differenceMinor !== null && differenceMinor !== 0;
  const ready = countedMinor !== null && (!needsReason || discrepancyNote.trim().length > 0);

  function toggle(custodyId: string) {
    const next = new Set(selected);
    if (next.has(custodyId)) next.delete(custodyId);
    else next.add(custodyId);
    setSelected(next);
    setCounted(formatMinorPlain(expectedHandoverMinor(driver.outstandingMinor, custody ?? [], next)));
    setConfirming(false);
  }

  async function submit() {
    if (countedMinor === null) return setError(t("driverCash.invalidAmount"));
    if (needsReason && !discrepancyNote.trim()) return setError(t("driverCash.reasonRequired"));
    setBusy(true);
    setError(null);
    try {
      const settlement = await recordAdminCashSettlement(await requireToken(), {
        driverUserId: driver.driverUserId,
        reference,
        countedAmountMinor: countedMinor,
        ...(selected.size > 0 ? { custodyIds: [...selected] } : {}),
        ...(needsReason ? { discrepancyNote: discrepancyNote.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {})
      });
      props.onRecorded(settlement);
    } catch (requestError) {
      setError(readAdminError(requestError));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>{t("driverCash.receiveTitle")}</CardTitle>
      <ErrorBanner message={error} />

      <Text style={styles.step}>{t("driverCash.stepOrders")}</Text>
      <Meta>{t("driverCash.selectOrders")}</Meta>
      {custody === null ? (
        <LoadingState />
      ) : (
        custody.map((line) => {
          const isSelected = selected.has(line.custodyId);
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              key={line.custodyId}
              onPress={() => toggle(line.custodyId)}
              style={[styles.orderRow, isSelected && styles.orderRowSelected]}
              testID={`custody-${line.custodyId}`}
            >
              <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                {isSelected ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.orderId}>{`#${line.orderId.slice(0, 8)}`}</Text>
                <Text style={styles.orderMeta}>{formatDate(line.collectedAt)}</Text>
              </View>
              <Text style={styles.orderAmount}>{formatMinorExact(line.outstandingMinor)}</Text>
            </Pressable>
          );
        })
      )}

      <Text style={styles.step}>{t("driverCash.stepCount")}</Text>
      <KeyValue label={t("driverCash.expected")} value={formatMinorExact(expectedMinor)} />
      <Meta>{t("driverCash.countedLabel")}</Meta>
      <Input
        keyboardType="decimal-pad"
        ltr
        onChangeText={(value) => {
          setCounted(value);
          setConfirming(false);
        }}
        placeholder="0.00"
        value={counted}
      />
      {differenceMinor === null ? (
        <Meta>{t("driverCash.invalidAmount")}</Meta>
      ) : differenceMinor === 0 ? (
        <Text style={styles.matches}>{t("driverCash.matches")}</Text>
      ) : (
        <View style={adminStyles.reasonBox}>
          <Text style={styles.difference}>
            {differenceMinor < 0
              ? t("driverCash.shortBy", { amount: formatMinorExact(-differenceMinor) })
              : t("driverCash.overBy", { amount: formatMinorExact(differenceMinor) })}
          </Text>
          <Input
            multiline
            onChangeText={setDiscrepancyNote}
            placeholder={t("driverCash.reasonPlaceholder")}
            value={discrepancyNote}
          />
          {differenceMinor < 0 ? <Meta>{t("driverCash.partialHint")}</Meta> : null}
        </View>
      )}
      <Input onChangeText={setNote} placeholder={t("driverCash.notePlaceholder")} value={note} />

      <Text style={styles.step}>{t("driverCash.stepRecord")}</Text>
      <Meta>{`${t("driverCash.reference")}: ${reference}`}</Meta>
      {confirming && countedMinor !== null ? (
        <View style={adminStyles.reasonBox}>
          <Text style={styles.confirmText}>
            {t("driverCash.confirm", { amount: formatMinorExact(countedMinor), name: driver.driverName })}
          </Text>
          <ActionRow>
            <ActionButton label={t("driverCash.confirmButton")} loading={busy} onPress={() => void submit()} />
            <ActionButton label={t("common:cancel")} onPress={() => setConfirming(false)} variant="secondary" />
          </ActionRow>
        </View>
      ) : (
        <ActionButton disabled={!ready || custody === null} label={t("driverCash.record")} onPress={() => setConfirming(true)} />
      )}
    </Card>
  );
}

/**
 * The record of one handover, exactly as the server stored it: nothing is recomputed, so what the
 * receiver reads here and what the ledger holds cannot disagree.
 */
export function ReceiptCard(props: {
  settlement: AdminCashSettlement;
  onDone: () => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const { t } = useTranslation(["admin", "common"]);
  const styles = useScreenStyles();
  const adminStyles = useAdminStyles();
  const { settlement } = props;
  const settledTotal = settlement.allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0);
  return (
    <Card>
      <View style={adminStyles.rowBetween}>
        <CardTitle>{t("driverCash.receiptTitle")}</CardTitle>
        <Text style={settlement.discrepancyMinor === 0 ? styles.matches : styles.difference}>
          {settlement.discrepancyMinor === 0 ? t("driverCash.receiptBalanced") : t("driverCash.receiptDifference")}
        </Text>
      </View>
      <Meta>{settlement.reference}</Meta>
      <KeyValue label={t("driverCash.receiptDate")} value={formatDate(settlement.settledAt)} />
      <KeyValue label={t("driverCash.receiptFrom")} value={settlement.driverName} />
      <KeyValue label={t("driverCash.receiptReceivedBy")} value={settlement.receivedByName} />
      <Text style={styles.step}>{t("driverCash.receiptOrders")}</Text>
      {settlement.allocations.length === 0 ? (
        <Meta>{t("driverCash.receiptNoOrders")}</Meta>
      ) : (
        settlement.allocations.map((allocation) => (
          <Pressable
            accessibilityRole="link"
            key={allocation.custodyId}
            onPress={() => props.onOpenOrder(allocation.orderId)}
            style={styles.receiptLine}
          >
            <Text style={styles.orderId}>{`#${allocation.orderId.slice(0, 8)}`}</Text>
            <Text style={styles.orderAmount}>{formatMinorExact(allocation.amountMinor)}</Text>
          </Pressable>
        ))
      )}
      <KeyValue label={t("driverCash.receiptSettledTotal")} value={formatMinorExact(settledTotal)} />
      <KeyValue label={t("driverCash.expected")} value={formatMinorExact(settlement.expectedAmountMinor)} />
      <KeyValue label={t("driverCash.counted")} value={formatMinorExact(settlement.countedAmountMinor)} />
      <KeyValue label={t("driverCash.difference")} value={settlement.discrepancyMinor === 0 ? "—" : signed(settlement.discrepancyMinor)} />
      {settlement.discrepancyNote ? <KeyValue label={t("driverCash.reasonLabel")} value={settlement.discrepancyNote} /> : null}
      {settlement.note ? <KeyValue label={t("driverCash.noteLabel")} value={settlement.note} /> : null}
      <ActionRow>
        <ActionButton label={t("driverCash.done")} onPress={props.onDone} variant="secondary" />
      </ActionRow>
    </Card>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    heldBadge: { backgroundColor: colors.primarySubtle, borderRadius: radius.pill, paddingHorizontal: spacing[3], paddingVertical: spacing[1] },
    heldAmount: { ...text("bodySm", "bold"), color: colors.primaryPressed, writingDirection: "ltr" },
    bigAmount: { ...text("h1", "heavy"), color: colors.text, writingDirection: "ltr" },
    step: { ...text("bodySm", "bold"), color: colors.text, marginTop: spacing[4], marginBottom: spacing[1] },
    orderRow: {
      alignItems: "center",
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      flexDirection: "row",
      gap: spacing[3],
      marginTop: spacing[2],
      minHeight: 52,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2]
    },
    orderRowSelected: { backgroundColor: colors.primarySubtle, borderColor: colors.primary },
    checkbox: { alignItems: "center", borderColor: colors.borderStrong, borderRadius: 6, borderWidth: 2, height: 24, justifyContent: "center", width: 24 },
    checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
    checkmark: { ...text("caption", "bold"), color: colors.textInverse },
    orderId: { ...text("bodySm", "semibold"), color: colors.text, writingDirection: "ltr" },
    orderMeta: { ...text("caption"), color: colors.textMuted },
    orderAmount: { ...text("bodySm", "bold"), color: colors.text, writingDirection: "ltr" },
    matches: { ...text("bodySm", "semibold"), color: colors.success, marginTop: spacing[2] },
    difference: { ...text("bodySm", "semibold"), color: colors.warning },
    confirmText: { ...text("bodySm", "semibold"), color: colors.text },
    receiptLine: {
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      minHeight: 40,
      alignItems: "center"
    }
  });
}

function useScreenStyles() {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [colors]);
}
