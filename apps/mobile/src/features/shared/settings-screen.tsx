import Constants from "expo-constants";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { deleteMyAccount, registerMyPushToken, unregisterMyPushToken, type PublicUser } from "../../core/api";
import { readError } from "../../core/errors";
import { clearStoredPushToken, getPushToken, getStoredPushToken, storePushToken } from "../../core/push-notifications";
import { getAccessToken } from "../../core/session";
import { LanguageSwitcher } from "../../i18n/LanguageSwitcher";
import { Icon, backIconName, disclosureIconName, type IconName } from "../../theme/icon";
import { radius, spacing, type ThemeColors } from "../../theme/tokens";
import { useTheme } from "../../theme/theme-context";
import { text } from "../../theme/typography";

/**
 * The one Settings screen for every role. The customer entry point (Account
 * screen's header) is what item 1 of the design brief asks for; the other
 * four screens that used to float their own `LanguageSwitcher`
 * (auth `HomeScreen`, driver home, admin dashboard, restaurant management)
 * now link here instead — a role with nothing extra to configure still gets
 * Language / About / Logout, so nothing loses a way to change language.
 *
 * Push toggle is self-contained (reads/writes its own token) rather than
 * threaded through props, since registration is role-agnostic — every
 * account type can enable order/status notifications the same way.
 */
export function SettingsScreen(props: {
  user: PublicUser;
  onBack: () => void;
  onLogout: () => Promise<void>;
  onManageAccount?: () => void;
  onDeleted?: () => Promise<void>;
}) {
  const { t } = useTranslation(["customer", "common"]);
  const { colors, isDark, setMode } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [loggingOut, setLoggingOut] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [togglingPush, setTogglingPush] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    void getStoredPushToken().then((stored) => setPushEnabled(Boolean(stored)));
  }, []);

  async function confirmLogout() {
    const proceed = await confirm(
      t("settings.logoutConfirmTitle"),
      t("settings.logoutConfirmBody"),
      t("settings.logoutButton"),
      t("common:cancel")
    );
    if (!proceed) return;
    setLoggingOut(true);
    try {
      await props.onLogout();
    } finally {
      setLoggingOut(false);
    }
  }

  async function removeAccount() {
    if (!props.onDeleted) return;
    const proceed = await confirm(
      t("account.confirmDialogTitle"),
      t("account.deleteAccountConfirm"),
      t("account.continueButton"),
      t("common:cancel")
    );
    if (!proceed) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error(t("common:sessionExpired"));
      await deleteMyAccount(accessToken);
      await clearStoredPushToken();
      await props.onDeleted();
    } catch (requestError) {
      setDeleteError(readError(requestError));
      setDeleting(false);
    }
  }

  async function togglePush() {
    setTogglingPush(true);
    setPushError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error(t("common:sessionExpired"));
      const existing = await getStoredPushToken();
      if (existing) {
        await unregisterMyPushToken(accessToken, existing);
        await clearStoredPushToken();
        setPushEnabled(false);
      } else {
        const next = await getPushToken();
        const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
        await registerMyPushToken(accessToken, next, platform);
        await storePushToken(next);
        setPushEnabled(true);
      }
    } catch (requestError) {
      setPushError(readError(requestError));
    } finally {
      setTogglingPush(false);
    }
  }

  const version = Constants.expoConfig?.version;

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={colors.background} barStyle="dark-content" />
      <View style={styles.header}>
        <Pressable accessibilityLabel={t("common:back")} accessibilityRole="button" onPress={props.onBack} style={styles.backButton}>
          <Icon name={backIconName()} size="md" />
        </Pressable>
        <Text style={styles.headerTitle}>{t("settings.headerTitle")}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <SectionCard icon="account" title={t("settings.accountSectionTitle")}>
          <Text style={styles.signedInLabel}>{t("settings.signedInAs")}</Text>
          <Text style={styles.signedInValue}>{props.user.fullName}</Text>
          <Text style={[styles.signedInPhone, styles.ltrText]}>{props.user.phone}</Text>
          {props.onManageAccount ? (
            <Pressable onPress={props.onManageAccount} style={styles.linkRow}>
              <Text style={styles.linkRowText}>{t("settings.manageAccountRow")}</Text>
              <Icon color={colors.textMuted} name={disclosureIconName()} size="sm" />
            </Pressable>
          ) : null}
        </SectionCard>

        <SectionCard icon="language" title={t("settings.languageSectionTitle")}>
          <LanguageSwitcher />
        </SectionCard>

        <SectionCard icon="contrast" title={t("settings.appearanceSectionTitle")}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleCopy}>
              <Text style={styles.toggleLabel}>{t("settings.darkModeLabel")}</Text>
              <Text style={styles.toggleHelper}>{t("settings.darkModeHelper")}</Text>
            </View>
            <Switch
              onValueChange={(value) => setMode(value ? "dark" : "light")}
              thumbColor={colors.surface}
              trackColor={{ false: colors.neutralSubtle, true: colors.primary }}
              value={isDark}
            />
          </View>
        </SectionCard>

        <SectionCard icon="notifications" title={t("settings.notificationsSectionTitle")}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleCopy}>
              <Text style={styles.toggleLabel}>{t("settings.pushNotificationsLabel")}</Text>
              <Text style={styles.toggleHelper}>{t("settings.pushNotificationsHelper")}</Text>
            </View>
            {togglingPush ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Switch
                onValueChange={() => void togglePush()}
                thumbColor={colors.surface}
                trackColor={{ false: colors.neutralSubtle, true: colors.primary }}
                value={pushEnabled}
              />
            )}
          </View>
          {pushError ? <Text style={styles.pushError}>{pushError}</Text> : null}
        </SectionCard>

        <SectionCard icon="info" title={t("settings.aboutSectionTitle")}>
          <Text style={styles.aboutBlurb}>{t("settings.aboutBlurb")}</Text>
          {version ? (
            <View style={styles.versionRow}>
              <Text style={styles.signedInLabel}>{t("settings.versionLabel")}</Text>
              <Text style={styles.versionValue}>{version}</Text>
            </View>
          ) : null}
        </SectionCard>

        {props.onDeleted ? (
          <View style={[styles.card, styles.dangerCard]}>
            <Text style={styles.dangerTitle}>{t("account.deleteAccountTitle")}</Text>
            <Text style={styles.dangerHelper}>{t("account.deleteAccountHelper")}</Text>
            {deleteError ? <Text style={styles.deleteError}>{deleteError}</Text> : null}
            <Pressable disabled={deleting} onPress={() => void removeAccount()} style={styles.deleteButton}>
              {deleting ? (
                <ActivityIndicator color={colors.error} />
              ) : (
                <Text style={styles.deleteText}>{t("account.deleteAccountButton")}</Text>
              )}
            </Pressable>
          </View>
        ) : (
          <Pressable disabled={loggingOut} onPress={() => void confirmLogout()} style={styles.logoutButton}>
            {loggingOut ? (
              <ActivityIndicator color={colors.error} />
            ) : (
              <>
                <Icon color={colors.error} name="logout" size="sm" />
                <Text style={styles.logoutText}>{t("settings.logoutButton")}</Text>
              </>
            )}
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionCard(props: { icon: IconName; title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIcon}><Icon color={colors.textMuted} name={props.icon} size="sm" /></View>
        <Text style={styles.cardTitle}>{props.title}</Text>
      </View>
      {props.children}
    </View>
  );
}

async function confirm(title: string, body: string, confirmLabel: string, cancelLabel: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return typeof globalThis.confirm === "function" ? globalThis.confirm(`${title}\n\n${body}`) : true;
  }
  return new Promise((resolve) => {
    Alert.alert(title, body, [
      { text: cancelLabel, style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, style: "destructive", onPress: () => resolve(true) }
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  header: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4]
  },
  backButton: { alignItems: "center", backgroundColor: colors.surfaceSunk, borderRadius: radius.lg, height: 44, justifyContent: "center", width: 44 },
  headerTitle: { ...text("h2", "bold"), color: colors.text, flex: 1, textAlign: "center" },
  headerSpacer: { width: 44 },
  content: { alignSelf: "center", maxWidth: 640, padding: spacing[5], paddingBottom: spacing[9], width: "100%" },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing[4],
    padding: spacing[5]
  },
  cardHeader: { alignItems: "center", flexDirection: "row", gap: spacing[3], marginBottom: spacing[4] },
  cardIcon: { alignItems: "center", backgroundColor: colors.surfaceSunk, borderRadius: radius.md, height: 36, justifyContent: "center", width: 36 },
  cardTitle: { ...text("h3", "bold"), color: colors.text },
  signedInLabel: { ...text("caption"), color: colors.textMuted },
  signedInValue: { ...text("body", "bold"), color: colors.text, marginTop: spacing[1] },
  signedInPhone: { ...text("bodySm"), color: colors.textMuted, marginTop: spacing[1] },
  /* Phone numbers are digits-plus-leading-plus — bidi-neutral content that
     the RTL paragraph direction otherwise reorders (the "+" drifts to the
     visual end). Forcing LTR here keeps "+970…" readable in Arabic. */
  ltrText: { writingDirection: "ltr" },
  linkRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing[4],
    paddingTop: spacing[4]
  },
  linkRowText: { ...text("bodySm", "medium"), color: colors.text },
  toggleRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  toggleCopy: { flex: 1, paddingEnd: spacing[3] },
  toggleLabel: { ...text("bodySm", "bold"), color: colors.text },
  toggleHelper: { ...text("caption"), color: colors.textMuted, marginTop: spacing[1] },
  pushError: { ...text("caption"), color: colors.error, marginTop: spacing[3] },
  aboutBlurb: { ...text("bodySm"), color: colors.textMuted },
  versionRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: spacing[4] },
  versionValue: { ...text("bodySm", "medium"), color: colors.text },
  logoutButton: {
    alignItems: "center",
    backgroundColor: colors.errorSubtle,
    borderRadius: radius.lg,
    flexDirection: "row",
    gap: spacing[2],
    justifyContent: "center",
    minHeight: 52,
    paddingVertical: spacing[3]
  },
  logoutText: { ...text("bodySm", "bold"), color: colors.error },
  dangerCard: { borderColor: colors.error },
  dangerTitle: { ...text("h3", "bold"), color: colors.text, marginBottom: spacing[2] },
  dangerHelper: { ...text("caption"), color: colors.textMuted, marginBottom: spacing[3] },
  deleteError: { ...text("caption"), color: colors.error, marginBottom: spacing[3] },
  deleteButton: {
    alignItems: "center",
    borderColor: colors.error,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: "center",
    padding: spacing[3]
  },
  deleteText: { ...text("bodySm", "bold"), color: colors.error }
});
