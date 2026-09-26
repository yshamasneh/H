import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "../../theme/icon";
import { isRTL, radius, spacing } from "../../theme/tokens";
import { text } from "../../theme/typography";
import { SeasonalAccent } from "./seasonal-accent";
import { useCustomerTheme } from "./theme";

const logo = require("../../../assets/logo/jovo-wordmark.png");
// Byte-identical to the supplied JOVO-squirrel-header-pose.png. Static artwork.
const squirrel = require("../../../assets/logo/jovo_mascot_wave_header.png");

export function CustomerHomeHeader({ fullName, unreadCount, onOpenNotifications }: {
  fullName: string; unreadCount: number; onOpenNotifications: () => void;
}) {
  const { t } = useTranslation(["customer", "common"]);
  const theme = useCustomerTheme();
  const [width, setWidth] = useState(350);
  const name = fullName.trim().split(/\s+/)[0] || t("home.defaultFirstName");
  const narrow = width < 320;
  const mascotWidth = Math.min(width * 0.51, 280);
  const align = isRTL() ? "right" : "left";
  return (
    <View testID="customer-home-header" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.header, { backgroundColor: theme.decoration.header, minHeight: narrow ? 140 : 154 }]}>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
        <View style={[styles.curve, { borderColor: theme.decoration.curve }]} />
        <View style={[styles.secondCurve, { borderColor: theme.decoration.curve }]} />
      </View>
      <View style={styles.row}>
        <View testID="header-greeting" style={styles.greetingColumn}>
          <Text style={[text("bodySm", "bold"), { color: theme.colors.text, textAlign: align }]}>{t("home.welcome")}</Text>
          <Text accessibilityRole="header" accessibilityLabel={name} testID="header-first-name" numberOfLines={1}
            style={[text(narrow || !isRTL() ? "h2" : "h1", "bold"), { color: theme.colors.text, textAlign: align, paddingVertical: spacing[1] }]}>{name}</Text>
        </View>
        <View pointerEvents="none" style={styles.mascotColumn}>
          <Image accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            testID="header-squirrel" resizeMode="contain" source={squirrel}
            style={{ width: mascotWidth, height: mascotWidth * 2 / 3 }} />
        </View>
        <View testID="header-brand" style={styles.brandColumn}>
          <Pressable accessibilityLabel={t("common:notifications")} accessibilityRole="button"
            onPress={onOpenNotifications} style={({ pressed }) => [styles.notification, { backgroundColor: pressed ? theme.decoration.soft : theme.decoration.header }]}>
            <Icon color={theme.colors.text} name="notifications" size="md" />
            {unreadCount > 0 ? <View testID="header-unread" style={[styles.dot, { backgroundColor: theme.colors.primary, borderColor: theme.decoration.header }]} /> : null}
          </Pressable>
          <Image accessible accessibilityLabel="JOVO" resizeMode="contain" source={logo} style={styles.logo} />
        </View>
      </View>
      {theme.preset !== "normal" ? <View pointerEvents="none" style={styles.season}>
        <SeasonalAccent theme={theme} background={theme.decoration.header} />
      </View> : null}
      <View pointerEvents="none" style={[styles.edge, { backgroundColor: theme.colors.primary }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { borderRadius: radius.lg, overflow: "hidden" },
  row: { flexDirection: "row", flex: 1, alignItems: "center", paddingHorizontal: spacing[3] },
  greetingColumn: { width: "32%", paddingVertical: spacing[4], zIndex: 1 },
  mascotColumn: { width: "46%", alignSelf: "flex-end", alignItems: "center", marginBottom: -2 },
  brandColumn: { width: "22%", alignItems: "flex-end", paddingVertical: spacing[4], gap: spacing[2] },
  notification: { width: 46, height: 46, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", top: 7, end: 7, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  logo: { width: "86%", maxWidth: 100, height: 28 },
  curve: { position: "absolute", width: "130%", height: 160, borderBottomWidth: 1.5, borderRadius: 300, top: -28, start: "-40%", transform: [{ rotate: "-17deg" }] },
  secondCurve: { position: "absolute", width: "110%", height: 130, borderTopWidth: 1, borderRadius: 300, bottom: -82, end: "-35%", transform: [{ rotate: "-17deg" }] },
  edge: { position: "absolute", bottom: 0, start: 0, end: 0, height: 3 },
  season: { position: "absolute", top: 8, start: "45%" }
});
