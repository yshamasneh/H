import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { hasReduction, isSale, salePercentOff } from "../core/sale";
import { radius, spacing } from "../theme/tokens";
import { useTheme } from "../theme/theme-context";
import { text } from "../theme/typography";

/**
 * The two pieces of a sale, used identically on the catalogue, product page, home grid, cart and
 * checkout so a sale looks the same everywhere it appears.
 */

type PriceProps = {
  regularMinor: number;
  effectiveMinor: number;
  /** Formats an amount in minor units; each screen already has its own. */
  format: (minor: number) => string;
  /** The screen's existing style for the current price, kept exactly when there is no reduction. */
  priceStyle: StyleProp<TextStyle>;
  /** Overrides the struck-through price's size where the default is too large for the layout. */
  regularStyle?: StyleProp<TextStyle>;
};

/**
 * The struck-through regular price beside the price actually charged, which is drawn larger and in
 * the brand orange. With no reduction it renders the one price exactly as the screen did before.
 */
export function PriceDisplay(props: PriceProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (!hasReduction(props.regularMinor, props.effectiveMinor)) {
    return <Text style={props.priceStyle}>{props.format(props.effectiveMinor)}</Text>;
  }
  return (
    <View style={styles.row}>
      <Text accessibilityLabel={props.format(props.regularMinor)} style={[styles.regular, props.regularStyle]}>
        {props.format(props.regularMinor)}
      </Text>
      <Text style={[props.priceStyle, styles.sale]}>{props.format(props.effectiveMinor)}</Text>
    </View>
  );
}

/**
 * Orange sticker with white text, laid over the corner of a product picture: "Save 50%" / "وفّر 50%".
 * It carries only the discount message — the prices themselves sit under the picture, in
 * PriceDisplay. The percentage is derived from the two prices on every render. A thin white rim and
 * a soft shadow lift it off any photograph, light or dark.
 *
 * Positioned with the logical `start` edge, so the sticker sits on the leading corner in both
 * languages and the layout mirrors as a whole rather than the badge landing on the wrong side of a
 * picture. Renders nothing for a product that is not on sale.
 */
export function SaleBadge(props: { item: { priceMinor: number; salePriceMinor?: number | null; effectivePriceMinor?: number } }) {
  const { t } = useTranslation(["common"]);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (!isSale(props.item)) return null;
  const percent = salePercentOff(props.item.priceMinor, props.item.salePriceMinor!);
  // A missing or broken regular price gives no meaningful percentage: show no sticker at all
  // rather than "Save 0%".
  if (percent <= 0) return null;
  return (
    <View pointerEvents="none" style={styles.badge} testID="sale-badge">
      <Text style={styles.badgeText}>{t("common:saleBadge", { percent })}</Text>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>["colors"]) {
  return StyleSheet.create({
    row: { alignItems: "baseline", flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    regular: { ...text("caption"), color: colors.textMuted, textDecorationLine: "line-through" },
    sale: { color: colors.primary },
    badge: {
      backgroundColor: colors.primary,
      borderColor: "rgba(255,255,255,0.9)",
      borderRadius: radius.pill,
      borderWidth: 1.5,
      elevation: 3,
      paddingHorizontal: spacing[2] + 2,
      paddingVertical: 4,
      position: "absolute",
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.18,
      shadowRadius: 4,
      start: spacing[2],
      top: spacing[2],
      zIndex: 2
    },
    badgeText: { ...text("label", "heavy"), color: colors.textInverse, letterSpacing: 0.2 }
  });
}
