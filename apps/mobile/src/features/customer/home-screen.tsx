import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Image,
  Pressable,
  RefreshControl,
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
import { DepartmentStripSkeleton, OfferCardSkeleton, ProductGridSkeleton } from "../../components/skeleton";
import { Icon, disclosureIconName } from "../../theme/icon";
import { iconSize, radius, spacing, type ThemeColors } from "../../theme/tokens";
import { useTheme } from "../../theme/theme-context";
import { text } from "../../theme/typography";
import { cartItemCount, cartSubtotalMinor, type Cart } from "./cart";
import { forgetMarketStore, resolveMarketStore, type MarketStore } from "./market";
import { useCustomerTheme, type CustomerTheme } from "./theme";

/* On the dark hero/offer panels below (customerTheme.colors.secondary, which
   resolves to the same near-black as surfaceInverse), text hierarchy uses
   translucent white the same way apps/admin's dark sidebar does — there is
   no token for it there either, since it's a function of the specific panel
   colour rather than a reusable semantic. */
// These sit on the always-dark hero/offer panels (customerTheme inverseSurface),
// which stay dark in both light and dark mode, so the text stays white in both.
const onDark = {
  strong: "#FFFFFF",
  medium: "rgba(255, 255, 255, 0.72)",
  soft: "rgba(255, 255, 255, 0.55)"
};

const logo = require("../../../assets/logo/jovo-wordmark.png");
const mascot = require("../../../assets/logo/jovo_mascot_final.png");

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
  const { colors } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
  // undefined while resolving, null when no supermarket is reachable.
  const [store, setStore] = useState<MarketStore | null | undefined>(undefined);
  const [catalog, setCatalog] = useState<SupermarketCatalog | null>(null);
  const [offers, setOffers] = useState<RestaurantOffer[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  async function load(forceStoreRefresh: boolean) {
    if (forceStoreRefresh) forgetMarketStore();
    try {
      const resolved = await resolveMarketStore();
      setStore(resolved);
      // A closed store is resolvable but not shoppable — skip its catalog so the home shows a clear
      // "closed" state rather than products the customer cannot order.
      setCatalog(resolved && resolved.isOpenNow ? await getSupermarketCatalog(resolved.id, { pageSize: storefrontProductCount }) : null);
    } catch {
      setCatalog(null);
    }

    try {
      setOffers(await listActiveRestaurantOffers());
    } catch {
      setOffers([]);
    }

    try {
      const accessToken = await getAccessToken();
      const page = accessToken ? await listMyNotifications(accessToken, 1, 1) : null;
      if (page) setUnreadCount(page.unreadCount);
    } catch {
      // A failed unread-count fetch just leaves the badge hidden — not worth surfacing an error for.
    }
  }

  useEffect(() => {
    void load(false);
  }, []);

  async function refresh() {
    setRefreshing(true);
    // The store not being reachable is exactly the case this pull-to-refresh
    // exists for — home's own "pull down to try again" empty-state copy
    // promises this action, so a failed store lookup must retry, not reuse
    // the cached failure.
    await load(store === null);
    setRefreshing(false);
  }

  // A restaurant-scoped offer would send the customer into a vertical that is
  // not open yet, so only supermarket-scoped and platform-wide offers are
  // shown. Platform-wide offers apply to the market order anyway.
  const visibleOffers = offers?.filter(
    (offer) => !offer.restaurantId || offer.restaurantBusinessType === "SUPERMARKET"
  );

  const storeName = store?.name ?? t("home.marketFallbackName");
  const marketClosed = store != null && !store.isOpenNow;
  const showCartDock = props.cart !== null && cartItemCount(props.cart) > 0;

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.background} barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={[styles.content, showCartDock && styles.contentWithCart]}
        refreshControl={<RefreshControl onRefresh={() => void refresh()} refreshing={refreshing} tintColor={customerTheme.colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* The identity block leads the screen: the notifications row and the greeting +
            wordmark/mascot are the very first thing a returning customer sees. */}
        <View style={styles.topBar}>
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
          <View style={styles.brandLockup}>
            <Image resizeMode="contain" source={mascot} style={styles.logoMascot} />
            <Image resizeMode="contain" source={logo} style={styles.logo} />
          </View>
        </View>

        {/* Offers sit directly under the identity block: a horizontally scrollable promo row. */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("home.offersSectionTitle")}</Text>
        </View>
        {visibleOffers === undefined ? (
          <ScrollView
            contentContainerStyle={styles.offersRowContent}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.offersRow}
          >
            <View style={styles.offerSlot}><OfferCardSkeleton /></View>
            <View style={styles.offerSlot}><OfferCardSkeleton /></View>
          </ScrollView>
        ) : visibleOffers.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyCardIcon}><Icon color={customerTheme.colors.textMuted} name="star" size="lg" /></View>
            <Text style={styles.emptyTitle}>{t("home.noOffersTitle")}</Text>
            <Text style={styles.emptyText}>{t("home.noOffersTextMarket")}</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.offersRowContent}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.offersRow}
          >
            {visibleOffers.map((offer) => (
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
            ))}
          </ScrollView>
        )}

        {props.notice ? <Text style={styles.notice}>{props.notice}</Text> : null}

        <Pressable
          disabled={!store || marketClosed}
          onPress={() => store && props.onOpenCatalog(store)}
          style={styles.searchBar}
        >
          <View style={styles.searchIconSlot}><Icon color={customerTheme.colors.text} name="search" size="md" /></View>
          <Text style={styles.searchText}>{t("home.searchProductsPlaceholder")}</Text>
          <View style={styles.filterButton}><Icon color={customerTheme.colors.primary} name="filter" size="sm" /></View>
        </Pressable>

        <Pressable
          disabled={!store || marketClosed}
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
            <View style={styles.emptyCardIcon}><Icon color={customerTheme.colors.textMuted} name="alertCircle" size="lg" /></View>
            <Text style={styles.emptyTitle}>{t("home.marketUnavailableTitle")}</Text>
            <Text style={styles.emptyText}>{t("home.marketUnavailableText")}</Text>
          </View>
        ) : marketClosed ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyCardIcon}><Icon color={customerTheme.colors.textMuted} name="time" size="lg" /></View>
            <Text style={styles.emptyTitle}>{t("home.marketClosedTitle")}</Text>
            <Text style={styles.emptyText}>{t("home.marketClosedText")}</Text>
          </View>
        ) : null}

        {marketClosed ? null : store === undefined || (store !== null && catalog === null) ? (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t("home.departmentsSectionTitle")}</Text>
            </View>
            <DepartmentStripSkeleton />
          </>
        ) : catalog && catalog.departments.length > 0 ? (
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

        {marketClosed ? null : (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t("home.marketProductsSectionTitle")}</Text>
            <Pressable onPress={() => store && props.onOpenCatalog(store)}>
              <Text style={styles.seeAll}>{t("home.seeAll")}</Text>
            </Pressable>
          </View>
        )}
        {marketClosed ? null : store === undefined || (store !== null && catalog === null) ? (
          <ProductGridSkeleton artworkHeight={96} count={storefrontProductCount} />
        ) : catalog === null || catalog.products.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyCardIcon}><Icon color={customerTheme.colors.textMuted} name="basket" size="lg" /></View>
            <Text style={styles.emptyText}>{t("home.marketProductsEmpty")}</Text>
          </View>
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
  const { colors } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
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

const createStyles = (colors: ThemeColors, customerTheme: CustomerTheme) => StyleSheet.create({
  screen: { backgroundColor: customerTheme.colors.background, flex: 1 },
  content: { alignSelf: "center", maxWidth: 900, padding: spacing[5], paddingBottom: spacing[9], width: "100%" },
  contentWithCart: { paddingBottom: spacing[10] + spacing[8] },
  topBar: { alignItems: "center", flexDirection: "row", justifyContent: "flex-end" },
  brandLockup: { alignItems: "center", flexDirection: "row", gap: spacing[2] },
  logoMascot: { height: 34, width: 33 },
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
  marketHero: { alignItems: "center", backgroundColor: customerTheme.colors.primary, borderRadius: radius.lg, flexDirection: "row", marginTop: spacing[5], minHeight: 112, padding: spacing[4], ...customerTheme.shadow },
  marketIcon: { alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.lg, height: 70, justifyContent: "center", width: 70 },
  marketEmoji: { fontSize: iconSize.xl },
  marketCopy: { flex: 1, marginStart: spacing[4] },
  marketEyebrow: { ...text("label", "bold"), color: onDark.medium },
  marketTitle: { ...text("h2", "bold"), color: onDark.strong, marginTop: spacing[1] },
  marketDescription: { ...text("caption"), color: onDark.medium, marginTop: spacing[1] },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: spacing[4], marginTop: spacing[7] },
  offersRow: { marginBottom: spacing[1] },
  offersRowContent: { gap: spacing[4], paddingEnd: spacing[2] },
  offerSlot: { width: 320 },
  sectionTitle: { ...text("h2", "bold"), color: customerTheme.colors.text },
  seeAll: { ...text("caption", "bold"), color: customerTheme.colors.primary },
  emptyCard: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderRadius: radius.lg, marginTop: spacing[4], padding: spacing[6] },
  emptyCardIcon: {
    alignItems: "center",
    backgroundColor: colors.neutralSubtle,
    borderRadius: radius.pill,
    height: 56,
    justifyContent: "center",
    marginBottom: spacing[3],
    width: 56
  },
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
  offerCard: { backgroundColor: customerTheme.colors.inverseSurface, borderRadius: radius.lg, flexDirection: "row", minHeight: 150, overflow: "hidden", width: 320, ...customerTheme.shadow },
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
