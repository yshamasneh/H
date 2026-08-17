import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getRestaurantStats, type RestaurantPeriodStats, type RestaurantStats } from "../../core/api";
import { readError } from "../../core/errors";
import { getAccessToken } from "../../core/session";
import i18n from "../../i18n";
import { Icon, backIconName } from "../../theme/icon";
import { colors, radius, spacing } from "../../theme/tokens";
import { text } from "../../theme/typography";

export function RestaurantAnalyticsScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation(["restaurantOps", "common"]);
  const [stats, setStats] = useState<RestaurantStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error(i18n.t("common:sessionExpired"));
      setStats(await getRestaurantStats(token));
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={colors.background} barStyle="dark-content" />
      <View style={styles.header}>
        <Pressable accessibilityLabel={t("common:back")} onPress={onBack} style={styles.backButton}>
          <Icon name={backIconName()} size="md" />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>{t("analytics.headerTitle")}</Text>
          <Text style={styles.headerSubtitle}>{t("analytics.subtitle")}</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={() => void load()} style={styles.retryButton}>
            <Text style={styles.retryText}>{t("common:retry")}</Text>
          </Pressable>
        </View>
      ) : stats ? (
        <ScrollView contentContainerStyle={styles.content}>
          <PeriodCard title={t("analytics.todayTitle")} stats={stats.today} />
          <PeriodCard title={t("analytics.monthTitle")} stats={stats.month} />
          <PeriodCard title={t("analytics.totalTitle")} stats={stats.total} highlight />
          <Text style={styles.footnote}>{t("analytics.footnote")}</Text>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function PeriodCard({ title, stats, highlight }: { title: string; stats: RestaurantPeriodStats; highlight?: boolean }) {
  const { t } = useTranslation(["restaurantOps"]);
  return (
    <View style={[styles.card, highlight && styles.cardHighlight]}>
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={styles.metricRow}>
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{formatMoney(stats.salesMinor)}</Text>
          <Text style={styles.metricLabel}>{t("analytics.salesLabel")}</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{stats.ordersCount}</Text>
          <Text style={styles.metricLabel}>{t("analytics.ordersLabel")}</Text>
        </View>
      </View>
    </View>
  );
}

function formatMoney(minor: number): string {
  return `${(minor / 100).toFixed(2)} ₪`;
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
  center: { alignItems: "center", flex: 1, gap: spacing[4], justifyContent: "center", padding: spacing[5] },
  content: { alignSelf: "center", maxWidth: 640, padding: spacing[5], paddingBottom: spacing[9], width: "100%" },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing[4],
    padding: spacing[5]
  },
  cardHighlight: { backgroundColor: colors.primarySubtle, borderColor: colors.primary },
  cardTitle: { ...text("h3", "bold"), color: colors.text, marginBottom: spacing[4] },
  metricRow: { alignItems: "center", flexDirection: "row" },
  metric: { flex: 1, gap: spacing[1] },
  metricValue: { ...text("h1", "bold"), color: colors.primary },
  metricLabel: { ...text("caption"), color: colors.textMuted },
  metricDivider: { alignSelf: "stretch", backgroundColor: colors.border, marginHorizontal: spacing[4], width: 1 },
  footnote: { ...text("caption"), color: colors.textMuted, marginTop: spacing[2], textAlign: "center" },
  error: { ...text("bodySm"), color: colors.error, textAlign: "center" },
  retryButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing[5], paddingVertical: spacing[3] },
  retryText: { ...text("bodySm", "bold"), color: colors.textInverse }
});
