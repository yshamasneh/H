import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Linking, Pressable, StyleSheet, Text } from "react-native";
import { telUrl } from "../core/tel";
import { Icon } from "../theme/icon";
import { radius, spacing, type ThemeColors } from "../theme/tokens";
import { useTheme } from "../theme/theme-context";
import { text } from "../theme/typography";

/**
 * Shows the customer's real phone number with a tap-to-call button that opens the phone's own
 * dialer. Rendered only where the API supplied a number (a business member, an administrator, or a
 * driver while the delivery is active), so an absent number simply renders nothing.
 */
export function CallCustomerButton(props: { phone: string | null | undefined }) {
  const { t } = useTranslation(["common"]);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const url = telUrl(props.phone);
  if (!url) return null;
  return (
    <Pressable
      accessibilityLabel={`${t("common:callCustomer")} ${props.phone}`}
      accessibilityRole="button"
      onPress={() => void Linking.openURL(url).catch(() => undefined)}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Icon color={colors.textInverse} name="call" size="md" />
      <Text style={styles.label}>{t("common:callCustomer")}</Text>
      <Text style={styles.number}>{props.phone}</Text>
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    button: {
      alignItems: "center",
      alignSelf: "flex-start",
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      flexDirection: "row",
      gap: spacing[2],
      marginTop: spacing[2],
      minHeight: 44,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2]
    },
    pressed: { opacity: 0.85 },
    label: { ...text("bodySm", "bold"), color: colors.textInverse },
    number: { ...text("bodySm"), color: colors.textInverse }
  });
