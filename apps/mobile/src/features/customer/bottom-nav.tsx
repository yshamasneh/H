import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon, type IconName } from "../../theme/icon";
import { colors, radius, spacing } from "../../theme/tokens";
import { text } from "../../theme/typography";
import { customerTheme } from "./theme";

export type CustomerTab = "home" | "browse" | "cart" | "orders" | "account";

const tabIcons: Record<CustomerTab, IconName> = {
  home: "home",
  browse: "browse",
  cart: "cart",
  orders: "orders",
  account: "account"
};

/**
 * The primary customer nav, fixed at the bottom of every tab-root screen
 * (Home, Browse, Cart, Orders, Account) — it does not scroll away with
 * content. Deep-flow screens (product detail, checkout, order detail,
 * settings) intentionally have no tab bar, matching every reference app's
 * convention that a focused task hides chrome that doesn't apply to it.
 *
 * Orange is reserved for the active tab only (filled icon + primary label);
 * every inactive tab stays neutral grey outline, per the scarce-orange rule.
 */
export function CustomerBottomNav(props: {
  active: CustomerTab;
  cartCount: number;
  onNavigate: (tab: CustomerTab) => void;
}) {
  const { t } = useTranslation(["customer"]);
  const tabs: CustomerTab[] = ["home", "browse", "cart", "orders", "account"];

  return (
    <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
      <View style={styles.bar}>
        {tabs.map((tab) => {
          const isActive = tab === props.active;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              key={tab}
              onPress={() => props.onNavigate(tab)}
              style={styles.tab}
            >
              <View style={styles.iconSlot}>
                <Icon active={isActive} color={isActive ? colors.primary : colors.textMuted} name={tabIcons[tab]} size="md" />
                {tab === "cart" && props.cartCount > 0 ? <Badge count={props.cartCount} /> : null}
              </View>
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

function Badge(props: { count: number }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{props.count > 9 ? "9+" : props.count}</Text>
    </View>
  );
}

/**
 * Pins `children` above the persistent bottom nav on a customer tab-root screen.
 *
 * The nav owns the bottom safe-area inset (see `CustomerBottomNav`'s
 * `edges={["bottom"]}`), so a tab-root screen rendered inside this shell is
 * never at the physical bottom of the display. Those screens must therefore
 * declare `edges={["top", "left", "right"]}` on their own `SafeAreaView` —
 * leaving `edges` unset defaults to all four and reserves the bottom inset a
 * second time, producing a visible dead strip above the nav on any device with
 * a home indicator or gesture bar (invisible on web, where the inset is 0).
 */
export function CustomerTabShell(props: {
  active: CustomerTab;
  cartCount: number;
  onNavigate: (tab: CustomerTab) => void;
  children: ReactNode;
}) {
  return (
    <View style={styles.shell}>
      <View style={styles.shellContent}>{props.children}</View>
      <CustomerBottomNav active={props.active} cartCount={props.cartCount} onNavigate={props.onNavigate} />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { backgroundColor: customerTheme.colors.background, flex: 1 },
  shellContent: { flex: 1 },
  safeArea: { backgroundColor: customerTheme.colors.surface, borderTopColor: customerTheme.colors.border, borderTopWidth: 1 },
  bar: { flexDirection: "row" },
  tab: { alignItems: "center", flex: 1, gap: spacing[1], paddingBottom: spacing[2], paddingTop: spacing[3] },
  iconSlot: { position: "relative" },
  label: { ...text("label", "medium"), color: customerTheme.colors.textMuted },
  labelActive: { color: customerTheme.colors.primary, fontWeight: "700" },
  badge: {
    alignItems: "center",
    backgroundColor: customerTheme.colors.primary,
    borderRadius: radius.pill,
    end: -8,
    height: 16,
    justifyContent: "center",
    minWidth: 16,
    paddingHorizontal: 3,
    position: "absolute",
    top: -6
  },
  badgeText: { color: colors.textInverse, fontSize: 9, fontWeight: "800" }
});
