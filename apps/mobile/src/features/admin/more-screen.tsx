import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PublicUser } from "../../core/api";
import { confirmDestructive } from "../../core/confirm";
import { Icon, disclosureIconName, type IconName } from "../../theme/icon";
import { useTheme } from "../../theme/theme-context";
import { radius, spacing, type ThemeColors } from "../../theme/tokens";
import { text } from "../../theme/typography";
import { useAdminAccess } from "./admin-tabs";
import { ActionButton, AdminPage, Meta, useAdminStyles } from "./ui";
import { hasAdminPermission } from "./users.rules";

type Tool = { key: string; permission?: string; onPress: () => void };

/**
 * The More tab: who is signed in and signing out, at the very top where a thumb finds it without
 * scrolling; then every tool that is not a tab of its own, grouped by job and shown only when the
 * account can use it; then notifications and settings. Orders and Drivers are tabs, so they are not
 * repeated here.
 */
export function AdminMoreScreen(props: {
  user: PublicUser;
  onLogout: () => Promise<void>;
  onRestaurants: () => void;
  onCosts: () => void;
  onDriverCash: () => void;
  onProductOffers: () => void;
  onOffers: () => void;
  onUsers: () => void;
  onAnalytics: () => void;
  onAuditLog: () => void;
  onNotifications: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation(["admin", "common"]);
  const adminStyles = useAdminStyles();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const access = useAdminAccess();
  const [loggingOut, setLoggingOut] = useState(false);
  const can = (permission?: string) =>
    !permission || access === "failed" || (access !== null && hasAdminPermission(access, permission));

  const sections: { key: string; tools: Tool[] }[] = [
    {
      key: "approvals",
      tools: [
        { key: "stores", permission: "MANAGE_BUSINESSES", onPress: props.onRestaurants },
        { key: "costs", permission: "VIEW_ACCOUNTING", onPress: props.onCosts },
        { key: "driverCash", permission: "VIEW_ACCOUNTING", onPress: props.onDriverCash }
      ]
    },
    {
      key: "catalogue",
      tools: [
        { key: "productOffers", permission: "MANAGE_BUSINESSES", onPress: props.onProductOffers },
        { key: "offers", permission: "MANAGE_OFFERS", onPress: props.onOffers }
      ]
    },
    { key: "people", tools: [{ key: "users", permission: "MANAGE_USERS", onPress: props.onUsers }] },
    {
      key: "insights",
      tools: [
        { key: "analytics", permission: "VIEW_ALL_ORDERS", onPress: props.onAnalytics },
        { key: "auditLog", permission: "VIEW_AUDIT_LOG", onPress: props.onAuditLog }
      ]
    }
  ];

  async function confirmLogout() {
    if (!(await confirmDestructive(t("more.logoutTitle"), t("more.logoutBody"), t("common:logout"), t("common:cancel")))) return;
    setLoggingOut(true);
    await props.onLogout().finally(() => setLoggingOut(false));
  }

  return (
    <AdminPage tabRoot title={t("nav.more")}>
      <View style={styles.account}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{props.user.fullName.trim().charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={styles.accountName}>
            {props.user.fullName}
          </Text>
          <Text numberOfLines={1} style={styles.accountMeta}>{`⁦${props.user.phone}⁩`}</Text>
        </View>
        <ActionButton label={t("common:logout")} loading={loggingOut} onPress={() => void confirmLogout()} variant="danger" />
      </View>

      <View style={styles.group}>
        <Row icon="notifications" label={t("common:notifications")} onPress={props.onNotifications} />
        <Row icon="settings" label={t("common:settings")} onPress={props.onOpenSettings} />
      </View>

      {sections.map((section) => {
        const tools = section.tools.filter((tool) => can(tool.permission));
        if (tools.length === 0) return null;
        return (
          <View key={section.key}>
            <Text style={adminStyles.sectionTitle}>{t(`more.sections.${section.key}`)}</Text>
            <View style={styles.group}>
              {tools.map((tool) => (
                <Row
                  key={tool.key}
                  label={t(`dashboard.tools.${tool.key}.title`)}
                  meta={t(`dashboard.tools.${tool.key}.meta`)}
                  onPress={tool.onPress}
                />
              ))}
            </View>
          </View>
        );
      })}
      <Meta>{t("dashboard.webOnlyNote")}</Meta>
    </AdminPage>
  );
}

function Row(props: { label: string; meta?: string; icon?: IconName; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceSunk }]}
    >
      {props.icon ? <Icon color={colors.textMuted} name={props.icon} size="md" /> : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{props.label}</Text>
        {props.meta ? <Text style={styles.rowMeta}>{props.meta}</Text> : null}
      </View>
      <Icon color={colors.textMuted} name={disclosureIconName()} size="sm" />
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    account: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      flexDirection: "row",
      gap: spacing[3],
      marginBottom: spacing[3],
      padding: spacing[3]
    },
    avatar: {
      alignItems: "center",
      backgroundColor: colors.primarySubtle,
      borderRadius: 22,
      height: 44,
      justifyContent: "center",
      width: 44
    },
    avatarText: { ...text("h3", "bold"), color: colors.primary },
    accountName: { ...text("body", "semibold"), color: colors.text },
    accountMeta: { ...text("caption"), color: colors.textMuted },
    group: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      marginBottom: spacing[2],
      overflow: "hidden"
    },
    row: {
      alignItems: "center",
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: spacing[3],
      minHeight: 52,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3]
    },
    rowLabel: { ...text("body", "medium"), color: colors.text },
    rowMeta: { ...text("caption"), color: colors.textMuted, marginTop: 2 }
  });
}
