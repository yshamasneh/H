import { useTranslation } from "react-i18next";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import i18n from "../i18n";
import { legalLinks, type LegalLinkKey } from "../core/legal-links";
import { useTheme } from "../theme/theme-context";
import { spacing } from "../theme/tokens";
import { text } from "../theme/typography";

/** Opens a JOVO legal page in the system browser; a failure shows the address instead of throwing. */
export async function openLegalLink(key: LegalLinkKey): Promise<void> {
  const url = legalLinks[key];
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert(i18n.t("common:legal.openFailed", { url }));
  }
}

const labelKeys: Record<LegalLinkKey, string> = {
  privacy: "common:legal.privacyPolicy",
  terms: "common:legal.terms",
  support: "common:legal.support",
  deleteAccount: "common:legal.deleteOnWeb"
};

/** A compact row of "Privacy Policy · Terms of Use" links, used under the login form. */
export function LegalLinksRow(props: { links?: LegalLinkKey[] }) {
  const { t } = useTranslation(["common"]);
  const { colors } = useTheme();
  const links = props.links ?? ["privacy", "terms"];
  return (
    <View style={styles.row}>
      {links.map((key, index) => (
        <View key={key} style={styles.item}>
          {index > 0 ? <Text style={[styles.separator, { color: colors.textMuted }]}>·</Text> : null}
          <Pressable accessibilityRole="link" hitSlop={8} onPress={() => void openLegalLink(key)}>
            <Text style={[styles.link, { color: colors.primary }]}>{t(labelKeys[key])}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

/** "By creating an account, I agree to the Terms of Use and the Privacy Policy." with both links tappable. */
export function SignupConsentText() {
  const { t } = useTranslation(["common"]);
  const { colors } = useTheme();
  return (
    <Text style={[styles.consent, { color: colors.textMuted }]}>
      {t("common:legal.signupConsentBefore")}
      <Text accessibilityRole="link" onPress={() => void openLegalLink("terms")} style={[styles.inlineLink, { color: colors.primary }]}>
        {t("common:legal.terms")}
      </Text>
      {t("common:legal.signupConsentAnd")}
      <Text accessibilityRole="link" onPress={() => void openLegalLink("privacy")} style={[styles.inlineLink, { color: colors.primary }]}>
        {t("common:legal.privacyPolicy")}
      </Text>
      {t("common:legal.signupConsentAfter")}
    </Text>
  );
}

/** Settings rows for every role: privacy, terms, support and the web deletion page. */
export function LegalSettingsRows(props: { links?: LegalLinkKey[] }) {
  const { t } = useTranslation(["common"]);
  const { colors } = useTheme();
  const links = props.links ?? ["privacy", "terms", "support", "deleteAccount"];
  return (
    <View>
      {links.map((key, index) => (
        <Pressable
          accessibilityRole="link"
          key={key}
          onPress={() => void openLegalLink(key)}
          style={[styles.settingsRow, index > 0 ? { borderTopColor: colors.border, borderTopWidth: 1 } : null]}
        >
          <Text style={[styles.settingsRowText, { color: colors.text }]}>{t(labelKeys[key])}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", justifyContent: "center", marginTop: spacing[4] },
  item: { alignItems: "center", flexDirection: "row" },
  separator: { ...text("caption"), marginHorizontal: spacing[2] },
  link: { ...text("caption", "medium"), textDecorationLine: "underline" },
  consent: { ...text("caption"), marginTop: spacing[3], textAlign: "center" },
  inlineLink: { ...text("caption", "medium"), textDecorationLine: "underline" },
  settingsRow: { minHeight: 44, justifyContent: "center", paddingVertical: spacing[3] },
  settingsRowText: { ...text("bodySm", "medium") }
});
