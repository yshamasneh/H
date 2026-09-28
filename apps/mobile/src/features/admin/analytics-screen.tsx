import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  fetchAdminAccess,
  getAdminCustomerRetention,
  getAdminPeakTimes,
  getAdminTopProducts,
  type AdminAnalyticsPeriodParams,
  type AdminCustomerRetention,
  type AdminPeakTimes,
  type AdminTopProducts
} from "../../core/api";
import { getAccessToken } from "../../core/session";
import i18n from "../../i18n";
import { useTheme } from "../../theme/theme-context";
import { radius, spacing, withAlpha, type ThemeColors } from "../../theme/tokens";
import { text } from "../../theme/typography";
import {
  barPercent,
  busiest,
  formatQuantityMilli,
  formatRateBp,
  heatStep,
  hourLabel,
  hoursFor,
  normalizeTypedDate,
  periodPresets,
  presetRange,
  weekdayDisplayOrder,
  type PeriodPreset
} from "./analytics.rules";
import {
  ActionButton,
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
  StatCard,
  useAdminStyles,
  readAdminError
} from "./ui";
import { formatMinorExact, hasAdminPermission } from "./users.rules";

type Loaded<T> = { data: T | null; error: string | null };
const empty = { data: null, error: null };

async function requireToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error(i18n.t("common:sessionExpired"));
  return token;
}

/**
 * Super-admin analytics on the phone, at the same depth as the admin web console and from the same
 * endpoints: returning customers, busy hours and weekdays in Hebron local time, and best sellers.
 * DELIVERED orders only; every figure is computed by the API and only laid out here.
 */
export function AdminAnalyticsScreen({ onBack }: { onBack: () => void }) {
  const adminStyles = useAdminStyles();
  const styles = useScreenStyles();
  const { t } = useTranslation(["admin", "common"]);
  const [permitted, setPermitted] = useState<boolean | null>(null);
  const [preset, setPreset] = useState<PeriodPreset>("last30");
  const [customDraft, setCustomDraft] = useState({ fromDate: "", toDate: "" });
  const [custom, setCustom] = useState<{ fromDate?: string; toDate?: string }>({});
  const [sortBy, setSortBy] = useState<"quantity" | "revenue">("quantity");
  const [products, setProducts] = useState<Loaded<AdminTopProducts>>(empty);
  const [peak, setPeak] = useState<Loaded<AdminPeakTimes>>(empty);
  const [retention, setRetention] = useState<Loaded<AdminCustomerRetention>>(empty);

  const period: AdminAnalyticsPeriodParams = preset === "custom" ? custom : presetRange(preset, new Date());
  const periodKey = `${period.fromDate ?? ""}|${period.toDate ?? ""}`;

  useEffect(() => {
    let cancelled = false;
    requireToken()
      .then(fetchAdminAccess)
      .then((access) => !cancelled && setPermitted(hasAdminPermission(access, "VIEW_ALL_ORDERS")))
      .catch(() => !cancelled && setPermitted(true)); // the API still refuses anyone without the permission
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!permitted) return;
    let cancelled = false;
    setPeak(empty);
    setRetention(empty);
    const fail = (set: (value: Loaded<never>) => void) => (error: unknown) => !cancelled && set({ data: null, error: readAdminError(error) });
    requireToken()
      .then((token) => getAdminPeakTimes(token, period))
      .then((data) => !cancelled && setPeak({ data, error: null }))
      .catch(fail(setPeak));
    requireToken()
      .then((token) => getAdminCustomerRetention(token, period))
      .then((data) => !cancelled && setRetention({ data, error: null }))
      .catch(fail(setRetention));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKey, permitted]);

  useEffect(() => {
    if (!permitted) return;
    let cancelled = false;
    setProducts(empty);
    requireToken()
      .then((token) => getAdminTopProducts(token, { ...period, sortBy, limit: 20 }))
      .then((data) => !cancelled && setProducts({ data, error: null }))
      .catch((error) => !cancelled && setProducts({ data: null, error: readAdminError(error) }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKey, sortBy, permitted]);

  const customFrom = normalizeTypedDate(customDraft.fromDate);
  const customTo = normalizeTypedDate(customDraft.toDate);
  const customValid =
    (customDraft.fromDate === "" || customFrom !== null) &&
    (customDraft.toDate === "" || customTo !== null) &&
    !(customFrom && customTo && customFrom > customTo);

  return (
    <AdminPage onBack={onBack} subtitle={t("analytics.subtitle")} title={t("analytics.title")}>
      {permitted === false ? (
        <EmptyState message={t("analytics.noPermission")} />
      ) : (
        <>
          <FilterChips
            onChange={setPreset}
            options={periodPresets.map((value) => ({ value, label: t(`analytics.presets.${value}`) }))}
            value={preset}
          />
          {preset === "custom" ? (
            <View style={adminStyles.reasonBox}>
              <View style={styles.dateRow}>
                <View style={styles.dateField}>
                  <Meta>{t("analytics.from")}</Meta>
                  <Input
                    ltr
                    onChangeText={(value) => setCustomDraft({ ...customDraft, fromDate: value })}
                    placeholder={t("analytics.datePlaceholder")}
                    value={customDraft.fromDate}
                  />
                </View>
                <View style={styles.dateField}>
                  <Meta>{t("analytics.to")}</Meta>
                  <Input
                    ltr
                    onChangeText={(value) => setCustomDraft({ ...customDraft, toDate: value })}
                    placeholder={t("analytics.datePlaceholder")}
                    value={customDraft.toDate}
                  />
                </View>
              </View>
              {customValid ? null : <Meta>{t("analytics.dateInvalid")}</Meta>}
              <ActionButton
                disabled={!customValid}
                label={t("analytics.apply")}
                onPress={() => setCustom({ fromDate: customFrom ?? undefined, toDate: customTo ?? undefined })}
              />
            </View>
          ) : null}
          <Meta>
            {period.fromDate || period.toDate
              ? t("analytics.periodRange", { from: period.fromDate ?? "…", to: period.toDate ?? "…" })
              : t("analytics.periodAll")}
            {" · "}
            {t("analytics.deliveredOnly")}
          </Meta>

          {permitted === null ? (
            <LoadingState />
          ) : (
            <>
              <RetentionSection state={retention} />
              <PeakSection state={peak} />
              <TopProductsSection onSort={setSortBy} sortBy={sortBy} state={products} />
            </>
          )}
        </>
      )}
    </AdminPage>
  );
}

function Section<T>(props: { title: string; subtitle?: string; state: Loaded<T>; children: (data: T) => ReactNode; header?: ReactNode }) {
  const styles = useScreenStyles();
  return (
    <Card>
      <CardTitle>{props.title}</CardTitle>
      {props.subtitle ? <Meta>{props.subtitle}</Meta> : null}
      {props.header}
      <View style={styles.sectionBody}>
        {props.state.error ? (
          <ErrorBanner message={props.state.error} />
        ) : props.state.data ? (
          props.children(props.state.data)
        ) : (
          <LoadingState />
        )}
      </View>
    </Card>
  );
}

function RetentionSection({ state }: { state: Loaded<AdminCustomerRetention> }) {
  const adminStyles = useAdminStyles();
  const styles = useScreenStyles();
  const { colors } = useTheme();
  const { t } = useTranslation(["admin"]);
  return (
    <Section state={state} title={t("analytics.retention.title")}>
      {(data) =>
        data.customers === 0 ? (
          <EmptyState message={t("analytics.noOrders")} />
        ) : (
          <View style={{ gap: spacing[3] }}>
            <View style={adminStyles.grid}>
              <StatCard hint={t("analytics.retention.rateHint")} label={t("analytics.retention.rate")} value={formatRateBp(data.returningRateBp)} />
              <StatCard
                hint={t("analytics.retention.returningHint", { orders: data.ordersFromReturningCustomers })}
                label={t("analytics.retention.returning")}
                value={String(data.returningCustomers)}
              />
              <StatCard hint={t("analytics.retention.oneTimeHint")} label={t("analytics.retention.oneTime")} value={String(data.oneTimeCustomers)} />
              <StatCard
                hint={t("analytics.retention.customersHint", { orders: data.deliveredOrders })}
                label={t("analytics.retention.customers")}
                value={String(data.customers)}
              />
            </View>
            <View
              accessibilityLabel={t("analytics.retention.meterLabel", {
                returning: data.returningCustomers,
                total: data.customers,
                rate: formatRateBp(data.returningRateBp)
              })}
              accessible
              style={styles.meter}
            >
              <View style={[styles.meterFill, { width: `${data.returningRateBp / 100}%` }]} />
            </View>
            <View style={styles.legendRow}>
              <Legend color={colors.primary} label={`${t("analytics.retention.returning")} · ${data.returningCustomers}`} />
              <Legend color={colors.surfaceSunk} label={`${t("analytics.retention.oneTime")} · ${data.oneTimeCustomers}`} outlined />
            </View>
          </View>
        )
      }
    </Section>
  );
}

function Legend(props: { color: string; label: string; outlined?: boolean }) {
  const styles = useScreenStyles();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: props.color }, props.outlined && styles.swatchOutlined]} />
      <Text style={styles.legendText}>{props.label}</Text>
    </View>
  );
}

/** Five steps of one hue, from the primary token: the weekday x hour grid's scale on the web. */
function heatColorsFor(colors: ThemeColors): string[] {
  return [colors.surfaceSunk, withAlpha(colors.primary, 0.22), withAlpha(colors.primary, 0.45), withAlpha(colors.primary, 0.7), colors.primary];
}

function PeakSection({ state }: { state: Loaded<AdminPeakTimes> }) {
  const styles = useScreenStyles();
  const { colors } = useTheme();
  const { t } = useTranslation(["admin"]);
  const [day, setDay] = useState<number | "all">("all");
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [showList, setShowList] = useState(false);
  const weekdayName = (weekday: number) => t(`analytics.weekdays.${weekday}`);
  const dayChips = [
    { value: "all", label: t("analytics.peak.allDays") },
    ...weekdayDisplayOrder.map((weekday) => ({ value: String(weekday), label: weekdayName(weekday) }))
  ];

  return (
    <Section state={state} subtitle={t("analytics.peak.subtitle")} title={t("analytics.peak.title")}>
      {(data) => {
        if (data.totalOrders === 0) return <EmptyState message={t("analytics.noOrders")} />;
        const hours = hoursFor(data, day);
        const maxHour = Math.max(...hours.map((row) => row.orders));
        const maxWeekday = Math.max(...data.byWeekday.map((row) => row.orders));
        const selected = selectedHour === null ? null : hours[selectedHour];
        const readout = selected
          ? day === "all"
            ? t("analytics.peak.hourReadout", { hour: hourLabel(selected.hour), orders: selected.orders })
            : t("analytics.peak.cellReadout", { day: weekdayName(day), hour: hourLabel(selected.hour), orders: selected.orders })
          : t("analytics.peak.tapHint");
        const busiestHours = busiest(hours);
        return (
          <View style={{ gap: spacing[3] }}>
            <Text style={styles.summary}>
              {t("analytics.peak.busiestHour", { hours: busiestHours.map((row) => hourLabel(row.hour)).join(t("analytics.listSeparator")) })}
              {"\n"}
              {t("analytics.peak.busiestDay", {
                days: busiest(data.byWeekday).map((row) => weekdayName(row.weekday)).join(t("analytics.listSeparator"))
              })}
            </Text>

            <Text style={styles.chartTitle}>{t("analytics.peak.byHour")}</Text>
            {/* The weekday x hour grid, one day at a time: pick a day to see its row. */}
            <FilterChips
              onChange={(value) => {
                setDay(value === "all" ? "all" : Number(value));
                setSelectedHour(null);
              }}
              options={dayChips}
              value={day === "all" ? "all" : String(day)}
            />
            <Text accessibilityLiveRegion="polite" style={styles.readout}>{readout}</Text>
            {/* Clock time reads left to right in both languages, so the hour axis does too. */}
            <View style={styles.columns}>
              {hours.map((row) => (
                <Pressable
                  accessibilityLabel={t("analytics.peak.hourReadout", { hour: hourLabel(row.hour), orders: row.orders })}
                  accessibilityRole="button"
                  key={row.hour}
                  onPress={() => setSelectedHour(selectedHour === row.hour ? null : row.hour)}
                  style={styles.column}
                  testID={`hour-${row.hour}`}
                >
                  <View style={[styles.columnPlot, selectedHour === row.hour && styles.columnPlotSelected]}>
                    <View
                      style={[
                        styles.columnBar,
                        { height: `${barPercent(row.orders, maxHour)}%` },
                        selectedHour !== null && selectedHour !== row.hour && styles.columnBarMuted
                      ]}
                    />
                  </View>
                  <Text style={styles.columnLabel}>{row.hour % 3 === 0 ? String(row.hour).padStart(2, "0") : ""}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable accessibilityRole="button" onPress={() => setShowList(!showList)}>
              <Text style={styles.toggle}>{showList ? t("analytics.hideList") : t("analytics.showList")}</Text>
            </Pressable>
            {showList ? (
              <View>
                {hours.map((row) => (
                  <View key={row.hour} style={styles.listRow}>
                    <Text style={styles.listHour}>{hourLabel(row.hour)}</Text>
                    <View style={[styles.heatDot, { backgroundColor: heatColorsFor(colors)[heatStep(row.orders, maxHour)] }]} />
                    <Text style={styles.listValue}>{row.orders}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <Text style={styles.chartTitle}>{t("analytics.peak.byWeekday")}</Text>
            {weekdayDisplayOrder.map((weekday) => {
              const orders = data.byWeekday[weekday].orders;
              return (
                <Pressable
                  accessibilityLabel={t("analytics.peak.dayReadout", { day: weekdayName(weekday), orders })}
                  accessibilityRole="button"
                  key={weekday}
                  onPress={() => {
                    setDay(weekday);
                    setSelectedHour(null);
                  }}
                  style={styles.hbarRow}
                >
                  <Text style={[styles.hbarLabel, day === weekday && styles.hbarLabelSelected]}>{weekdayName(weekday)}</Text>
                  <View style={styles.hbarTrack}>
                    <View style={[styles.hbarFill, { width: `${barPercent(orders, maxWeekday)}%` }]} />
                  </View>
                  <Text style={styles.hbarValue}>{orders}</Text>
                </Pressable>
              );
            })}
            <Meta>{t("analytics.peak.weekdayTapHint")}</Meta>
          </View>
        );
      }}
    </Section>
  );
}

function TopProductsSection(props: {
  state: Loaded<AdminTopProducts>;
  sortBy: "quantity" | "revenue";
  onSort: (sortBy: "quantity" | "revenue") => void;
}) {
  const adminStyles = useAdminStyles();
  const styles = useScreenStyles();
  const { t } = useTranslation(["admin"]);
  return (
    <Section
      header={
        <FilterChips
          onChange={props.onSort}
          options={(["quantity", "revenue"] as const).map((value) => ({ value, label: t(`analytics.products.sortBy.${value}`) }))}
          value={props.sortBy}
        />
      }
      state={props.state}
      subtitle={t("analytics.products.subtitle")}
      title={t("analytics.products.title")}
    >
      {(data) => {
        if (data.items.length === 0) return <EmptyState message={t("analytics.noOrders")} />;
        const metric = (row: AdminTopProducts["items"][number]) => (data.sortBy === "revenue" ? row.revenueMinor : row.quantityMilli);
        const max = Math.max(...data.items.map(metric));
        return (
          <View style={{ gap: spacing[3] }}>
            <View style={adminStyles.grid}>
              <StatCard
                hint={t("analytics.products.revenueTotalHint")}
                label={t("analytics.products.revenueTotal")}
                value={formatMinorExact(data.totals.revenueMinor)}
              />
              <StatCard hint={t("analytics.products.ordersHint")} label={t("analytics.products.orders")} value={String(data.totals.deliveredOrders)} />
              <StatCard hint={t("analytics.products.productsHint")} label={t("analytics.products.products")} value={String(data.totals.productsSold)} />
            </View>
            {data.items.map((row) => (
              <View key={row.menuItemId} style={styles.productRow}>
                <View style={adminStyles.rowBetween}>
                  <Text style={styles.rank}>{row.rank}</Text>
                  <Text style={styles.productName}>{row.name}</Text>
                </View>
                <View style={styles.hbarTrack}>
                  <View style={[styles.hbarFill, { width: `${barPercent(metric(row), max)}%` }]} />
                </View>
                <KeyValue label={t("analytics.products.quantity")} value={`${formatQuantityMilli(row.quantityMilli)} ${row.unitLabel}`} />
                <KeyValue label={t("analytics.products.revenue")} value={formatMinorExact(row.revenueMinor)} />
                <KeyValue label={t("analytics.products.inOrders")} value={String(row.orders)} />
              </View>
            ))}
          </View>
        );
      }}
    </Section>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  sectionBody: { marginTop: spacing[3] },
  dateRow: { flexDirection: "row", gap: spacing[2], marginBottom: spacing[2] },
  dateField: { flex: 1, gap: spacing[1] },
  summary: { ...text("bodySm", "semibold"), color: colors.text },
  chartTitle: { ...text("bodySm", "semibold"), color: colors.text, marginTop: spacing[2] },
  readout: { ...text("caption"), color: colors.textMuted, minHeight: 18 },
  columns: {
    alignItems: "flex-end",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    direction: "ltr",
    flexDirection: "row",
    gap: 2
  },
  column: { alignItems: "center", flex: 1 },
  columnPlot: { alignItems: "center", borderTopLeftRadius: 4, borderTopRightRadius: 4, height: 120, justifyContent: "flex-end", width: "100%" },
  columnPlotSelected: { backgroundColor: colors.surfaceSunk },
  columnBar: { backgroundColor: colors.primary, borderTopLeftRadius: 4, borderTopRightRadius: 4, maxWidth: 24, width: "100%" },
  columnBarMuted: { opacity: 0.45 },
  columnLabel: { ...text("label"), color: colors.textMuted, height: 16 },
  toggle: { ...text("caption", "semibold"), color: colors.primary, paddingVertical: spacing[1] },
  listRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing[3],
    paddingVertical: spacing[1]
  },
  listHour: { ...text("bodySm"), color: colors.text, width: 56, writingDirection: "ltr" },
  listValue: { ...text("bodySm", "semibold"), color: colors.text, flex: 1, textAlign: "right" },
  heatDot: { borderColor: colors.border, borderRadius: 4, borderWidth: 1, height: 16, width: 16 },
  hbarRow: { alignItems: "center", flexDirection: "row", gap: spacing[3], minHeight: 32 },
  hbarLabel: { ...text("bodySm"), color: colors.text, width: 72 },
  hbarLabelSelected: { ...text("bodySm", "bold"), color: colors.primary },
  hbarTrack: { backgroundColor: colors.surfaceSunk, borderRadius: radius.sm, flex: 1, height: 12, overflow: "hidden" },
  hbarFill: { backgroundColor: colors.primary, borderRadius: radius.sm, height: "100%" },
  hbarValue: { ...text("bodySm", "semibold"), color: colors.text, minWidth: 36, textAlign: "right" },
  meter: { backgroundColor: colors.surfaceSunk, borderColor: colors.border, borderRadius: 4, borderWidth: 1, height: 14, overflow: "hidden" },
  meterFill: { backgroundColor: colors.primary, height: "100%" },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing[4] },
  legendItem: { alignItems: "center", flexDirection: "row", gap: spacing[1] },
  swatch: { borderRadius: 2, height: 10, width: 10 },
  swatchOutlined: { borderColor: colors.borderStrong, borderWidth: 1 },
  legendText: { ...text("caption"), color: colors.textMuted },
  productRow: { borderBottomColor: colors.border, borderBottomWidth: 1, gap: spacing[1], paddingBottom: spacing[3] },
  rank: { ...text("h3", "bold"), color: colors.primary, minWidth: 28 },
  productName: { ...text("bodySm", "semibold"), color: colors.text, flex: 1 }
});
}

function useScreenStyles() {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [colors]);
}
