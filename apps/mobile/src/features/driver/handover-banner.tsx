import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getDriverCashSummary } from "../../core/api";
import { getAccessToken } from "../../core/session";
import { colors, radius, spacing } from "../../theme/tokens";
import { text } from "../../theme/typography";

/**
 * "You are holding X. Hand it over." Shown where a driver finishes work: on the delivery screen once
 * the delivery is complete, and on the home screen when no delivery is in progress. It reads the same
 * standing balance as the cash screen, so the number cannot differ from it, and it says in words that
 * the driver's own earnings are not part of it.
 */
export function HandoverBanner(props: {
  /** Reload when this changes (a delivery just completed, or the home list was refreshed). */
  refreshKey: string | number;
  onOpen: () => void;
  /** Show a "nothing to hand over" line instead of hiding when the balance is zero. */
  showWhenZero?: boolean;
}) {
  const { t } = useTranslation(["driver"]);
  const [owedMinor, setOwedMinor] = useState<number | null>(null);
  const [orderCount, setOrderCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void getAccessToken()
      .then((token) => (token ? getDriverCashSummary(token, "SHIFT") : null))
      .then((summary) => {
        if (cancelled || !summary) return;
        setOwedMinor(summary.balance.cashOwedToPlatformMinor);
        setOrderCount(summary.balance.unsettledOrderCount);
      })
      // A failed lookup just leaves the banner out; the cash screen has its own error handling.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [props.refreshKey]);

  if (owedMinor === null) return null;
  if (owedMinor === 0) {
    return props.showWhenZero ? (
      <View style={[styles.card, styles.cardClear]}>
        <Text style={styles.clearText}>{t("handover.nothing")}</Text>
      </View>
    ) : null;
  }

  return (
    <View accessibilityLabel={t("handover.title")} style={styles.card}>
      <Text style={styles.title}>{t("handover.title")}</Text>
      <Text style={styles.value}>{`${(owedMinor / 100).toFixed(2)} ₪`}</Text>
      <Text style={styles.line}>{t("handover.allYouHold", { count: orderCount })}</Text>
      <Text style={styles.note}>{t("handover.notEarnings")}</Text>
      <Pressable accessibilityRole="button" onPress={props.onOpen} style={styles.button}>
        <Text style={styles.buttonText}>{t("handover.seeOrders")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.primarySubtle, borderColor: colors.primary, borderRadius: radius.lg, borderWidth: 2, marginBottom: spacing[4], padding: spacing[4] },
  cardClear: { backgroundColor: colors.successSubtle, borderColor: colors.success },
  clearText: { ...text("bodySm", "bold"), color: colors.success, textAlign: "center" },
  title: { ...text("bodySm", "bold"), color: colors.primaryPressed },
  value: { ...text("display", "bold"), color: colors.primary, marginTop: spacing[1] },
  line: { ...text("bodySm", "bold"), color: colors.text, marginTop: spacing[1] },
  note: { ...text("caption"), color: colors.text, marginTop: spacing[1] },
  button: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.primary, borderRadius: radius.md, borderWidth: 1, marginTop: spacing[3], minHeight: 44, justifyContent: "center" },
  buttonText: { ...text("bodySm", "bold"), color: colors.primary }
});
