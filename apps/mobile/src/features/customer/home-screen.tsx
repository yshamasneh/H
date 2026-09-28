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
  getPlatformSettings,
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
 * Reading order, top to bottom: search (it stays docked while scrolling),
 * offers, departments, then everything else (what the customer already knows,
 * the store's products). A section that has nothing to show renders nothing at
 * all, so there are never gaps where an empty section used to be.
 *
 * Restaurants are not part of the launch. The entry point is driven by the
 * server's restaurant gate (`restaurantOrderingEnabled` in the public settings,
 * i.e. RESTAURANT_ORDERING_ENABLED): off means nothing about restaurants is on
 * this screen, on means a Restaurants entry appears at the bottom. Turning
 * restaurants on later is that one setting, not an app release. The restaurant
 * screens, routes and domain are untouched.
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
  onOpenRestaurants?: () => void;
}) {
  const { t } = useTranslation(["customer", "common"]);
  const { colors, isDark } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
  // undefined while resolving, null when no supermarket is reachable.
  const [store, setStore] = useState<MarketStore | null | undefined>(undefined);
  const [catalog, setCatalog] = useState<SupermarketCatalog | null>(null);
  // The store resolved but its catalogue could not be fetched: say so, rather than showing
  // placeholders forever.
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [offers, setOffers] = useState<RestaurantOffer[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  // Whether restaurants are open to customers, from the server. Anything but an explicit true (an
  // older API, a failed fetch) keeps the restaurant entry point hidden.
  const [restaurantsEnabled, setRestaurantsEnabled] = useState(false);
  // Discovery shortcuts from what this customer already did: products opened on this device, and
  // products from their delivered orders. Both open the product page, which loads the current price.
  const [recentlyViewed, setRecentlyViewed] = useState<RecentlyViewedProduct[]>([]);
  const [buyAgain, setBuyAgain] = useState<BuyAgainItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // The independent requests run side by side, so offers, departments and products settle together
  // instead of each waiting behind the one before it (which made the layout shift in stages).
  async function load(forceStoreRefresh: boolean) {
    if (forceStoreRefresh) forgetMarketStore();
    setCatalogFailed(false);

    const storefront = (async () => {
      const resolved = await resolveMarketStore();
      setStore(resolved);
      // A closed store is resolvable but not shoppable — skip its catalog so the home shows a clear
      // "closed" state rather than products the customer cannot order.
      if (!resolved || !resolved.isOpenNow) {
        setCatalog(null);
        return;
      }
      try {
        setCatalog(await getSupermarketCatalog(resolved.id, { pageSize: storefrontProductCount }));
      } catch {
        setCatalog(null);
        setCatalogFailed(true);
      }
    })();

    const offersRequest = (async () => {
      try {
        setOffers(await listActiveRestaurantOffers());
      } catch {
        setOffers([]);
      }
    })();

    const accountRequests = (async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) return;
      await Promise.all([
        (async () => {
          try {
            setUnreadCount((await listMyNotifications(accessToken, 1, 1)).unreadCount);
          } catch {
            // A failed unread-count fetch just leaves the badge hidden — not worth surfacing an error for.
          }
        })(),
        (async () => {
          try {
            setRestaurantsEnabled((await getPlatformSettings(accessToken)).restaurantOrderingEnabled === true);
          } catch {
            // Unknown means hidden: restaurants only appear when the server says they are open.
          }
        })(),
        (async () => {
          try {
            setBuyAgain(buyAgainItems((await listMyOrders(accessToken, 1, 10)).items));
          } catch {
            // Without past orders the "buy again" row is simply absent.
          }
        })()
      ]);
    })();

    const recents = loadRecentlyViewed(kvStore, props.user.id).then(setRecentlyViewed);
    await Promise.all([storefront, offersRequest, accountRequests, recents]).catch(() => undefined);
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

  // Search is the fastest way to a product, so it works the moment the screen is up: if the store
  // is still resolving, the tap waits for it (a cached lookup) instead of doing nothing.
  async function openSearch() {
    const target = store ?? (await resolveMarketStore());
    if (target && target.isOpenNow) props.onOpenCatalog(target, { focusSearch: true });
  }

  // A restaurant-scoped offer would send the customer into a vertical that is
  // not open yet, so only supermarket-scoped and platform-wide offers are
  // shown. Platform-wide offers apply to the market order anyway.
  const visibleOffers = offers?.filter(isOfferVisibleToCustomer);
  // The admin picks at most one offer to feature (see OffersService). It leads the Offers section as
  // a full-width call-out, and is left out of the row below so it is not shown twice.
  const featuredOffer = visibleOffers?.find((offer) => offer.isFeatured);
  const rowOffers = visibleOffers?.filter((offer) => offer !== featuredOffer);
  const hasOffers = (visibleOffers?.length ?? 0) > 0;

  const storeName = store?.name ?? t("home.marketFallbackName");
  const marketClosed = store != null && !store.isOpenNow;
  const storeLoading = store === undefined || (store !== null && !marketClosed && catalog === null && !catalogFailed);
  const showCartDock = props.cart !== null && cartItemCount(props.cart) > 0;
  const showSeasonalPromo = customerTheme.preset !== "normal";
  const chevron = disclosureIconName();

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.background} barStyle={isDark ? "light-content" : "dark-content"} />
      <ScrollView
        contentContainerStyle={[styles.content, showCartDock && styles.contentWithCart]}
        refreshControl={<RefreshControl onRefresh={() => void refresh()} refreshing={refreshing} tintColor={customerTheme.colors.primary} />}
        showsVerticalScrollIndicator={false}
        // Child 1 (the search dock) stays docked. Everything above it is one wrapper so that index is
        // the same on native, which skips empty children when counting, and on web, which counts them.
        stickyHeaderIndices={[1]}
      >
        <View>
          <CustomerHomeHeader fullName={props.user.fullName} unreadCount={unreadCount} onOpenNotifications={props.onOpenNotifications} />
          {showSeasonalPromo ? (
            <View style={styles.seasonalPromo}>
              <SeasonalAccent theme={customerTheme} background={customerTheme.decoration.promo} color={customerTheme.decoration.onPromo} />
              <Text style={styles.seasonalPromoText}>{t(`seasonal.${customerTheme.preset}`)}</Text>
            </View>
          ) : null}
          {props.notice ? <Text style={styles.notice}>{props.notice}</Text> : null}
        </View>

        {/* 1 · Search. Most visits start with "do they have …", so it comes first and stays docked
            while the page scrolls. Tapping opens the catalogue with the keyboard already up. */}
        <View style={styles.searchDock}>
          <Pressable
            accessibilityLabel={t("home.searchProductsPlaceholder")}
            accessibilityRole="search"
            accessibilityState={{ disabled: store === null || marketClosed }}
            disabled={store === null || marketClosed}
            onPress={() => void openSearch()}
            style={({ pressed }) => [styles.searchBar, pressed && styles.pressed]}
            testID="home-search"
          >
            <Icon color={customerTheme.colors.textMuted} name="search" size="md" />
            <Text numberOfLines={1} style={styles.searchText}>{t("home.searchProductsPlaceholder")}</Text>
          </Pressable>
        </View>

        {/* Why the rest of the page is empty, said right under the search that cannot work. */}
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
            <View style={[styles.storeStatus, styles.storeStatusClosed, styles.closedStatus]}>
              <View style={[styles.storeStatusDot, { backgroundColor: customerTheme.colors.danger }]} />
              <Text style={[styles.storeStatusText, { color: customerTheme.colors.danger }]}>{t("shop.storeClosed")}</Text>
            </View>
          </View>
        ) : null}

        {/* 2 · Offers: the featured one as a call-out, then the rest in a row. Nothing at all when
            there are none, so the departments sit directly under the search. */}
        {visibleOffers === undefined ? (
          <View>
            <View style={styles.sectionHeader}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>{t("home.offersSectionTitle")}</Text>
            </View>
            <ScrollView contentContainerStyle={styles.offersRowContent} horizontal showsHorizontalScrollIndicator={false} style={styles.offersRow}>
              <View style={styles.offerSlot}><OfferCardSkeleton /></View>
              <View style={styles.offerSlot}><OfferCardSkeleton /></View>
            </ScrollView>
          </View>
        ) : hasOffers ? (
          <View testID="home-offers">
            <View style={styles.sectionHeader}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>{t("home.offersSectionTitle")}</Text>
            </View>
            {featuredOffer ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => props.onOpenOffer(featuredOffer)}
                style={({ pressed }) => [styles.featuredBanner, pressed && styles.pressed]}
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
            {rowOffers && rowOffers.length > 0 ? (
              <ScrollView
                contentContainerStyle={styles.offersRowContent}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={[styles.offersRow, featuredOffer && styles.offersRowAfterFeatured]}
              >
                {rowOffers.map((offer) => (
                  <Pressable
                    accessibilityRole="button"
                    key={offer.id}
                    onPress={() => props.onOpenOffer(offer)}
                    style={({ pressed }) => [styles.offerCard, pressed && styles.pressed]}
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
            ) : null}
          </View>
        ) : null}

        {/* 3 · Departments. */}
        {marketClosed || store === null ? null : catalogFailed ? (
          <View style={styles.emptyCard} testID="home-catalog-failed">
            <View style={styles.emptyCardIcon}><Icon color={customerTheme.colors.textMuted} name="alertCircle" size="lg" /></View>
            <Text style={styles.emptyTitle}>{t("home.catalogFailedTitle")}</Text>
            <Text style={styles.emptyText}>{t("home.catalogFailedText")}</Text>
            <Pressable accessibilityRole="button" onPress={() => void refresh()} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
              <Text style={styles.retryText}>{t("home.catalogRetry")}</Text>
            </Pressable>
          </View>
        ) : storeLoading ? (
          <View>
            <View style={styles.sectionHeader}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>{t("home.departmentsSectionTitle")}</Text>
            </View>
            <DepartmentStripSkeleton />
          </View>
        ) : catalog && catalog.departments.length > 0 ? (
          <View testID="home-departments">
            <View style={styles.sectionHeader}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>{t("home.departmentsSectionTitle")}</Text>
              <SeeAll label={t("home.seeAll")} onPress={() => store && props.onOpenCatalog(store)} />
            </View>
            <ScrollView
              contentContainerStyle={styles.departmentStripContent}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.departmentStrip}
            >
              {catalog.departments.map((department) => (
                <Pressable
                  accessibilityRole="button"
                  key={department.id}
                  onPress={() => store && props.onOpenCatalog(store, { departmentId: department.id })}
                  style={({ pressed }) => [styles.departmentCard, pressed && styles.pressed]}
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
          </View>
        ) : null}

        {/* 4 · Everything else: what the customer already knows, then the store's products. */}
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

        {marketClosed || store === null || catalogFailed ? null : (
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleGroup}>
              <Text accessibilityRole="header" numberOfLines={1} style={[styles.sectionTitle, styles.sectionTitleShrink]}>
                {t("home.marketProductsSectionTitle")}
              </Text>
              {store ? (
                <View style={[styles.storeStatus, styles.storeStatusOpen]}>
                  <View style={[styles.storeStatusDot, { backgroundColor: customerTheme.colors.success }]} />
                  <Text style={[styles.storeStatusText, { color: customerTheme.colors.success }]}>{t("shop.storeOpen")}</Text>
                </View>
              ) : null}
            </View>
            <SeeAll label={t("shop.browseAll")} onPress={() => store && props.onOpenCatalog(store)} />
          </View>
        )}
        {marketClosed || store === null || catalogFailed ? null : storeLoading ? (
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

        {/* Restaurants: only when the server has opened them to customers. Off (the launch state)
            means there is nothing here at all. */}
        {restaurantsEnabled && props.onOpenRestaurants ? (
          <View testID="home-restaurants">
            <View style={styles.sectionHeader}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>{t("home.restaurantsSectionTitle")}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={props.onOpenRestaurants}
              style={({ pressed }) => [styles.restaurantsEntry, pressed && styles.pressed]}
            >
              <Text style={styles.restaurantsEntryText}>{t("home.restaurantsEntryText")}</Text>
              <Icon color={customerTheme.colors.textMuted} name={chevron} size="md" />
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
      {showCartDock && props.cart ? <CartBar cart={props.cart} onPress={props.onViewCart} /> : null}
    </SafeAreaView>
  );
}

/** A section's "see all" link: neutral text with a chevron, so orange stays for offers and the actions that spend money. */
function SeeAll(props: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
  return (
    <Pressable accessibilityRole="link" hitSlop={spacing[2]} onPress={props.onPress} style={({ pressed }) => [styles.seeAllLink, pressed && styles.pressed]}>
      <Text style={styles.seeAll}>{props.label}</Text>
      <Icon color={customerTheme.colors.textMuted} name={disclosureIconName()} size="sm" />
    </Pressable>
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
            style={({ pressed }) => [styles.shortcutCard, pressed && styles.pressed]}
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
  pressed: { opacity: 0.9 },
  // Docked while scrolling: it bleeds to the screen edges (undoing the content padding) and is
  // opaque, so product cards do not show through the gutters beside it.
  searchDock: { backgroundColor: customerTheme.colors.background, marginHorizontal: -spacing[5], paddingBottom: spacing[2], paddingHorizontal: spacing[5], paddingTop: spacing[4] },
  searchBar: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: spacing[3], minHeight: 56, paddingHorizontal: spacing[4] },
  closedStatus: { marginTop: spacing[3] },
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
    overflow: "hidden",
    ...customerTheme.shadow
  },
  featuredBannerImage: { height: 140, width: "100%" },
  featuredBannerCopy: { padding: spacing[4] },
  featuredBannerEyebrow: { ...text("label", "bold"), color: onDark.medium },
  featuredBannerTitle: { ...text("h2", "bold"), color: onDark.strong, marginTop: spacing[1] },
  featuredBannerRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: spacing[3] },
  featuredBannerCta: { ...text("bodySm", "bold"), color: onDark.medium },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: spacing[4], marginTop: spacing[7] },
  offersRow: { marginBottom: spacing[1] },
  offersRowAfterFeatured: { marginTop: spacing[4] },
  offersRowContent: { gap: spacing[4], paddingEnd: spacing[2] },
  offerSlot: { width: 320 },
  sectionTitle: { ...text("h2", "bold"), color: customerTheme.colors.text },
  sectionTitleGroup: { alignItems: "center", flexDirection: "row", flexShrink: 1, gap: spacing[3] },
  sectionTitleShrink: { flexShrink: 1 },
  seeAllLink: { alignItems: "center", flexDirection: "row", gap: spacing[1], minHeight: 32 },
  seeAll: { ...text("caption", "bold"), color: customerTheme.colors.text },
  retryButton: { alignItems: "center", borderColor: customerTheme.colors.border, borderRadius: radius.md, borderWidth: 1, justifyContent: "center", marginTop: spacing[4], minHeight: 44, paddingHorizontal: spacing[5] },
  retryText: { ...text("bodySm", "bold"), color: customerTheme.colors.text },
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
  restaurantsEntry: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: spacing[3], minHeight: 64, paddingHorizontal: spacing[4] },
  restaurantsEntryText: { ...text("bodySm", "semibold"), color: customerTheme.colors.text, flex: 1 },
});
