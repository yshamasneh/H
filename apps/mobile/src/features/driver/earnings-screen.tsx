import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getDriverCashSummary, type DriverCashLine, type DriverCashPeriod, type DriverCashSummary } from "../../core/api";
import { readError } from "../../core/errors";
import { getAccessToken } from "../../core/session";
import i18n from "../../i18n";
import { Icon, backIconName } from "../../theme/icon";
import { colors, radius, spacing } from "../../theme/tokens";
import { text } from "../../theme/typography";

const periods: DriverCashPeriod[] = ["SHIFT", "TODAY", "WEEK", "MONTH", "ALL"];

/**
 * The driver's money, as three facts that must never be confused:
 *
 *   - cash collected: what was taken from customers (the driver is physically holding it),
 *   - earnings: the driver's own share of the delivery fees, which the platform pays separately,
 *   - owed to the platform: the cash still to be handed over at settlement.
 *
 * All three come from the accounting ledger via /driver/me/cash-summary; the screen adds nothing up
 * itself. Cash is settled gross, so "owed" is not reduced by earnings, and the screen says so.
 */
export function DriverEarningsScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation(["driver", "common"]);
  const [period, setPeriod] = useState<DriverCashPeriod>("SHIFT");
  const [summary, setSummary] = useState<DriverCashSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (next: DriverCashPeriod, mode: "initial" | "refresh") => {
    setError(null);
    if (mode === "initial") setLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error(i18n.t("common:sessionExpired"));
      setSummary(await getDriverCashSummary(token, next));
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(period, "initial");
  }, [period, load]);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={colors.background} barStyle="dark-content" />
      <View style={styles.header}>
        <Pressable accessibilityLabel={t("common:back")} onPress={onBack} style={styles.backButton}>
          <Icon name={backIconName()} size="md" />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>{t("earnings.headerTitle")}</Text>
          <Text style={styles.headerSubtitle}>{t("earnings.subtitle")}</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            onRefresh={() => {
              setRefreshing(true);
              void load(period, "refresh");
            }}
            refreshing={refreshing}
            tintColor={colors.primary}
          />
        }
      >
        <ScrollView
          accessibilityLabel={t("earnings.periodsLabel")}
          contentContainerStyle={styles.periodRow}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {periods.map((option) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: option === period }}
              key={option}
              onPress={() => setPeriod(option)}
              style={[styles.periodChip, option === period && styles.periodChipOn]}
            >
              <Text style={[styles.periodText, option === period && styles.periodTextOn]}>{t(`earnings.periods.${option}`)}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void load(period, "initial")} style={styles.retryButton}>
              <Text style={styles.retryText}>{t("common:retry")}</Text>
            </Pressable>
          </View>
        ) : summary ? (
          <SummaryBody summary={summary} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryBody({ summary }: { summary: DriverCashSummary }) {
  const { t } = useTranslation(["driver"]);
  const { balance } = summary;

  return (
    <>
      <Text style={styles.metaLine}>
        {summary.lastHandoverAt
          ? t("earnings.lastHandover", { date: formatDate(summary.lastHandoverAt) })
          : t("earnings.noHandoverYet")}
      </Text>

      {/* 1 — cash: what the driver took from customers. */}
      <View accessibilityLabel={t("earnings.collected.label")} style={[styles.card, styles.collectedCard]}>
        <Text style={styles.cardLabel}>{t("earnings.collected.label")}</Text>
        <Text style={styles.collectedValue}>{formatMoney(summary.cashCollectedMinor)}</Text>
        <Text style={styles.cardHelp}>{t("earnings.collected.help")}</Text>
        <Text style={styles.cardSub}>{t("earnings.collected.handedOver", { amount: formatMoney(summary.cashHandedOverMinor) })}</Text>
      </View>

      {/* 2 — pay: the driver's own share, paid separately. */}
      <View accessibilityLabel={t("earnings.earned.label")} style={[styles.card, styles.earnedCard]}>
        <Text style={styles.cardLabel}>{t("earnings.earned.label")}</Text>
        <Text style={styles.earnedValue}>{formatMoney(summary.earningsMinor)}</Text>
        <Text style={styles.cardHelp}>{t("earnings.earned.help")}</Text>
        <Text style={styles.cardSub}>{t("earnings.earned.unpaid", { amount: formatMoney(balance.earningsOwedToDriverMinor) })}</Text>
      </View>

      {/* 3 — what has to go back: the standing balance, whatever period is selected. */}
      <View accessibilityLabel={t("earnings.owed.label")} style={[styles.card, styles.owedCard]}>
        <Text style={styles.cardLabel}>{t("earnings.owed.label")}</Text>
        <Text style={styles.owedValue}>{formatMoney(balance.cashOwedToPlatformMinor)}</Text>
        <Text style={styles.cardHelp}>{t("earnings.owed.help")}</Text>
        {balance.unsettledOrderCount > 0 ? (
          <>
            <Text style={styles.cardSub}>{t("earnings.owed.orders", { count: balance.unsettledOrderCount })}</Text>
            {balance.oldestUnsettledAt ? (
              <Text style={styles.cardSub}>{t("earnings.owed.oldest", { date: formatDate(balance.oldestUnsettledAt) })}</Text>
            ) : null}
            {balance.cashOwedFromBeforePeriodMinor > 0 ? (
              <Text style={styles.cardSub}>{t("earnings.owed.fromBefore", { amount: formatMoney(balance.cashOwedFromBeforePeriodMinor) })}</Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.cardSub}>{t("earnings.owed.none")}</Text>
        )}
      </View>

      <Text style={styles.metaLine}>{t("earnings.counts", { delivered: summary.deliveredCount, failed: summary.failedCount })}</Text>

      <Text style={styles.sectionTitle}>{t("earnings.lines.title")}</Text>
      {summary.lines.length === 0 ? (
        <View style={styles.card}><Text style={styles.emptyText}>{t("earnings.lines.empty")}</Text></View>
      ) : (
        summary.lines.map((line) => <OrderLine key={line.orderId} line={line} />)
      )}
      {summary.linesTruncated ? <Text style={styles.metaLine}>{t("earnings.lines.truncated", { count: summary.lines.length })}</Text> : null}
    </>
  );
}

function OrderLine({ line }: { line: DriverCashLine }) {
  const { t } = useTranslation(["driver"]);
  const failed = line.outcome === "DELIVERY_FAILED";
  return (
    <View style={styles.lineCard}>
      <View style={styles.lineHeader}>
        <View style={styles.lineTitleBlock}>
          <Text numberOfLines={1} style={styles.lineTitle}>{line.restaurantName ?? `#${line.orderId.slice(0, 8).toUpperCase()}`}</Text>
          <Text style={styles.lineMeta}>
            {[line.deliveryLabel, formatDate(line.occurredAt)].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <View style={[styles.outcomeBadge, failed ? styles.outcomeFailed : styles.outcomeDelivered]}>
          <Text style={[styles.outcomeText, failed ? styles.outcomeTextFailed : styles.outcomeTextDelivered]}>
            {failed ? t("earnings.lines.failed") : t("earnings.lines.delivered")}
          </Text>
        </View>
      </View>
      <View style={styles.lineFigures}>
        <Figure label={t("earnings.lines.collected")} value={failed ? t("earnings.lines.noCash") : formatMoney(line.cashCollectedMinor)} />
        <Figure label={t("earnings.lines.earned")} value={formatMoney(line.earningMinor)} />
        <Figure label={t("earnings.lines.stillOwed")} value={formatMoney(line.cashOwedToPlatformMinor)} />
      </View>
    </View>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={styles.figureValue}>{value}</Text>
    </View>
  );
}

function formatMoney(minor: number): string {
  return `${(minor / 100).toFixed(2)} ₪`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(i18n.language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  header: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4]
  },
  backButton: { alignItems: "center", backgroundColor: colors.surfaceSunk, borderRadius: radius.lg, height: 44, justifyContent: "center", width: 44 },
  headerCopy: { flex: 1 },
  headerTitle: { ...text("h2", "bold"), color: colors.text },
  headerSubtitle: { ...text("caption"), color: colors.textMuted, marginTop: spacing[1] },
  headerSpacer: { width: 44 },
  center: { alignItems: "center", gap: spacing[4], justifyContent: "center", padding: spacing[6] },
  content: { alignSelf: "center", maxWidth: 640, padding: spacing[5], paddingBottom: spacing[9], width: "100%" },
  periodRow: { gap: spacing[2], paddingBottom: spacing[4] },
  periodChip: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.pill, borderWidth: 1, justifyContent: "center", minHeight: 40, paddingHorizontal: spacing[4] },
  periodChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  periodText: { ...text("bodySm", "bold"), color: colors.text },
  periodTextOn: { color: colors.textInverse },
  metaLine: { ...text("caption"), color: colors.textMuted, marginBottom: spacing[3], textAlign: "center" },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing[3], padding: spacing[5] },
  // Three visibly different cards, so cash, pay and debt are not mistaken for one another at a glance.
  collectedCard: { borderColor: colors.info },
  earnedCard: { backgroundColor: colors.successSubtle, borderColor: colors.success },
  owedCard: { backgroundColor: colors.primarySubtle, borderColor: colors.primary, borderWidth: 2 },
  cardLabel: { ...text("bodySm", "bold"), color: colors.text },
  collectedValue: { ...text("display", "bold"), color: colors.info, marginTop: spacing[2] },
  earnedValue: { ...text("display", "bold"), color: colors.success, marginTop: spacing[2] },
  owedValue: { ...text("display", "bold"), color: colors.primary, marginTop: spacing[2] },
  cardHelp: { ...text("caption"), color: colors.textMuted, marginTop: spacing[2] },
  cardSub: { ...text("caption", "bold"), color: colors.text, marginTop: spacing[2] },
  sectionTitle: { ...text("h3", "bold"), color: colors.text, marginBottom: spacing[3], marginTop: spacing[3] },
  emptyText: { ...text("bodySm"), color: colors.textMuted, textAlign: "center" },
  lineCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing[3], padding: spacing[4] },
  lineHeader: { alignItems: "center", flexDirection: "row", gap: spacing[3], justifyContent: "space-between" },
  lineTitleBlock: { flex: 1 },
  lineTitle: { ...text("bodySm", "bold"), color: colors.text },
  lineMeta: { ...text("caption"), color: colors.textMuted, marginTop: spacing[1] },
  outcomeBadge: { borderRadius: radius.sm, paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
  outcomeDelivered: { backgroundColor: colors.surfaceSunk },
  outcomeFailed: { backgroundColor: colors.errorSubtle },
  outcomeText: { ...text("label", "bold") },
  outcomeTextDelivered: { color: colors.text },
  outcomeTextFailed: { color: colors.error },
  lineFigures: { flexDirection: "row", gap: spacing[3], marginTop: spacing[3] },
  figure: { flex: 1 },
  figureLabel: { ...text("label"), color: colors.textMuted },
  figureValue: { ...text("bodySm", "bold"), color: colors.text, marginTop: spacing[1] },
  errorText: { ...text("bodySm"), color: colors.error, textAlign: "center" },
  retryButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing[5], paddingVertical: spacing[3] },
  retryText: { ...text("bodySm", "bold"), color: colors.textInverse }
});
