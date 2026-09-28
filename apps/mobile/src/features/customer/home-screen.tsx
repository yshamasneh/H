import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { displayableImageUri, RemoteImage } from "../../components/remote-image";
import {
  getSupermarketCatalog,
  listActiveRestaurantOffers,
  listMyNotifications,
  listMyOrders,
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
import { cartItemCount, type Cart } from "./cart";
import { forgetMarketStore, resolveMarketStore, type MarketStore } from "./market";
import { useCustomerTheme, type CustomerTheme } from "./theme";
import { CartBar, ProductCard, cartBarClearance } from "./shop-kit";
import { quantityInCart } from "./shop.rules";
import { kvStore } from "../../core/kv-storage";
import { buyAgainItems, type BuyAgainItem } from "./discovery.rules";
import { loadRecentlyViewed, type RecentlyViewedProduct } from "./recently-viewed";
import { CustomerHomeHeader } from "./home-header";
import { SeasonalAccent } from "./seasonal-accent";

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

const storefrontProductCount = 8;

type CatalogFilters = { departmentId?: string; search?: string; focusSearch?: boolean };

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
  onOpenOffer: (offer: RestaurantOffer) => void;
  onAddItem: (store: MarketStore, item: MenuItemSummary) => void;
  onIncrementItem: (productId: string) => void;
  onDecrementItem: (productId: string) => void;
  onViewCart: () => void;
  onOpenNotifications: () => void;
}) {
  const { t } = useTranslation(["customer", "common"]);
  const { colors, isDark } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
  // undefined while resolving, null when no supermarket is reachable.
  const [store, setStore] = useState<MarketStore | null | undefined>(undefined);
  const [catalog, setCatalog] = useState<SupermarketCatalog | null>(null);
  const [offers, setOffers] = useState<RestaurantOffer[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  // Discovery shortcuts from what this customer already did: products opened on this device, and
  // products from their delivered orders. Both open the product page, which loads the current price.
  const [recentlyViewed, setRecentlyViewed] = useState<RecentlyViewedProduct[]>([]);
  const [buyAgain, setBuyAgain] = useState<BuyAgainItem[]>([]);
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

    setRecentlyViewed(await loadRecentlyViewed(kvStore, props.user.id));
    try {
      const accessToken = await getAccessToken();
      const orders = accessToken ? await listMyOrders(accessToken, 1, 10) : null;
      if (orders) setBuyAgain(buyAgainItems(orders.items));
    } catch {
      // Without past orders the "buy again" row is simply absent.
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
  const visibleOffers = offers?.filter(isOfferVisibleToCustomer);
  // The admin picks at most one offer to feature (see OffersService); nothing renders below when
  // none is active or visible, so the screen just keeps its normal appearance.
  const featuredOffer = visibleOffers?.find((offer) => offer.isFeatured);

  const storeName = store?.name ?? t("home.marketFallbackName");
  const marketClosed = store != null && !store.isOpenNow;
  const showCartDock = props.cart !== null && cartItemCount(props.cart) > 0;

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.background} barStyle={isDark ? "light-content" : "dark-content"} />
      <ScrollView
        contentContainerStyle={[styles.content, showCartDock && styles.contentWithCart]}
        refreshControl={<RefreshControl onRefresh={() => void refresh()} refreshing={refreshing} tintColor={customerTheme.colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <CustomerHomeHeader fullName={props.user.fullName} unreadCount={unreadCount} onOpenNotifications={props.onOpenNotifications} />
        {customerTheme.preset !== "normal" ? (
          <View style={styles.seasonalPromo}>
            <SeasonalAccent theme={customerTheme} background={customerTheme.decoration.promo} color={customerTheme.decoration.onPromo} />
            <Text style={styles.seasonalPromoText}>{t(`seasonal.${customerTheme.preset}`)}</Text>
          </View>
        ) : null}


        {props.notice ? <Text style={styles.notice}>{props.notice}</Text> : null}

        {/* Search first: most visits start with "do they have …". Tapping opens the catalogue with
            the keyboard already up. */}
        <Pressable
          accessibilityRole="search"
          disabled={!store || marketClosed}
          onPress={() => store && props.onOpenCatalog(store, { focusSearch: true })}
          style={({ pressed }) => [styles.searchBar, pressed && styles.offerCardPressed]}
          testID="home-search"
        >
          <View style={styles.searchIconSlot}><Icon color={customerTheme.colors.primary} name="search" size="md" /></View>
          <Text numberOfLines={1} style={styles.searchText}>{t("home.searchProductsPlaceholder")}</Text>
        </Pressable>

        {/* The store the customer is shopping from and whether it is taking orders right now. */}
        {store ? (
          <Pressable
            accessibilityRole="button"
            disabled={marketClosed}
            onPress={() => props.onOpenCatalog(store)}
            style={styles.storeStrip}
            testID="home-store-strip"
          >
            <Icon color={customerTheme.colors.primary} name="store" size="sm" />
            <Text numberOfLines={1} style={styles.storeStripName}>{storeName}</Text>
            <View style={[styles.storeStatus, marketClosed ? styles.storeStatusClosed : styles.storeStatusOpen]}>
              <View style={[styles.storeStatusDot, { backgroundColor: marketClosed ? customerTheme.colors.danger : customerTheme.colors.success }]} />
              <Text style={[styles.storeStatusText, { color: marketClosed ? customerTheme.colors.danger : customerTheme.colors.success }]}>
                {marketClosed ? t("shop.storeClosed") : t("shop.storeOpen")}
              </Text>
            </View>
            <View style={styles.storeStripSpacer} />
            {marketClosed ? null : <Text style={styles.seeAll}>{t("shop.browseAll")}</Text>}
          </Pressable>
        ) : null}

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

        {/* The admin's one featured offer, when there is one: a single full-width call-out ahead
            of the regular offers row, which lists every active offer without this distinction. */}
        {featuredOffer ? (
          <Pressable
            onPress={() => props.onOpenOffer(featuredOffer)}
            style={({ pressed }) => [styles.featuredBanner, pressed && styles.offerCardPressed]}
          >
            {displayableImageUri(featuredOffer.imageUrl) ? (
              <RemoteImage resizeMode="cover" uri={featuredOffer.imageUrl} style={styles.featuredBannerImage} />
            ) : null}
            <View style={styles.featuredBannerCopy}>
              <Text style={styles.featuredBannerEyebrow}>{t("home.featuredOfferEyebrow")}</Text>
              <Text numberOfLines={1} style={styles.featuredBannerTitle}>{featuredOffer.title}</Text>
              <View style={styles.featuredBannerRow}>
                <View style={styles.offerDiscountBadge}>
                  <Text style={styles.offerDiscountBadgeText}>{offerLabel(featuredOffer, t)}</Text>
                </View>
                <Text style={styles.featuredBannerCta}>{t("home.featuredOfferCta")}</Text>
              </View>
            </View>
          </Pressable>
        ) : null}

        {marketClosed || !store ? null : (
          <ProductShortcutStrip
            items={recentlyViewed.filter((entry) => entry.storeId === store.id).map((entry) => ({ productId: entry.id, name: entry.name, imageUrl: entry.imageUrl }))}
            onOpen={(productId) => props.onOpenProduct(store, productId)}
            testID="recently-viewed"
            title={t("shop.recentlyViewed")}
          />
        )}
        {marketClosed || !store ? null : (
          <ProductShortcutStrip
            items={buyAgain.filter((entry) => entry.storeId === store.id)}
            onOpen={(productId) => props.onOpenProduct(store, productId)}
            testID="buy-again"
            title={t("shop.buyAgain")}
          />
        )}

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

        {/* Offers only take space when there are some; the row simply isn't there otherwise. */}
        {visibleOffers === undefined ? (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t("home.offersSectionTitle")}</Text>
            </View>
            <ScrollView
              contentContainerStyle={styles.offersRowContent}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.offersRow}
            >
              <View style={styles.offerSlot}><OfferCardSkeleton /></View>
              <View style={styles.offerSlot}><OfferCardSkeleton /></View>
            </ScrollView>
          </>
        ) : visibleOffers.length === 0 ? null : (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t("home.offersSectionTitle")}</Text>
            </View>
          <ScrollView
            contentContainerStyle={styles.offersRowContent}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.offersRow}
          >
            {visibleOffers.map((offer) => (
              <Pressable
                key={offer.id}
                onPress={() => props.onOpenOffer(offer)}
                style={({ pressed }) => [styles.offerCard, pressed && styles.offerCardPressed]}
              >
                <View style={styles.offerVisual}>
                  {displayableImageUri(offer.imageUrl) ? (
                    <RemoteImage resizeMode="cover" uri={offer.imageUrl} style={styles.fullImage} />
                  ) : offer.type === "FREE_DELIVERY" ? (
                    <Icon color={customerTheme.colors.primary} name="bicycle" size="xxl" />
                  ) : (
                    <Text style={styles.offerPercentFallback}>{offer.discountPercent}%</Text>
                  )}
                </View>
                <View style={styles.offerCopy}>
                  <Text style={styles.offerRestaurant}>{offer.restaurantName ?? t("home.tasawaqWideOffer")}</Text>
                  <Text numberOfLines={1} style={styles.offerTitle}>{offer.title}</Text>
                  {offer.description ? <Text numberOfLines={2} style={styles.offerDescription}>{offer.description}</Text> : null}
                  <View style={styles.offerDiscountBadge}>
                    <Text style={styles.offerDiscountBadgeText}>{offerLabel(offer, t)}</Text>
                  </View>
                  {offer.endsAt ? (
                    <Text style={styles.offerExpiry}>{t("home.offerEndsLabel", { date: new Date(offer.endsAt).toLocaleDateString() })}</Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </ScrollView>
          </>
        )}

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
              <ProductCard
                key={product.id}
                onAdd={() => store && props.onAddItem(store, product)}
                onDecrement={() => props.onDecrementItem(product.id)}
                onIncrement={() => props.onIncrementItem(product.id)}
                onOpen={() => store && props.onOpenProduct(store, product.id)}
                product={product}
                quantity={quantityInCart(props.cart, product.id, store?.id)}
                style={styles.productCardSlot}
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
      {showCartDock && props.cart ? <CartBar cart={props.cart} onPress={props.onViewCart} /> : null}
    </SafeAreaView>
  );
}


/**
 * A short horizontal row of products the customer already knows (recently viewed, bought before):
 * picture and name only, one tap to the product page. Renders nothing when there is nothing to show.
 */
function ProductShortcutStrip(props: {
  title: string;
  items: { productId: string; name: string; imageUrl: string | null }[];
  onOpen: (productId: string) => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
  if (props.items.length === 0) return null;
  return (
    <View testID={props.testID}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{props.title}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.shortcutRow} horizontal showsHorizontalScrollIndicator={false}>
        {props.items.map((item) => (
          <Pressable
            accessibilityLabel={item.name}
            accessibilityRole="button"
            key={item.productId}
            onPress={() => props.onOpen(item.productId)}
            style={({ pressed }) => [styles.shortcutCard, pressed && styles.offerCardPressed]}
          >
            <View style={styles.shortcutImage}>
              <RemoteImage resizeMode="cover" style={styles.fullImage} uri={item.imageUrl} />
            </View>
            <Text numberOfLines={2} style={styles.shortcutName}>{item.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

// A restaurant-scoped offer would send the customer into a vertical that is not open yet, so only
// supermarket-scoped and platform-wide offers are ever shown to a customer — shared with the
// launch promo overlay so it picks the exact same offer the home screen would have shown.
export function isOfferVisibleToCustomer(offer: RestaurantOffer): boolean {
  return !offer.restaurantId || offer.restaurantBusinessType === "SUPERMARKET";
}

/** The one offer (if any) the admin has featured, filtered to what a customer may actually see. */
export function selectFeaturedOffer(offers: RestaurantOffer[]): RestaurantOffer | null {
  return offers.filter(isOfferVisibleToCustomer).find((offer) => offer.isFeatured) ?? null;
}

export function offerLabel(offer: RestaurantOffer, t: (key: string, options?: Record<string, unknown>) => string): string {
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
  contentWithCart: { paddingBottom: cartBarClearance + spacing[4] },
  seasonalPromo: { backgroundColor: customerTheme.decoration.promo, borderRadius: radius.md, flexDirection: "row", alignItems: "center", gap: spacing[2], padding: spacing[3], marginTop: spacing[3] },
  seasonalPromoText: { ...text("bodySm", "bold"), color: customerTheme.decoration.onPromo, flex: 1 },
  notice: { ...text("bodySm"), backgroundColor: customerTheme.colors.successSoft, borderRadius: radius.md, color: customerTheme.colors.success, marginTop: spacing[4], padding: spacing[3] },
  searchBar: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", marginTop: spacing[6], minHeight: 56, paddingHorizontal: spacing[4] },
  searchIconSlot: { marginEnd: spacing[3] },
  storeStrip: {
    alignItems: "center",
    backgroundColor: customerTheme.colors.surface,
    borderColor: customerTheme.colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing[2],
    marginTop: spacing[3],
    minHeight: 48,
    paddingHorizontal: spacing[4]
  },
  storeStripSpacer: { flex: 1 },
  storeStripName: { ...text("bodySm", "bold"), color: customerTheme.colors.text, flexShrink: 1 },
  storeStatus: { alignItems: "center", borderRadius: radius.pill, flexDirection: "row", gap: spacing[1], paddingHorizontal: spacing[2], paddingVertical: 2 },
  storeStatusOpen: { backgroundColor: customerTheme.colors.successSoft },
  storeStatusClosed: { backgroundColor: colors.errorSubtle },
  storeStatusDot: { borderRadius: 4, height: 8, width: 8 },
  storeStatusText: { ...text("label", "bold") },
  shortcutRow: { gap: spacing[3], paddingEnd: spacing[2] },
  shortcutCard: { width: 104 },
  shortcutImage: { aspectRatio: 1, backgroundColor: customerTheme.colors.surfaceMuted, borderColor: customerTheme.colors.border, borderRadius: radius.lg, borderWidth: 1, overflow: "hidden" },
  shortcutName: { ...text("caption", "semibold"), color: customerTheme.colors.text, marginTop: spacing[2] },
  searchText: { ...text("bodySm"), color: customerTheme.colors.textMuted, flex: 1 },
  featuredBanner: {
    backgroundColor: customerTheme.colors.inverseSurface,
    borderRadius: radius.lg,
    marginTop: spacing[6],
    overflow: "hidden",
    ...customerTheme.shadow
  },
  featuredBannerImage: { height: 140, width: "100%" },
  featuredBannerCopy: { padding: spacing[4] },
  featuredBannerEyebrow: { ...text("label", "bold"), color: customerTheme.colors.primary },
  featuredBannerTitle: { ...text("h2", "bold"), color: onDark.strong, marginTop: spacing[1] },
  featuredBannerRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: spacing[3] },
  featuredBannerCta: { ...text("bodySm", "bold"), color: onDark.medium },
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
  offerCardPressed: { opacity: 0.9 },
  offerVisual: { alignItems: "center", backgroundColor: colors.neutralSubtle, justifyContent: "center", minHeight: 150, width: "38%" },
  fullImage: { height: "100%", width: "100%" },
  offerPercentFallback: { color: customerTheme.colors.primary, fontSize: iconSize.xxxl, fontWeight: "900" },
  offerCopy: { flex: 1, justifyContent: "center", padding: spacing[4] },
  offerRestaurant: { ...text("label", "bold"), color: onDark.medium },
  offerTitle: { ...text("h2", "bold"), color: onDark.strong, marginTop: spacing[1] },
  offerDescription: { ...text("caption"), color: onDark.medium, marginTop: spacing[1] },
  offerDiscountBadge: { alignSelf: "flex-start", backgroundColor: customerTheme.colors.primary, borderRadius: radius.pill, marginTop: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[1] },
  offerDiscountBadgeText: { ...text("label", "bold"), color: colors.textInverse },
  offerExpiry: { ...text("label"), color: onDark.soft, marginTop: spacing[1] },
  productGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[3] },
  productCardSlot: { flexBasis: "46%", flexGrow: 1, maxWidth: "50%" },
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
});
