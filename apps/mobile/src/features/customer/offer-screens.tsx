import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { displayableImageUri, RemoteImage } from "../../components/remote-image";
import type { RestaurantOffer } from "../../core/api";
import { Icon, backIconName } from "../../theme/icon";
import { iconSize, radius, spacing, type ThemeColors } from "../../theme/tokens";
import { useTheme } from "../../theme/theme-context";
import { text } from "../../theme/typography";
import { offerLabel } from "./home-screen";
import { resolveMarketStore, type MarketStore } from "./market";
import { useCustomerTheme, type CustomerTheme } from "./theme";

/**
 * The landing page for one specific offer — reached from the offers row on home (and, once
 * either exists, a push notification or a deep link would land here too, carrying the same
 * `RestaurantOffer` the caller already has). There is no GET-one-offer endpoint, so the record
 * travels with the navigation the same way `order-confirmation` carries its order.
 *
 * The call to action depends on what the offer actually discounts: a product offer with a
 * specific item goes straight to that product; anything basket-wide (order/delivery percentage,
 * free delivery) or a product offer with no single item goes to the store's catalogue instead.
 */
export function OfferDetailScreen(props: {
  offer: RestaurantOffer;
  onBack: () => void;
  onOpenCatalog: (store: MarketStore) => void;
  onOpenProduct: (store: MarketStore, productId: string) => void;
}) {
  const { t } = useTranslation(["customer", "common"]);
  const { colors } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
  const [store, setStore] = useState<MarketStore | null | undefined>(undefined);
  const { offer } = props;

  useEffect(() => {
    let cancelled = false;
    void resolveMarketStore().then((resolved) => !cancelled && setStore(resolved));
    return () => {
      cancelled = true;
    };
  }, []);

  const productTarget =
    offer.type === "PRODUCT_PERCENTAGE" && offer.menuItemId && offer.restaurantId
      ? { id: offer.restaurantId, name: offer.restaurantName ?? t("home.tasawaqWideOffer"), isOpenNow: store?.isOpenNow ?? true }
      : null;

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.inverseSurface} barStyle="light-content" />
      <View style={styles.header}>
        <Pressable
          accessibilityLabel={t("common:back")}
          onPress={props.onBack}
          style={styles.backButton}
        >
          <Icon color={colors.textInverse} name={backIconName()} size="md" />
        </Pressable>
        <Text style={styles.headerTitle}>{t("offerDetail.headerTitle")}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.artwork}>
          {displayableImageUri(offer.imageUrl) ? (
            <RemoteImage resizeMode="cover" uri={offer.imageUrl} style={styles.image} />
          ) : offer.type === "FREE_DELIVERY" ? (
            <Icon color={customerTheme.colors.primary} name="bicycle" size="xxl" />
          ) : (
            <Text style={styles.percentFallback}>{offer.discountPercent}%</Text>
          )}
        </View>

        <Text style={styles.eyebrow}>{offer.restaurantName ?? t("home.tasawaqWideOffer")}</Text>
        <Text style={styles.title}>{offer.title}</Text>
        <View style={styles.discountBadge}>
          <Text style={styles.discountBadgeText}>{offerLabel(offer, t)}</Text>
        </View>
        {offer.description ? <Text style={styles.description}>{offer.description}</Text> : null}

        <View style={styles.factList}>
          {offer.minimumSubtotalMinor > 0 ? (
            <Text style={styles.fact}>
              {t("offerDetail.minimumOrderLabel", { amount: formatPrice(offer.minimumSubtotalMinor) })}
            </Text>
          ) : null}
          {offer.maxDiscountMinor !== null ? (
            <Text style={styles.fact}>
              {t("offerDetail.maxDiscountLabel", { amount: formatPrice(offer.maxDiscountMinor) })}
            </Text>
          ) : null}
          {offer.endsAt ? (
            <Text style={styles.fact}>
              {t("home.offerEndsLabel", { date: new Date(offer.endsAt).toLocaleDateString() })}
            </Text>
          ) : null}
        </View>
      </ScrollView>

      {productTarget ? (
        <View style={styles.ctaDock}>
          <Pressable onPress={() => props.onOpenProduct(productTarget, offer.menuItemId!)} style={styles.ctaButton}>
            <Icon color={colors.textInverse} name="basket" size="sm" />
            <Text style={styles.ctaText}>{t("offerDetail.shopThisItem")}</Text>
          </Pressable>
        </View>
      ) : store ? (
        <View style={styles.ctaDock}>
          <Pressable onPress={() => props.onOpenCatalog(store)} style={styles.ctaButton}>
            <Icon color={colors.textInverse} name="basket" size="sm" />
            <Text style={styles.ctaText}>{t("offerDetail.shopNow")}</Text>
          </Pressable>
        </View>
      ) : store === null ? (
        <View style={styles.ctaDock}>
          <Text style={styles.unavailableText}>{t("offerDetail.unavailableText")}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function formatPrice(minor: number): string {
  return `${(minor / 100).toFixed(2)} ILS`;
}

const createStyles = (colors: ThemeColors, customerTheme: CustomerTheme) => StyleSheet.create({
  screen: { backgroundColor: customerTheme.colors.background, flex: 1 },
  header: {
    alignItems: "center",
    backgroundColor: customerTheme.colors.inverseSurface,
    flexDirection: "row",
    minHeight: 64,
    paddingHorizontal: spacing[4]
  },
  backButton: { alignItems: "center", justifyContent: "center", height: 40, width: 40 },
  headerTitle: { ...text("h3", "bold"), color: colors.textInverse, marginStart: spacing[3] },
  content: { alignSelf: "center", maxWidth: 720, padding: spacing[5], paddingBottom: spacing[9], width: "100%" },
  artwork: {
    alignItems: "center",
    backgroundColor: colors.neutralSubtle,
    borderRadius: radius.lg,
    height: 220,
    justifyContent: "center",
    overflow: "hidden"
  },
  image: { height: "100%", width: "100%" },
  percentFallback: { color: customerTheme.colors.primary, fontSize: iconSize.xxxl, fontWeight: "900" },
  eyebrow: { ...text("label", "bold"), color: customerTheme.colors.primary, marginTop: spacing[5] },
  title: { ...text("display", "bold"), color: customerTheme.colors.text, marginTop: spacing[2] },
  discountBadge: {
    alignSelf: "flex-start",
    backgroundColor: customerTheme.colors.primary,
    borderRadius: radius.pill,
    marginTop: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  discountBadgeText: { ...text("bodySm", "bold"), color: colors.textInverse },
  description: { ...text("body"), color: customerTheme.colors.textMuted, marginTop: spacing[4] },
  factList: { marginTop: spacing[5] },
  fact: { ...text("bodySm"), color: customerTheme.colors.textMuted, marginTop: spacing[2] },
  ctaDock: { backgroundColor: customerTheme.colors.background, borderTopColor: customerTheme.colors.border, borderTopWidth: 1, padding: spacing[4] },
  ctaButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: customerTheme.colors.primary,
    borderRadius: radius.lg,
    flexDirection: "row",
    gap: spacing[2],
    justifyContent: "center",
    maxWidth: 720,
    minHeight: 52,
    width: "100%"
  },
  ctaText: { ...text("bodySm", "bold"), color: colors.textInverse },
  unavailableText: { ...text("bodySm"), color: customerTheme.colors.textMuted, textAlign: "center" }
});
