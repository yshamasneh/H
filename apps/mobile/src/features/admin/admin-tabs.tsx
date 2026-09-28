import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { fetchAdminAccess, type AdminAccess } from "../../core/api";
import { getAccessToken } from "../../core/session";
import { Icon, type IconName } from "../../theme/icon";
import { useTheme } from "../../theme/theme-context";
import { spacing, type ThemeColors } from "../../theme/tokens";
import { text } from "../../theme/typography";
import { hasAdminPermission } from "./users.rules";

/**
 * The admin app's primary navigation, fixed at the bottom like the customer app's: the screens an
 * operator opens all day (Home, Orders, Drivers) are one tap away from anywhere, and everything
 * else — every other tool, notifications, settings and sign-out — sits under More. Detail screens
 * (an order, a driver, a tool) have no tab bar and a Back button instead.
 */
export type AdminTab = "home" | "orders" | "drivers" | "more";

const tabIcons: Record<AdminTab, IconName> = { home: "home", orders: "orders", drivers: "bicycle", more: "browse" };

/** Which tab needs which permission; Home and More are for every administrator. */
const tabPermission: Record<AdminTab, string | null> = {
  home: null,
  orders: "VIEW_ALL_ORDERS",
  drivers: "MANAGE_DRIVERS",
  more: null
};

/** "failed" = the access check could not be read; then every tab is offered and the server decides. */
export type AdminAccessState = AdminAccess | "failed" | null;

let cachedAccess: Promise<AdminAccess> | null = null;

/** Forget the cached permissions — on sign-out, so the next account starts fresh. */
export function resetAdminAccessCache() {
  cachedAccess = null;
}

/** The signed-in administrator's permissions, read once per session and shared by the tab screens. */
export function useAdminAccess(): AdminAccessState {
  const [access, setAccess] = useState<AdminAccessState>(null);
  useEffect(() => {
    let cancelled = false;
    if (!cachedAccess) {
      cachedAccess = getAccessToken().then((token) => {
        if (!token) throw new Error("no session");
        return fetchAdminAccess(token);
      });
      cachedAccess.catch(() => {
        cachedAccess = null;
      });
    }
    cachedAccess.then(
      (result) => !cancelled && setAccess(result),
      () => !cancelled && setAccess("failed")
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return access;
}

export function visibleAdminTabs(access: AdminAccessState): AdminTab[] {
  const all: AdminTab[] = ["home", "orders", "drivers", "more"];
  if (access === null || access === "failed") return all;
  return all.filter((tab) => tabPermission[tab] === null || hasAdminPermission(access, tabPermission[tab]!));
}

export function AdminTabBar(props: { active: AdminTab; onNavigate: (tab: AdminTab) => void }) {
  const { t } = useTranslation(["admin"]);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const access = useAdminAccess();
  const tabs = visibleAdminTabs(access);
  return (
    <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
      <View accessibilityRole="tablist" style={styles.bar}>
        {tabs.map((tab) => {
          const isActive = tab === props.active;
          return (
            <Pressable
              accessibilityLabel={t(`nav.${tab}`)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              key={tab}
              onPress={() => props.onNavigate(tab)}
              style={styles.tab}
              testID={`admin-tab-${tab}`}
            >
              <Icon active={isActive} color={isActive ? colors.primary : colors.textMuted} name={tabIcons[tab]} size="md" />
              <Text numberOfLines={1} style={[styles.label, isActive && styles.labelActive]}>
                {t(`nav.${tab}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

/** Pins a tab-root admin screen above the tab bar. The screen passes `tabRoot` to AdminPage. */
export function AdminTabShell(props: { active: AdminTab; onNavigate: (tab: AdminTab) => void; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      <View style={{ flex: 1 }}>{props.children}</View>
      <AdminTabBar active={props.active} onNavigate={props.onNavigate} />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: 1 },
    bar: { flexDirection: "row" },
    tab: { alignItems: "center", flex: 1, gap: spacing[1], minHeight: 56, paddingBottom: spacing[2], paddingTop: spacing[3] },
    label: { ...text("label", "medium"), color: colors.textMuted },
    labelActive: { color: colors.primary, fontWeight: "700" }
  });
}
