import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getDriverStats, type DriverStats } from "../../core/api";
import { readError } from "../../core/errors";
import { getAccessToken } from "../../core/session";
import i18n from "../../i18n";
import { Icon, backIconName } from "../../theme/icon";
import { colors, radius, spacing } from "../../theme/tokens";
import { text } from "../../theme/typography";

export function DriverEarningsScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation(["driver", "common"]);
  const [stats, setStats] = useState<DriverStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error(i18n.t("common:sessionExpired"));
      setStats(await getDriverStats(token));
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
          <Text style={styles.headerTitle}>{t("earnings.headerTitle")}</Text>
          <Text style={styles.headerSubtitle}>{t("earnings.subtitle")}</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void load()} style={styles.retryButton}>
            <Text style={styles.retryText}>{t("common:retry")}</Text>
          </Pressable>
        </View>
      ) : stats ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.card, styles.earningsCard]}>
            <Text style={styles.earningsLabel}>{t("earnings.totalLabel")}</Text>
            <Text style={styles.earningsValue}>{formatMoney(stats.earningsMinor)}</Text>
            <Text style={styles.rateHint}>{t("earnings.rateHint", { rate: formatMoney(stats.perDeliveryMinor) })}</Text>
          </View>
          <View style={styles.metricsRow}>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>{stats.completedCount}</Text>
              <Text style={styles.metricLabel}>{t("earnings.completedLabel")}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>{stats.activeCount}</Text>
              <Text style={styles.metricLabel}>{t("earnings.activeLabel")}</Text>
            </View>
          </View>
          <Text style={styles.footnote}>{t("earnings.footnote")}</Text>
        </ScrollView>
      ) : null}
    </SafeAreaView>
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
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, padding: spacing[5] },
  earningsCard: { alignItems: "center", backgroundColor: colors.primarySubtle, borderColor: colors.primary, marginBottom: spacing[4] },
  earningsLabel: { ...text("bodySm", "bold"), color: colors.primaryPressed },
  earningsValue: { ...text("display", "bold"), color: colors.primary, marginTop: spacing[2] },
  rateHint: { ...text("caption"), color: colors.primaryPressed, marginTop: spacing[2] },
  metricsRow: { flexDirection: "row", gap: spacing[4] },
  metricCard: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, flex: 1, gap: spacing[1], padding: spacing[5] },
  metricValue: { ...text("h1", "bold"), color: colors.text },
  metricLabel: { ...text("caption"), color: colors.textMuted, textAlign: "center" },
  footnote: { ...text("caption"), color: colors.textMuted, marginTop: spacing[4], textAlign: "center" },
  errorText: { ...text("bodySm"), color: colors.error, textAlign: "center" },
  retryButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing[5], paddingVertical: spacing[3] },
  retryText: { ...text("bodySm", "bold"), color: colors.textInverse }
});
