import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Animated, Pressable, StatusBar, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { RemoteImage } from "../../components/remote-image";
import { PriceDisplay, SaleBadge } from "../../components/sale-price";
import type { SupermarketProduct } from "../../core/api";
import { Icon } from "../../theme/icon";
import { motionDuration, motionEasing, useReducedMotion } from "../../theme/motion";
import { radius, spacing, withAlpha, type ThemeColors } from "../../theme/tokens";
import { useTheme } from "../../theme/theme-context";
import { text } from "../../theme/typography";
import { cartItemCount, cartSubtotalMinor, type Cart } from "./cart";
import { canAddMore, cartSavingsMinor, formatShekel, stockState } from "./shop.rules";
import { useCustomerTheme, type CustomerTheme } from "./theme";

/**
 * The customer shopping kit: the pieces every shopping screen shares, so a product, a quantity and
 * the basket look and behave the same from the storefront to checkout. Everything here is
 * presentation; adding and changing quantities goes through the app's existing cart handlers.
 */

/**
 * The status bar for a customer screen. Its text follows the light/dark theme, or stays light on
 * the always-dark panels (`onDarkPanel`). Several screens hard-coded dark text, which disappeared
 * against the dark theme.
 */
export function ThemedStatusBar(props: { backgroundColor: string; onDarkPanel?: boolean }) {
  const { isDark } = useTheme();
  return <StatusBar backgroundColor={props.backgroundColor} barStyle={props.onDarkPanel || isDark ? "light-content" : "dark-content"} />;
}

/** Scales a view briefly whenever `value` changes: a small, fast confirmation that something moved. */
function useBump(value: number) {
  const reducedMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reducedMotion) return;
    scale.setValue(0.88);
    Animated.timing(scale, { toValue: 1, duration: motionDuration.fast, easing: motionEasing, useNativeDriver: true }).start();
  }, [value, reducedMotion, scale]);
  return scale;
}

/**
 * Add / change quantity in one place. With nothing in the basket it is a single "+" (or a labelled
 * "Add" button); once added it becomes − n +, and at one the − becomes a bin so removing reads as
 * removing. It never offers more than a counted stock level.
 */
export function QuantityControl(props: {
  name: string;
  quantity: number;
  canAdd: boolean;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  size?: "compact" | "large";
  addLabel?: string;
  /** Screen-specific accessibility labels (e.g. naming the product); generic ones otherwise. */
  increaseLabel?: string;
  decreaseLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation(["customer"]);
  const { colors } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
  const scale = useBump(props.quantity);
  const large = props.size === "large";

  if (props.quantity === 0) {
    return (
      <Pressable
        accessibilityLabel={t("supermarket.addProductAccessibility", { name: props.name })}
        accessibilityRole="button"
        accessibilityState={{ disabled: !props.canAdd }}
        disabled={!props.canAdd}
        hitSlop={6}
        onPress={props.onAdd}
        style={({ pressed }) => [
          large ? styles.addLarge : styles.addCompact,
          !props.canAdd && styles.addDisabled,
          pressed && styles.pressed,
          props.style
        ]}
        testID={`add-${props.name}`}
      >
        <Icon color={props.canAdd ? colors.textInverse : customerTheme.colors.textMuted} name="add" size={large ? "md" : "sm"} />
        {large ? <Text style={[styles.addLargeText, !props.canAdd && styles.addDisabledText]}>{props.addLabel ?? t("shop.add")}</Text> : null}
      </Pressable>
    );
  }

  return (
    <View style={[styles.stepper, large && styles.stepperLarge, props.style]}>
      <Pressable
        accessibilityLabel={
          props.quantity === 1
            ? t("shop.removeFromBasket", { name: props.name })
            : props.decreaseLabel ?? t("supermarket.decreaseQuantityAccessibility")
        }
        accessibilityRole="button"
        hitSlop={6}
        onPress={props.onDecrement}
        style={({ pressed }) => [styles.stepperButton, large && styles.stepperButtonLarge, pressed && styles.pressed]}
        testID={`decrease-${props.name}`}
      >
        <Icon color={colors.textInverse} name={props.quantity === 1 ? "trash" : "remove"} size="sm" />
      </Pressable>
      <Animated.Text
        accessibilityLabel={t("shop.inBasketCount", { quantity: props.quantity })}
        style={[styles.stepperValue, large && styles.stepperValueLarge, { transform: [{ scale }] }]}
      >
        {props.quantity}
      </Animated.Text>
      <Pressable
        accessibilityLabel={props.increaseLabel ?? t("supermarket.increaseQuantityAccessibility")}
        accessibilityRole="button"
        accessibilityState={{ disabled: !props.canAdd }}
        disabled={!props.canAdd}
        hitSlop={6}
        onPress={props.onIncrement}
        style={({ pressed }) => [styles.stepperButton, large && styles.stepperButtonLarge, !props.canAdd && styles.stepperButtonDisabled, pressed && styles.pressed]}
        testID={`increase-${props.name}`}
      >
        <Icon color={colors.textInverse} name="add" size="sm" />
      </Pressable>
    </View>
  );
}

/** A small line under a product saying it is running low or gone; nothing when stock is healthy or not counted. */
export function StockNote(props: { stockQuantity: number | null | undefined }) {
  const { t } = useTranslation(["customer"]);
  const { colors } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
  const state = stockState(props.stockQuantity);
  if (state.kind === "out") return <Text style={[styles.stockNote, styles.stockOut]}>{t("shop.outOfStock")}</Text>;
  if (state.kind === "low") return <Text style={[styles.stockNote, styles.stockLow]}>{t("shop.onlyLeft", { left: state.left })}</Text>;
  return null;
}

/**
 * The one product card, used on the storefront, the catalogue and offers. Reads top to bottom in
 * the order a shopper scans: picture (with sale sticker), what it is, how it is sold, the price,
 * and the quantity already in the basket — changeable right here without opening the product.
 */
export function ProductCard(props: {
  product: SupermarketProduct;
  quantity: number;
  onOpen: () => void;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation(["customer"]);
  const { colors } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
  const { product } = props;
  const stock = stockState(product.stockQuantity);
  const soldOut = stock.kind === "out";
  const canAdd = !soldOut && canAddMore(product.stockQuantity, props.quantity);
  return (
    <Pressable
      accessibilityHint={t("shop.openProductHint")}
      accessibilityLabel={`${product.name}, ${formatShekel(product.effectivePriceMinor)}`}
      onPress={props.onOpen}
      style={({ pressed }) => [styles.card, props.quantity > 0 && styles.cardInBasket, pressed && styles.cardPressed, props.style]}
      testID={`product-card-${product.id}`}
    >
      <View style={styles.artwork}>
        <RemoteImage resizeMode="cover" style={[styles.image, soldOut && styles.imageSoldOut]} uri={product.imageUrl} />
        <SaleBadge item={product} />
        {product.offer ? (
          <View pointerEvents="none" style={styles.offerTag}>
            <Text style={styles.offerTagText}>{t("supermarket.offerPercentOnly", { percent: product.offer.discountPercent })}</Text>
          </View>
        ) : null}
        {props.quantity > 0 ? (
          <View pointerEvents="none" style={styles.inBasketBadge}>
            <Icon color={colors.textInverse} name="cart" size="xs" />
            <Text style={styles.inBasketBadgeText}>{props.quantity}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        <Text numberOfLines={1} style={styles.eyebrow}>{product.brand || product.categoryName}</Text>
        <Text numberOfLines={2} style={styles.name}>{product.name}</Text>
        <Text numberOfLines={1} style={styles.unit}>{product.unitLabel}</Text>
        <StockNote stockQuantity={product.stockQuantity} />
        <View style={styles.priceRow}>
          <View style={styles.priceSlot}>
            <PriceDisplay
              effectiveMinor={product.effectivePriceMinor}
              format={formatShekel}
              priceStyle={styles.price}
              regularMinor={product.priceMinor}
            />
          </View>
          {props.quantity === 0 ? (
            <QuantityControl
              canAdd={canAdd}
              name={product.name}
              onAdd={props.onAdd}
              onDecrement={props.onDecrement}
              onIncrement={props.onIncrement}
              quantity={0}
            />
          ) : null}
        </View>
        {props.quantity > 0 ? (
          <QuantityControl
            canAdd={canAdd}
            name={product.name}
            onAdd={props.onAdd}
            onDecrement={props.onDecrement}
            onIncrement={props.onIncrement}
            quantity={props.quantity}
            style={styles.cardStepper}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * The basket, always one tap away while shopping: how many items, what they come to, what the
 * sale prices are saving, and the way to the basket. It bumps when the basket changes so an add
 * made further up the screen is still noticed.
 */
export function CartBar(props: { cart: Cart; onPress: () => void }) {
  const { t } = useTranslation(["customer"]);
  const { colors } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
  const count = cartItemCount(props.cart);
  const scale = useBump(count);
  const savings = cartSavingsMinor(props.cart);
  return (
    <View pointerEvents="box-none" style={styles.cartDock}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable
          accessibilityLabel={t("shop.cartBarAccessibility", { items: count, total: formatShekel(cartSubtotalMinor(props.cart)) })}
          accessibilityRole="button"
          onPress={props.onPress}
          style={({ pressed }) => [styles.cartBar, pressed && styles.pressed]}
          testID="cart-bar"
        >
          <View style={styles.cartCountBubble}>
            <Text style={styles.cartCountText}>{count}</Text>
          </View>
          <View style={styles.cartCopy}>
            <Text style={styles.cartTitle}>{t("restaurants.viewBasket")}</Text>
            {savings > 0 ? <Text style={styles.cartSavings}>{t("shop.savingSoFar", { amount: formatShekel(savings) })}</Text> : null}
          </View>
          <Text style={styles.cartTotal}>{formatShekel(cartSubtotalMinor(props.cart))}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** Space a scrolling list leaves at its end so the last row is never hidden under the cart bar. */
export const cartBarClearance = 96;

function createStyles(colors: ThemeColors, customerTheme: CustomerTheme) {
  return StyleSheet.create({
    pressed: { opacity: 0.8 },
    addCompact: {
      alignItems: "center",
      backgroundColor: customerTheme.colors.primary,
      borderRadius: radius.pill,
      height: 36,
      justifyContent: "center",
      width: 36
    },
    addLarge: {
      alignItems: "center",
      backgroundColor: customerTheme.colors.primary,
      borderRadius: radius.lg,
      flexDirection: "row",
      gap: spacing[2],
      justifyContent: "center",
      minHeight: 52,
      paddingHorizontal: spacing[5]
    },
    addLargeText: { ...text("body", "bold"), color: colors.textInverse },
    addDisabled: { backgroundColor: customerTheme.colors.surfaceMuted },
    addDisabledText: { color: customerTheme.colors.textMuted },
    stepper: {
      alignItems: "center",
      backgroundColor: customerTheme.colors.primary,
      borderRadius: radius.pill,
      flexDirection: "row",
      height: 36,
      justifyContent: "space-between",
      paddingHorizontal: 2
    },
    stepperLarge: { borderRadius: radius.lg, height: 52, paddingHorizontal: spacing[1] },
    stepperButton: { alignItems: "center", borderRadius: radius.pill, height: 32, justifyContent: "center", width: 36 },
    stepperButtonLarge: { height: 44, width: 48 },
    stepperButtonDisabled: { opacity: 0.35 },
    stepperValue: { ...text("bodySm", "bold"), color: colors.textInverse, minWidth: 24, textAlign: "center" },
    stepperValueLarge: { ...text("h3", "bold") },
    stockNote: { ...text("label", "semibold"), marginTop: spacing[1] },
    stockLow: { color: customerTheme.colors.warning },
    stockOut: { color: customerTheme.colors.danger },
    card: {
      backgroundColor: customerTheme.colors.surface,
      borderColor: customerTheme.colors.border,
      borderRadius: radius.lg,
      borderWidth: 1,
      overflow: "hidden"
    },
    cardInBasket: { borderColor: withAlpha(customerTheme.colors.primary, 0.55) },
    cardPressed: { opacity: 0.92, transform: [{ scale: 0.985 }] },
    artwork: { aspectRatio: 1, backgroundColor: customerTheme.colors.surfaceMuted, overflow: "hidden" },
    image: { height: "100%", width: "100%" },
    imageSoldOut: { opacity: 0.4 },
    offerTag: {
      backgroundColor: customerTheme.colors.successSoft,
      borderRadius: radius.pill,
      bottom: spacing[2],
      paddingHorizontal: spacing[2],
      paddingVertical: 2,
      position: "absolute",
      start: spacing[2]
    },
    offerTagText: { ...text("label", "bold"), color: customerTheme.colors.success },
    inBasketBadge: {
      alignItems: "center",
      backgroundColor: customerTheme.colors.primary,
      borderRadius: radius.pill,
      end: spacing[2],
      flexDirection: "row",
      gap: 3,
      paddingHorizontal: spacing[2],
      paddingVertical: 2,
      position: "absolute",
      top: spacing[2]
    },
    inBasketBadgeText: { ...text("label", "bold"), color: colors.textInverse },
    body: { gap: 2, padding: spacing[3] },
    eyebrow: { ...text("label", "semibold"), color: customerTheme.colors.textMuted },
    name: { ...text("bodySm", "bold"), color: customerTheme.colors.text, minHeight: 36 },
    unit: { ...text("caption"), color: customerTheme.colors.textMuted },
    priceRow: { alignItems: "center", flexDirection: "row", gap: spacing[2], justifyContent: "space-between", marginTop: spacing[2], minHeight: 36 },
    priceSlot: { flex: 1 },
    price: { ...text("body", "heavy"), color: customerTheme.colors.text },
    cardStepper: { marginTop: spacing[2] },
    cartDock: { bottom: 0, end: 0, paddingBottom: spacing[3], paddingHorizontal: spacing[3], position: "absolute", start: 0 },
    cartBar: {
      alignItems: "center",
      alignSelf: "center",
      backgroundColor: customerTheme.colors.primary,
      borderRadius: radius.lg,
      flexDirection: "row",
      gap: spacing[3],
      maxWidth: 720,
      minHeight: 60,
      paddingHorizontal: spacing[3],
      width: "100%",
      ...customerTheme.shadow
    },
    cartCountBubble: {
      alignItems: "center",
      backgroundColor: withAlpha(colors.textInverse, 0.22),
      borderRadius: radius.pill,
      height: 32,
      justifyContent: "center",
      minWidth: 32,
      paddingHorizontal: spacing[2]
    },
    cartCountText: { ...text("bodySm", "bold"), color: colors.textInverse },
    cartCopy: { flex: 1 },
    cartTitle: { ...text("body", "bold"), color: colors.textInverse },
    cartSavings: { ...text("caption", "semibold"), color: withAlpha(colors.textInverse, 0.85) },
    cartTotal: { ...text("body", "heavy"), color: colors.textInverse }
  });
}
