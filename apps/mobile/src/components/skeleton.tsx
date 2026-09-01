import { useEffect, useMemo, useRef } from "react";
import { Animated, StyleSheet, View, type DimensionValue, type ViewStyle } from "react-native";
import { motionDuration, motionEasing, useReducedMotion } from "../theme/motion";
import { radius, spacing, type ThemeColors } from "../theme/tokens";
import { useTheme } from "../theme/theme-context";

/** Themed skeleton stylesheets, rebuilt when the light/dark mode toggles. */
function useSkeletonStyles() {
  const { colors } = useTheme();
  return useMemo(() => ({ styles: createStyles(colors), cardStyles: createCardStyles(colors) }), [colors]);
}

/**
 * The one loading-placeholder primitive for the customer surface. A pulsing
 * opacity (not a shimmer sweep — cheaper, and the effect reads the same at
 * these block sizes) that freezes at a fixed opacity when the OS/browser asks
 * for reduced motion, so a skeleton is still legible without ever animating.
 */
export function Skeleton(props: { width?: DimensionValue; height?: number; radius?: number; style?: ViewStyle }) {
  const { styles } = useSkeletonStyles();
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(0.65);
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: motionDuration.slow * 3, easing: motionEasing, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: motionDuration.slow * 3, easing: motionEasing, useNativeDriver: true })
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [reducedMotion, opacity]);

  return (
    <Animated.View
      style={[
        styles.base,
        {
          width: props.width ?? "100%",
          height: props.height ?? 14,
          borderRadius: props.radius ?? radius.sm,
          opacity
        },
        props.style
      ]}
    />
  );
}

/** One product-card placeholder — same shape for the home grid and the catalogue grid. */
export function ProductCardSkeleton(props: { artworkHeight?: number }) {
  const { cardStyles } = useSkeletonStyles();
  return (
    <View style={cardStyles.card}>
      <Skeleton height={props.artworkHeight ?? 100} radius={radius.md} style={cardStyles.artwork} />
      <Skeleton height={9} style={cardStyles.line} width="35%" />
      <Skeleton height={13} style={cardStyles.line} />
      <Skeleton height={13} style={cardStyles.line} width="65%" />
      <View style={cardStyles.priceRow}>
        <Skeleton height={14} width="45%" />
        <Skeleton height={32} radius={radius.md} width={32} />
      </View>
    </View>
  );
}

export function ProductGridSkeleton(props: { count?: number; artworkHeight?: number }) {
  const { cardStyles } = useSkeletonStyles();
  const items = Array.from({ length: props.count ?? 6 });
  return (
    <View style={cardStyles.grid}>
      {items.map((_, index) => (
        <ProductCardSkeleton artworkHeight={props.artworkHeight} key={index} />
      ))}
    </View>
  );
}

export function DepartmentStripSkeleton() {
  const { cardStyles } = useSkeletonStyles();
  return (
    <View style={cardStyles.strip}>
      {[132, 132, 132, 110].map((width, index) => (
        <Skeleton height={76} key={index} radius={radius.lg} width={width} />
      ))}
    </View>
  );
}

export function OfferCardSkeleton() {
  const { cardStyles } = useSkeletonStyles();
  return <Skeleton height={150} radius={radius.lg} style={cardStyles.offer} />;
}

/** One order-history row placeholder: icon block, title, subtitle, total. */
export function OrderCardSkeleton() {
  const { cardStyles } = useSkeletonStyles();
  return (
    <View style={cardStyles.orderCard}>
      <Skeleton height={42} radius={radius.md} width={42} />
      <Skeleton height={15} style={cardStyles.line} width="55%" />
      <Skeleton height={11} style={cardStyles.line} width="35%" />
      <Skeleton height={13} style={cardStyles.line} width="25%" />
    </View>
  );
}

export function OrderListSkeleton(props: { count?: number }) {
  const { cardStyles } = useSkeletonStyles();
  const items = Array.from({ length: props.count ?? 4 });
  return (
    <View style={cardStyles.listContent}>
      {items.map((_, index) => (
        <OrderCardSkeleton key={index} />
      ))}
    </View>
  );
}

/** The order-detail summary card placeholder: a title row plus several line-item rows. */
export function OrderDetailSkeleton() {
  const { cardStyles } = useSkeletonStyles();
  return (
    <View style={cardStyles.listContent}>
      <View style={cardStyles.summaryCard}>
        <View style={cardStyles.summaryHeaderRow}>
          <Skeleton height={13} width="45%" />
          <Skeleton height={22} radius={radius.pill} width={72} />
        </View>
        {[1, 2, 3].map((row) => (
          <View key={row} style={cardStyles.summaryRow}>
            <Skeleton height={12} width="55%" />
            <Skeleton height={12} width="20%" />
          </View>
        ))}
        <Skeleton height={1} style={cardStyles.divider} />
        <View style={cardStyles.summaryRow}>
          <Skeleton height={15} width="30%" />
          <Skeleton height={15} width="25%" />
        </View>
      </View>
      <View style={cardStyles.summaryCard}>
        <Skeleton height={13} style={cardStyles.line} width="40%" />
        <Skeleton height={12} style={cardStyles.line} />
        <Skeleton height={12} style={cardStyles.line} width="80%" />
      </View>
    </View>
  );
}

/** The product-detail screen placeholder: hero image, then the same text hierarchy the loaded screen uses. */
export function ProductDetailSkeleton() {
  const { cardStyles } = useSkeletonStyles();
  return (
    <View style={cardStyles.detailContent}>
      <Skeleton height={270} radius={radius.lg} />
      <Skeleton height={11} style={cardStyles.detailLine} width="30%" />
      <Skeleton height={22} style={cardStyles.detailLine} width="75%" />
      <Skeleton height={14} style={cardStyles.detailLine} width="40%" />
      <Skeleton height={30} style={cardStyles.detailPriceLine} width="35%" />
      <Skeleton height={56} radius={radius.lg} style={cardStyles.detailButton} />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  base: { backgroundColor: colors.neutralSubtle }
});

const createCardStyles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexBasis: 150,
    flexGrow: 1,
    maxWidth: 240,
    padding: spacing[3]
  },
  artwork: { marginBottom: spacing[3] },
  line: { marginTop: spacing[2] },
  priceRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: spacing[3] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[3] },
  strip: { flexDirection: "row", gap: spacing[3] },
  offer: { marginBottom: spacing[4] },
  orderCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing[4],
    padding: spacing[4]
  },
  listContent: { alignSelf: "center", maxWidth: 900, padding: spacing[4], width: "100%" },
  summaryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing[5],
    padding: spacing[5]
  },
  summaryHeaderRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: spacing[4] },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing[3] },
  divider: { marginVertical: spacing[2] },
  detailContent: { alignSelf: "center", maxWidth: 720, padding: spacing[5], width: "100%" },
  detailLine: { marginTop: spacing[4] },
  detailPriceLine: { marginTop: spacing[5] },
  detailButton: { marginTop: spacing[6] }
});
