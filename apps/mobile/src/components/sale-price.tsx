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
 * The percentage is derived from the two prices on every render.
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
  return (
    <View pointerEvents="none" style={styles.badge}>
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
      borderRadius: radius.pill,
      paddingHorizontal: spacing[2],
      paddingVertical: 3,
      position: "absolute",
      start: spacing[2],
      top: spacing[2],
      zIndex: 2
    },
    badgeText: { ...text("label", "bold"), color: colors.textInverse }
  });
}
