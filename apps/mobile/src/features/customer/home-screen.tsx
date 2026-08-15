import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  getSupermarketCatalog,
  listActiveRestaurantOffers,
  listMyNotifications,
  type MenuItemSummary,
  type PublicUser,
  type RestaurantOffer,
  type SupermarketCatalog,
  type SupermarketProduct
} from "../../core/api";
import { getAccessToken } from "../../core/session";
import { Icon, disclosureIconName } from "../../theme/icon";
import { colors, iconSize, radius, spacing } from "../../theme/tokens";
import { text } from "../../theme/typography";
import { cartItemCount, cartSubtotalMinor, type Cart } from "./cart";
import { resolveMarketStore, type MarketStore } from "./market";
import { customerTheme } from "./theme";

/* On the dark hero/offer panels below (customerTheme.colors.secondary, which
   resolves to the same near-black as surfaceInverse), text hierarchy uses
   translucent white the same way apps/admin's dark sidebar does — there is
   no token for it there either, since it's a function of the specific panel
   colour rather than a reusable semantic. */
const onDark = {
  strong: colors.textInverse,
  medium: "rgba(255, 255, 255, 0.72)",
  soft: "rgba(255, 255, 255, 0.55)"
};

const logo = require("../../../assets/logo/jovo-wordmark.png");

const storefrontProductCount = 8;

type CatalogFilters = { departmentId?: string; search?: string };

/**
 * The customer's landing screen *is* JOVO MARKET's storefront.
 *
 * JOVO MARKET is the only supermarket partner at launch, so there is no
 * store-selection list anywhere in the customer flow: the store is resolved
 * once (see ./market.ts) and its departments and products are rendered here
 * directly, rather than behind a card you tap into. Everything on this screen
 * is one hop from a product.
 *
 * Restaurant browsing is deferred for this launch. Where restaurants used to
 * be listed there is now a "coming soon" card. The restaurant screens, routes
 * and the entire restaurant domain are untouched and still work for restaurant
 * owners and staff — only the customer's way in is gone.
 */
export function CustomerHomeScreen(props: {
  user: PublicUser;
  cart: Cart | null;
  notice?: string;
  onOpenCatalog: (store: MarketStore, filters?: CatalogFilters) => void;
  onOpenProduct: (store: MarketStore, productId: string) => void;
  onAddItem: (store: MarketStore, item: MenuItemSummary) => void;
  onViewCart: () => void;
  onOpenNotifications: () => void;
}) {
  const { t } = useTranslation(["customer", "common"]);
  // undefined while resolving, null when no supermarket is reachable.
  const [store, setStore] = useState<MarketStore | null | undefined>(undefined);
  const [catalog, setCatalog] = useState<SupermarketCatalog | null>(null);
  const [offers, setOffers] = useState<RestaurantOffer[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    void resolveMarketStore()
      .then(async (resolved) => {
        if (!mounted) return;
        setStore(resolved);
        if (!resolved) return;
        const result = await getSupermarketCatalog(resolved.id, { pageSize: storefrontProductCount });
        if (mounted) setCatalog(result);
      })
      .catch(() => {
        if (mounted) setCatalog(null);
      });

    listActiveRestaurantOffers()
      .then((activeOffers) => mounted && setOffers(activeOffers))
      .catch(() => mounted && setOffers([]));

    getAccessToken()
      .then((accessToken) => (accessToken ? listMyNotifications(accessToken, 1, 1) : null))
      .then((page) => mounted && page && setUnreadCount(page.unreadCount))
      .catch(() => {
        // A failed unread-count fetch just leaves the badge hidden — not worth surfacing an error for.
      });

    return () => {
      mounted = false;
    };
  }, []);

  // A restaurant-scoped offer would send the customer into a vertical that is
  // not open yet, so only supermarket-scoped and platform-wide offers are
  // shown. Platform-wide offers apply to the market order anyway.
  const visibleOffers = offers?.filter(
    (offer) => !offer.restaurantId || offer.restaurantBusinessType === "SUPERMARKET"
  );

  const storeName = store?.name ?? t("home.marketFallbackName");
  const showCartDock = props.cart !== null && cartItemCount(props.cart) > 0;

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.background} barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={[styles.content, showCartDock && styles.contentWithCart]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <View>
            <Text style={styles.eyebrow}>JOVO</Text>
            <Text style={styles.location}>{storeName}</Text>
          </View>
          <Pressable
            accessibilityLabel={t("common:notifications")}
            onPress={props.onOpenNotifications}
            style={styles.iconButton}
          >
            <Icon color={customerTheme.colors.text} name="notifications" size="md" />
            {unreadCount > 0 ? <View style={styles.notificationDot} /> : null}
          </Pressable>
        </View>

        <View style={styles.greetingRow}>
          <View style={styles.greetingText}>
            <Text style={styles.greeting}>{t("home.greeting", { name: firstName(props.user.fullName, t) })}</Text>
            <Text style={styles.greetingSubtitle}>{t("home.greetingSubtitleMarket")}</Text>
          </View>
          <Image resizeMode="contain" source={logo} style={styles.logo} />
        </View>

        {props.notice ? <Text style={styles.notice}>{props.notice}</Text> : null}

        <Pressable
          disabled={!store}
          onPress={() => store && props.onOpenCatalog(store)}
          style={styles.searchBar}
        >
          <View style={styles.searchIconSlot}><Icon color={customerTheme.colors.text} name="search" size="md" /></View>
          <Text style={styles.searchText}>{t("home.searchProductsPlaceholder")}</Text>
          <View style={styles.filterButton}><Icon color={customerTheme.colors.primary} name="filter" size="sm" /></View>
        </Pressable>

        <Pressable
          disabled={!store}
          onPress={() => store && props.onOpenCatalog(store)}
          style={styles.marketHero}
        >
          <View style={styles.marketIcon}><Text style={styles.marketEmoji}>🛒</Text></View>
          <View style={styles.marketCopy}>
            <Text style={styles.marketEyebrow}>{t("home.marketEyebrow")}</Text>
            <Text style={styles.marketTitle}>{storeName}</Text>
            <Text style={styles.marketDescription}>{t("home.supermarketDescription")}</Text>
          </View>
          <Icon color={onDark.strong} name={disclosureIconName()} size="lg" />
        </Pressable>

        {store === null ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t("home.marketUnavailableTitle")}</Text>
            <Text style={styles.emptyText}>{t("home.marketUnavailableText")}</Text>
          </View>
        ) : null}

        {catalog && catalog.departments.length > 0 ? (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t("home.departmentsSectionTitle")}</Text>
              <Pressable onPress={() => store && props.onOpenCatalog(store)}>
                <Text style={styles.seeAll}>{t("home.seeAll")}</Text>
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.departmentStripContent}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.departmentStrip}
            >
              {catalog.departments.map((department) => (
                <Pressable
                  key={department.id}
                  onPress={() => store && props.onOpenCatalog(store, { departmentId: department.id })}
                  style={styles.departmentCard}
                >
                  <Text numberOfLines={2} style={styles.departmentName}>{department.name}</Text>
                  {/* `total`, not `count`: `count` is i18next's plural
                      trigger, and this project deliberately avoids anything
                      that leans on Intl at runtime (no Intl.PluralRules
                      guarantee on Hermes). A count-neutral string reads
                      correctly at 1 and at 100 without plural machinery. */}
                  <Text style={styles.departmentCount}>
                    {t("home.departmentProductCount", { total: department.productCount })}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("home.offersSectionTitle")}</Text>
        </View>
        {visibleOffers === undefined ? (
          <ActivityIndicator color={customerTheme.colors.primary} style={styles.loader} />
        ) : visibleOffers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t("home.noOffersTitle")}</Text>
            <Text style={styles.emptyText}>{t("home.noOffersTextMarket")}</Text>
          </View>
        ) : (
          visibleOffers.map((offer) => (
            <Pressable
              key={offer.id}
              onPress={() => store && props.onOpenCatalog(store)}
              style={styles.offerCard}
            >
              <View style={styles.offerVisual}>
                {offer.imageUrl ? (
                  <Image resizeMode="cover" source={{ uri: offer.imageUrl }} style={styles.fullImage} />
                ) : (
                  <Text style={styles.offerEmoji}>%</Text>
                )}
              </View>
              <View style={styles.offerCopy}>
                <Text style={styles.offerRestaurant}>{offer.restaurantName ?? t("home.tasawaqWideOffer")}</Text>
                <Text style={styles.offerTitle}>{offer.title}</Text>
                {offer.description ? <Text numberOfLines={2} style={styles.offerDescription}>{offer.description}</Text> : null}
                <Text style={styles.offerDiscount}>{offerLabel(offer, t)}</Text>
                {offer.endsAt ? (
                  <Text style={styles.offerExpiry}>{t("home.offerEndsLabel", { date: new Date(offer.endsAt).toLocaleDateString() })}</Text>
                ) : null}
              </View>
            </Pressable>
          ))
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("home.marketProductsSectionTitle")}</Text>
          <Pressable onPress={() => store && props.onOpenCatalog(store)}>
            <Text style={styles.seeAll}>{t("home.seeAll")}</Text>
          </Pressable>
        </View>
        {store === undefined || (store !== null && catalog === null) ? (
          <ActivityIndicator color={customerTheme.colors.primary} style={styles.loader} />
        ) : catalog === null || catalog.products.length === 0 ? (
          <View style={styles.emptyCard}><Text style={styles.emptyText}>{t("home.marketProductsEmpty")}</Text></View>
        ) : (
          <View style={styles.productGrid}>
            {catalog.products.map((product) => (
              <StorefrontProductCard
                key={product.id}
                onAdd={() => store && props.onAddItem(store, product)}
                onOpen={() => store && props.onOpenProduct(store, product.id)}
                product={product}
              />
            ))}
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("home.restaurantsSectionTitle")}</Text>
        </View>
        <View style={styles.comingSoonCard}>
          <View style={styles.comingSoonIcon}><Text style={styles.comingSoonEmoji}>🍽️</Text></View>
          <Text style={styles.comingSoonTitle}>{t("home.restaurantsComingSoonTitle")}</Text>
          <Text style={styles.comingSoonText}>{t("home.restaurantsComingSoonText")}</Text>
        </View>

      </ScrollView>
      {showCartDock && props.cart ? (
        <View style={styles.cartDock}>
          <Pressable onPress={props.onViewCart} style={styles.cartButton}>
            <Text style={styles.cartCount}>{cartItemCount(props.cart)}</Text>
            <Text style={styles.cartLabel}>{t("restaurants.viewBasket")}</Text>
            <Text style={styles.cartPrice}>{formatPrice(cartSubtotalMinor(props.cart))}</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function StorefrontProductCard(props: {
  product: SupermarketProduct;
  onAdd: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation(["customer"]);
  const { product } = props;
  return (
    <Pressable onPress={props.onOpen} style={styles.productCard}>
      <View style={styles.productArtwork}>
        {product.imageUrl ? (
          <Image resizeMode="cover" source={{ uri: product.imageUrl }} style={styles.fullImage} />
        ) : (
          <Text style={styles.productEmoji}>🥫</Text>
        )}
      </View>
      <Text style={styles.productDepartment}>{product.categoryName}</Text>
      <Text numberOfLines={2} style={styles.productName}>{product.name}</Text>
      <Text style={styles.productUnit}>{product.unitLabel}</Text>
      <View style={styles.productPriceRow}>
        <Text style={styles.productPrice}>{formatPrice(product.effectivePriceMinor)}</Text>
        <Pressable
          accessibilityLabel={t("supermarket.addProductAccessibility", { name: product.name })}
          onPress={(event) => { event.stopPropagation(); props.onAdd(); }}
          style={styles.addButton}
        >
          <Icon color={colors.textInverse} name="add" size="sm" />
        </Pressable>
      </View>
    </Pressable>
  );
}

function firstName(fullName: string, t: (key: string) => string): string {
  return fullName.trim().split(/\s+/)[0] || t("home.defaultFirstName");
}

function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ILS`;
}

function offerLabel(offer: RestaurantOffer, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (offer.type === "FREE_DELIVERY") return t("home.freeDeliveryOffer");
  const percent = offer.discountPercent ?? 0;
  if (offer.type === "DELIVERY_PERCENTAGE") return t("home.percentOffDeliveryLabel", { percent });
  if (offer.type === "PRODUCT_PERCENTAGE") {
    return offer.menuItemName
      ? t("home.percentOffItemLabel", { percent, item: offer.menuItemName })
      : t("home.percentOffSelectedItemLabel", { percent });
  }
  return t("home.percentOffOrderLabel", { percent });
}

const styles = StyleSheet.create({
  screen: { backgroundColor: customerTheme.colors.background, flex: 1 },
  content: { alignSelf: "center", maxWidth: 900, padding: spacing[5], paddingBottom: spacing[9], width: "100%" },
  contentWithCart: { paddingBottom: spacing[10] + spacing[8] },
  topBar: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  eyebrow: { ...text("label", "bold"), color: customerTheme.colors.textMuted },
  location: { ...text("bodySm", "bold"), color: customerTheme.colors.text, marginTop: spacing[1] },
  iconButton: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderRadius: radius.lg, height: 46, justifyContent: "center", position: "relative", width: 46, ...customerTheme.shadow },
  notificationDot: { backgroundColor: customerTheme.colors.primary, borderColor: colors.surface, borderRadius: 6, borderWidth: 2, height: 10, position: "absolute", end: 7, top: 7, width: 10 },
  greetingRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: spacing[6] },
  greetingText: { flex: 1 },
  greeting: { ...text("display", "bold"), color: customerTheme.colors.text },
  greetingSubtitle: { ...text("body"), color: customerTheme.colors.textMuted, marginTop: spacing[1] },
  logo: { height: 34, width: 110 },
  notice: { ...text("bodySm"), backgroundColor: customerTheme.colors.successSoft, borderRadius: radius.md, color: customerTheme.colors.success, marginTop: spacing[4], padding: spacing[3] },
  searchBar: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", marginTop: spacing[6], minHeight: 56, paddingHorizontal: spacing[4] },
  searchIconSlot: { marginEnd: spacing[3] },
  searchText: { ...text("bodySm"), color: customerTheme.colors.textMuted, flex: 1 },
  filterButton: { alignItems: "center", backgroundColor: customerTheme.colors.primarySoft, borderRadius: radius.md, height: 36, justifyContent: "center", width: 36 },
  marketHero: { alignItems: "center", backgroundColor: customerTheme.colors.secondary, borderRadius: radius.lg, flexDirection: "row", marginTop: spacing[5], minHeight: 112, padding: spacing[4], ...customerTheme.shadow },
  marketIcon: { alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.lg, height: 70, justifyContent: "center", width: 70 },
  marketEmoji: { fontSize: iconSize.xl },
  marketCopy: { flex: 1, marginStart: spacing[4] },
  marketEyebrow: { ...text("label", "bold"), color: customerTheme.colors.primary },
  marketTitle: { ...text("h2", "bold"), color: onDark.strong, marginTop: spacing[1] },
  marketDescription: { ...text("caption"), color: onDark.medium, marginTop: spacing[1] },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: spacing[4], marginTop: spacing[7] },
  sectionTitle: { ...text("h2", "bold"), color: customerTheme.colors.text },
  seeAll: { ...text("caption", "bold"), color: customerTheme.colors.primary },
  loader: { marginVertical: spacing[8] },
  emptyCard: { backgroundColor: customerTheme.colors.surface, borderRadius: radius.lg, marginTop: spacing[4], padding: spacing[6] },
  emptyTitle: { ...text("body", "bold"), color: customerTheme.colors.text, marginBottom: spacing[2], textAlign: "center" },
  emptyText: { ...text("bodySm"), color: customerTheme.colors.textMuted, textAlign: "center" },
  departmentStrip: { marginBottom: spacing[1] },
  departmentStripContent: { gap: spacing[3], paddingEnd: spacing[2] },
  departmentCard: {
    backgroundColor: customerTheme.colors.surface,
    borderColor: customerTheme.colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 76,
    minWidth: 132,
    padding: spacing[4]
  },
  departmentName: { ...text("bodySm", "bold"), color: customerTheme.colors.text },
  departmentCount: { ...text("label"), color: customerTheme.colors.textMuted, marginTop: spacing[1] },
  offerCard: { backgroundColor: customerTheme.colors.secondary, borderRadius: radius.lg, flexDirection: "row", marginBottom: spacing[4], minHeight: 150, overflow: "hidden", ...customerTheme.shadow },
  offerVisual: { alignItems: "center", backgroundColor: colors.neutralSubtle, justifyContent: "center", minHeight: 150, width: "38%" },
  fullImage: { height: "100%", width: "100%" },
  offerEmoji: { color: customerTheme.colors.primary, fontSize: iconSize.xxxl, fontWeight: "900" },
  offerCopy: { flex: 1, justifyContent: "center", padding: spacing[4] },
  offerRestaurant: { ...text("label", "bold"), color: onDark.medium },
  offerTitle: { ...text("h2", "bold"), color: onDark.strong, marginTop: spacing[1] },
  offerDescription: { ...text("caption"), color: onDark.medium, marginTop: spacing[1] },
  offerDiscount: { ...text("bodySm", "bold"), color: customerTheme.colors.primary, marginTop: spacing[2] },
  offerExpiry: { ...text("label"), color: onDark.soft },
  productGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[3] },
  productCard: {
    backgroundColor: customerTheme.colors.surface,
    borderColor: customerTheme.colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexGrow: 1,
    flexBasis: 150,
    maxWidth: 240,
    overflow: "hidden",
    padding: spacing[3]
  },
  productArtwork: {
    alignItems: "center",
    backgroundColor: colors.neutralSubtle,
    borderRadius: radius.md,
    height: 96,
    justifyContent: "center",
    marginBottom: spacing[3],
    overflow: "hidden"
  },
  productEmoji: { fontSize: iconSize.xxl },
  productDepartment: { ...text("label", "bold"), color: customerTheme.colors.primary },
  productName: { ...text("bodySm", "bold"), color: customerTheme.colors.text, marginTop: spacing[1] },
  productUnit: { ...text("label"), color: customerTheme.colors.textMuted, marginTop: spacing[1] },
  productPriceRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: spacing[3] },
  productPrice: { ...text("bodySm", "bold"), color: customerTheme.colors.text },
  addButton: {
    alignItems: "center",
    backgroundColor: customerTheme.colors.primary,
    borderRadius: radius.md,
    height: 32,
    justifyContent: "center",
    width: 32
  },
  comingSoonCard: {
    alignItems: "center",
    backgroundColor: customerTheme.colors.surface,
    borderColor: customerTheme.colors.border,
    borderRadius: radius.lg,
    borderStyle: "dashed",
    borderWidth: 1,
    padding: spacing[6]
  },
  comingSoonIcon: {
    alignItems: "center",
    backgroundColor: colors.neutralSubtle,
    borderRadius: radius.pill,
    height: 64,
    justifyContent: "center",
    marginBottom: spacing[3],
    width: 64
  },
  comingSoonEmoji: { fontSize: iconSize.xl },
  comingSoonTitle: { ...text("body", "bold"), color: customerTheme.colors.text, textAlign: "center" },
  comingSoonText: { ...text("bodySm"), color: customerTheme.colors.textMuted, marginTop: spacing[2], textAlign: "center" },
  cartDock: {
    backgroundColor: customerTheme.colors.background,
    borderTopColor: customerTheme.colors.border,
    borderTopWidth: 1,
    padding: spacing[4]
  },
  cartButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: customerTheme.colors.primary,
    borderRadius: radius.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    maxWidth: 900,
    minHeight: 56,
    paddingHorizontal: spacing[4],
    width: "100%"
  },
  cartCount: { ...text("bodySm", "bold"), color: colors.textInverse },
  cartLabel: { ...text("body", "bold"), color: colors.textInverse },
  cartPrice: { ...text("bodySm", "bold"), color: colors.textInverse }
});
