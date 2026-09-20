import { useTranslation } from "react-i18next";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme/tokens";
import { text } from "../theme/typography";

/**
 * The prominent disclosure Google Play requires before an app asks for background location.
 *
 * It is a full, dismissible-only-by-choice screen shown BEFORE the system permission prompt, in the
 * app itself (not only in the privacy policy), and it says: what is collected, that it is collected
 * in the background, when, for what, who sees it, and how it stops. The driver has to choose: the
 * system prompt appears only after "Continue". Declining is a real choice and the delivery screen
 * keeps working without background sharing.
 *
 * The copy is in the driver namespace (tracking.disclosure.*) in English and Arabic. Changing it
 * materially means bumping disclosureVersion in core/tracking/location-consent.ts.
 */
export function BackgroundLocationDisclosure(props: {
  visible: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { t } = useTranslation(["driver"]);
  return (
    <Modal animationType="slide" onRequestClose={props.onDecline} transparent={false} visible={props.visible}>
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text accessibilityRole="header" style={styles.title}>{t("tracking.disclosure.title")}</Text>
          <Text style={styles.lead}>{t("tracking.disclosure.lead")}</Text>

          <Point label={t("tracking.disclosure.whatLabel")} body={t("tracking.disclosure.what")} />
          <Point label={t("tracking.disclosure.whenLabel")} body={t("tracking.disclosure.when")} />
          <Point label={t("tracking.disclosure.whyLabel")} body={t("tracking.disclosure.why")} />
          <Point label={t("tracking.disclosure.whoLabel")} body={t("tracking.disclosure.who")} />
          <Point label={t("tracking.disclosure.stopLabel")} body={t("tracking.disclosure.stop")} />

          {Platform.OS === "android" ? <Text style={styles.hint}>{t("tracking.disclosure.androidHint")}</Text> : null}
          {Platform.OS === "ios" ? <Text style={styles.hint}>{t("tracking.disclosure.iosHint")}</Text> : null}
        </ScrollView>

        <View style={styles.buttons}>
          <Pressable accessibilityRole="button" onPress={props.onAccept} style={[styles.button, styles.accept]}>
            <Text style={styles.acceptText}>{t("tracking.disclosure.accept")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={props.onDecline} style={[styles.button, styles.decline]}>
            <Text style={styles.declineText}>{t("tracking.disclosure.decline")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Point({ label, body }: { label: string; body: string }) {
  return (
    <View style={styles.point}>
      <Text style={styles.pointLabel}>{label}</Text>
      <Text style={styles.pointBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1, paddingTop: spacing[8] },
  content: { padding: spacing[5], paddingBottom: spacing[6] },
  title: { ...text("h1", "bold"), color: colors.text },
  lead: { ...text("body"), color: colors.text, marginTop: spacing[3] },
  point: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginTop: spacing[3], padding: spacing[4] },
  pointLabel: { ...text("bodySm", "bold"), color: colors.primary },
  pointBody: { ...text("bodySm"), color: colors.text, marginTop: spacing[1] },
  hint: { ...text("caption"), color: colors.textMuted, marginTop: spacing[4] },
  buttons: { borderTopColor: colors.border, borderTopWidth: 1, gap: spacing[3], padding: spacing[5] },
  button: { alignItems: "center", borderRadius: radius.md, justifyContent: "center", minHeight: 52 },
  accept: { backgroundColor: colors.primary },
  acceptText: { ...text("body", "bold"), color: colors.textInverse },
  decline: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  declineText: { ...text("body", "bold"), color: colors.text }
});
