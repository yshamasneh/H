import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { RemoteImage } from "../../components/remote-image";
import { PriceDisplay, SaleBadge } from "../../components/sale-price";
// Expo's safe-area module, not React Native's deprecated built-in `SafeAreaView`
// (iOS-only, a no-op on Android) — matching every other screen in this app.
import { SafeAreaView } from "react-native-safe-area-context";
import {
  getSupermarketCatalog,
  getSupermarketProduct,
  type SupermarketCatalog,
  type SupermarketProduct
} from "../../core/api";
import { cartBelongsToRestaurant, cartItemCount, type Cart } from "./cart";
import { readError } from "../../core/errors";
import { ProductDetailSkeleton, ProductGridSkeleton } from "../../components/skeleton";
import { Icon, backIconName } from "../../theme/icon";
import { iconSize, radius, spacing, withAlpha, type ThemeColors } from "../../theme/tokens";
import { useTheme } from "../../theme/theme-context";
import { text } from "../../theme/typography";
import { useCustomerTheme, type CustomerTheme } from "./theme";
import { CartBar, ProductCard, StockNote, ThemedStatusBar, cartBarClearance } from "./shop-kit";
import { formatShekel, quantityInCart, stockState } from "./shop.rules";

/** Opens the platform's maps app with directions to the store. Uses the universal Google Maps
 *  directions URL, which iOS and Android both resolve to their installed maps app. */
function openDirections(latitude: number, longitude: number) {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  void Linking.openURL(url).catch(() => undefined);
}

/**
 * JOVO MARKET is the only supermarket partner at launch, so the customer lands
 * on this catalogue directly — there is no store-selection screen in front of
 * it any more. `initialDepartmentId` / `initialSearch` let the home screen open
 * this already filtered, which is what makes a department tile on home a
 * single hop into the aisle rather than a hop into a picker.
 *
 * Search runs as the customer types (after a short pause) as well as on the
 * keyboard's search key; the list says how many products match and loads more
 * as it is scrolled, so nothing past the first page is out of reach.
 */
export function SupermarketCatalogScreen(props: {
  supermarketId: string;
  supermarketName: string;
  cart: Cart | null;
  initialDepartmentId?: string;
  initialSearch?: string;
  /** Opened from a search box: the search field takes focus straight away. */
  focusSearch?: boolean;
  onBack: () => void;
  onAddItem: (item: SupermarketProduct) => void;
  onIncrementItem: (productId: string) => void;
  onDecrementItem: (productId: string) => void;
  /** Receives the filters in force, so Back from the product returns to this same aisle. */
  onOpenProduct: (productId: string, filters: { departmentId?: string; search?: string }) => void;
  onViewCart: () => void;
}) {
  const { t } = useTranslation(["customer", "common"]);
  const { colors } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
  const [catalog, setCatalog] = useState<SupermarketCatalog | null>(null);
  const [products, setProducts] = useState<SupermarketProduct[]>([]);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchInput, setSearchInput] = useState(props.initialSearch ?? "");
  const [search, setSearch] = useState(props.initialSearch ?? "");
  const [departmentId, setDepartmentId] = useState<string | undefined>(props.initialDepartmentId);
  const [featured, setFeatured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // Search as the customer types, once they pause; the search key applies it at once.
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === search) return;
    const timer = setTimeout(() => setSearch(trimmed), searchDebounceMs);
    return () => clearTimeout(timer);
  }, [searchInput, search]);

  useEffect(() => {
    let mounted = true;
    setError(null);
    setCatalog(null);
    getSupermarketCatalog(props.supermarketId, { page: 1, pageSize: catalogPageSize, search: search || undefined, categoryId: departmentId, featured: featured || undefined })
      .then((result) => {
        if (!mounted) return;
        setCatalog(result);
        setProducts(result.products);
        setPage(1);
      })
      .catch((requestError) => mounted && setError(readError(requestError)));
    return () => { mounted = false; };
  }, [props.supermarketId, search, departmentId, featured, reload]);

  async function loadMore() {
    if (!catalog || loadingMore || products.length >= catalog.total) return;
    setLoadingMore(true);
    try {
      const next = await getSupermarketCatalog(props.supermarketId, {
        page: page + 1,
        pageSize: catalogPageSize,
        search: search || undefined,
        categoryId: departmentId,
        featured: featured || undefined
      });
      setProducts((current) => [...current, ...next.products.filter((product) => !current.some((existing) => existing.id === product.id))]);
      setPage(page + 1);
    } catch {
      // The next scroll tries again; the products already shown stay.
    } finally {
      setLoadingMore(false);
    }
  }

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setDepartmentId(undefined);
    setFeatured(false);
  }

  const showCart = props.cart !== null && props.cart.items.length > 0 && cartBelongsToRestaurant(props.cart, props.supermarketId);
  const activeDepartment = catalog?.departments.find((department) => department.id === departmentId);

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <ThemedStatusBar backgroundColor={customerTheme.colors.inverseSurface} onDarkPanel />
      <View style={styles.catalogHeader}>
        <BackButton onPress={props.onBack} />
        <View style={styles.headerCopy}>
          <Text style={styles.headerEyebrow}>{t("supermarket.supermarketLabel")}</Text>
          <Text numberOfLines={1} style={styles.catalogTitle}>{catalog?.supermarket.name ?? props.supermarketName}</Text>
          {/* The store's location is only present here when an admin has opted this store in (the
              API withholds the coordinates otherwise), so this whole row is the customer-facing
              expression of the showLocationToCustomer flag. It is unrelated to delivery tracking. */}
          {catalog && catalog.supermarket.latitude != null && catalog.supermarket.longitude != null ? (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                openDirections(catalog.supermarket.latitude as number, catalog.supermarket.longitude as number)
              }
              style={styles.locationRow}
            >
              <Icon color={customerTheme.colors.primary} name="location" size="xs" />
              <Text numberOfLines={1} style={styles.locationAddress}>{catalog.supermarket.addressLine}</Text>
              <Text style={styles.locationDirections}>{t("supermarket.getDirections")}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={styles.searchField}>
        <Icon color={customerTheme.colors.textMuted} name="search" size="sm" />
        <TextInput
          accessibilityLabel={t("supermarket.searchProductsPlaceholder")}
          autoCorrect={false}
          autoFocus={props.focusSearch}
          onChangeText={setSearchInput}
          onSubmitEditing={() => setSearch(searchInput.trim())}
          placeholder={t("supermarket.searchProductsPlaceholder")}
          placeholderTextColor={customerTheme.colors.textMuted}
          returnKeyType="search"
          style={styles.searchInput}
          testID="catalog-search"
          value={searchInput}
        />
        {searchInput ? (
          <Pressable
            accessibilityLabel={t("shop.clearSearch")}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => { setSearchInput(""); setSearch(""); }}
            style={styles.clearSearch}
          >
            <Icon color={customerTheme.colors.textMuted} name="closeCircle" size="sm" />
          </Pressable>
        ) : null}
      </View>
      {catalog ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.departmentStrip} contentContainerStyle={styles.departmentContent}>
          <Chip active={!departmentId && !featured} label={t("supermarket.allChip")} onPress={() => { setDepartmentId(undefined); setFeatured(false); }} />
          <Chip active={featured} label={t("supermarket.featuredChip")} onPress={() => setFeatured((current) => !current)} />
          {catalog.departments.map((department) => (
            <Chip
              active={departmentId === department.id}
              key={department.id}
              label={t("supermarket.departmentWithCount", { name: department.name, count: department.productCount })}
              onPress={() => setDepartmentId(departmentId === department.id ? undefined : department.id)}
            />
          ))}
        </ScrollView>
      ) : null}
      {catalog && !error ? (
        <View style={styles.resultLine}>
          <Text style={styles.resultCount}>
            {search
              ? t("shop.resultsFor", { total: catalog.total, query: search })
              : activeDepartment
                ? t("shop.resultsIn", { total: catalog.total, department: activeDepartment.name })
                : t("shop.resultCount", { total: catalog.total })}
          </Text>
          {search || departmentId || featured ? (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={clearFilters}>
              <Text style={styles.resultClear}>{t("supermarket.clearFiltersButton")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {error ? (
        <Centered><ErrorState message={error} onRetry={() => setReload((value) => value + 1)} /></Centered>
      ) : catalog === null ? (
        <ProductGridSkeleton artworkHeight={115} count={6} />
      ) : products.length === 0 ? (
        <Centered>
          <View style={styles.emptyIcon}><Icon color={customerTheme.colors.textMuted} name="search" size="lg" /></View>
          <Text style={styles.emptyText}>{t("supermarket.noProductsFound")}</Text>
          <Text style={styles.emptyHint}>{t("supermarket.noProductsFoundHint")}</Text>
          {search || departmentId || featured ? (
            <Pressable onPress={clearFilters} style={styles.clearFiltersButton}>
              <Text style={styles.clearFiltersText}>{t("supermarket.clearFiltersButton")}</Text>
            </Pressable>
          ) : null}
        </Centered>
      ) : (
        <FlatList
          columnWrapperStyle={styles.productRow}
          contentContainerStyle={[styles.productGrid, showCart && styles.productGridWithCart]}
          data={products}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => item.id}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={customerTheme.colors.primary} style={styles.loadingMore} />
            ) : products.length < catalog.total ? null : products.length > 6 ? (
              <Text style={styles.endOfList}>{t("shop.endOfList")}</Text>
            ) : null
          }
          numColumns={2}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.6}
          renderItem={({ item }) => (
            <ProductCard
              onAdd={() => props.onAddItem(item)}
              onDecrement={() => props.onDecrementItem(item.id)}
              onIncrement={() => props.onIncrementItem(item.id)}
              onOpen={() => props.onOpenProduct(item.id, { departmentId, search: search || undefined })}
              product={item}
              quantity={quantityInCart(props.cart, item.id, props.supermarketId)}
              style={styles.productCardSlot}
            />
          )}
        />
      )}
      {showCart ? <CartBar cart={props.cart!} onPress={props.onViewCart} /> : null}
    </SafeAreaView>
  );
}

/**
 * One product, laid out so the decision is easy: the picture, what it is and how it is sold, the
 * price (and what the sale saves), whether it is running low, the substitution choice, and a
 * bottom bar that is always in reach with the quantity and the total it will add. It also says how
 * many are already in the basket, so the same thing is not added twice by accident.
 */
export function SupermarketProductScreen(props: {
  supermarketId: string;
  productId: string;
  cart: Cart | null;
  /** Remembers the product for the storefront's "recently viewed" row (device-only). */
  onViewed?: (product: SupermarketProduct) => void;
  onBack: () => void;
  onAddItem: (item: SupermarketProduct & { allowSubstitution?: boolean }, quantity: number) => void;
  onViewCart: () => void;
}) {
  const { t } = useTranslation(["customer"]);
  const { colors } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
  const [product, setProduct] = useState<SupermarketProduct | null>(null);
  const [allowSubstitution, setAllowSubstitution] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let mounted = true;
    setError(null);
    getSupermarketProduct(props.supermarketId, props.productId)
      .then((result) => {
        if (!mounted) return;
        setProduct(result);
        props.onViewed?.(result);
      })
      .catch((requestError) => mounted && setError(readError(requestError)));
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.supermarketId, props.productId, reload]);

  const inBasket = quantityInCart(props.cart, props.productId, props.supermarketId);
  const basketCount = props.cart && cartBelongsToRestaurant(props.cart, props.supermarketId) ? cartItemCount(props.cart) : 0;
  const stock = product ? stockState(product.stockQuantity) : { kind: "untracked" as const };
  const soldOut = stock.kind === "out";
  // What can still be added: the counted stock less what is already in the basket.
  const remaining = product && product.stockQuantity !== null ? Math.max(0, product.stockQuantity - inBasket) : null;
  const canAddSelection = !soldOut && (remaining === null || quantity <= remaining) && (remaining === null || remaining > 0);

  return (
    <SafeAreaView style={styles.screen}>
      <ThemedStatusBar backgroundColor={customerTheme.colors.inverseSurface} onDarkPanel />
      <View style={styles.productDetailHeader}>
        <BackButton onPress={props.onBack} />
        <Text numberOfLines={1} style={styles.productDetailHeaderTitle}>{product?.name ?? t("supermarket.productDetailsTitle")}</Text>
        <Pressable
          accessibilityLabel={t("shop.openBasket", { items: basketCount })}
          accessibilityRole="button"
          onPress={props.onViewCart}
          style={styles.headerBasket}
          testID="header-basket"
        >
          <Icon color={colors.textInverse} name="cart" size="md" />
          {basketCount > 0 ? (
            <View style={styles.headerBasketBadge}><Text style={styles.headerBasketBadgeText}>{basketCount}</Text></View>
          ) : null}
        </Pressable>
      </View>
      {error ? <Centered><ErrorState message={error} onRetry={() => setReload((value) => value + 1)} /></Centered> : product === null ? (
        <ProductDetailSkeleton />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.detailContent}>
            <View style={styles.detailArtwork}>
              <RemoteImage resizeMode="contain" uri={product.imageUrl} style={[styles.image, soldOut && styles.imageSoldOut]} />
              <SaleBadge item={product} />
            </View>
            <Text style={styles.detailDepartment}>{product.brand ? `${product.categoryName} · ${product.brand}` : product.categoryName}</Text>
            <Text style={styles.detailName}>{product.name}</Text>
            <Text style={styles.detailUnit}>
              {product.sku
                ? t("supermarket.soldByLabelWithSku", { unit: product.unitLabel, sku: product.sku })
                : t("supermarket.soldByLabel", { unit: product.unitLabel })}
            </Text>
            <View style={styles.detailPriceRow}>
              <PriceDisplay
                effectiveMinor={product.effectivePriceMinor}
                format={formatPrice}
                priceStyle={styles.detailPrice}
                regularMinor={product.priceMinor}
                regularStyle={styles.oldPrice}
              />
            </View>
            <StockNote stockQuantity={product.stockQuantity} />
            {product.offer ? (
              <Text style={styles.offerBadge}>{t("supermarket.offerLabel", { title: product.offer.title, percent: product.offer.discountPercent })}</Text>
            ) : null}
            {inBasket > 0 ? (
              <Pressable accessibilityRole="button" onPress={props.onViewCart} style={styles.inBasketNote}>
                <Icon color={customerTheme.colors.success} name="checkCircle" size="sm" />
                <Text style={styles.inBasketNoteText}>{t("shop.alreadyInBasket", { quantity: inBasket })}</Text>
                <Text style={styles.inBasketNoteLink}>{t("shop.viewBasketShort")}</Text>
              </Pressable>
            ) : null}
            {product.description ? <Text style={styles.detailDescription}>{product.description}</Text> : null}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: allowSubstitution }}
              onPress={() => setAllowSubstitution((current) => !current)}
              style={[styles.substitutionCard, allowSubstitution && styles.substitutionCardActive]}
            >
              <View style={[styles.substitutionCheck, allowSubstitution && styles.substitutionCheckOn]}>
                {allowSubstitution ? <Icon color={colors.textInverse} name="checkmark" size="xs" /> : null}
              </View>
              <View style={styles.substitutionCopy}>
                <Text style={styles.substitutionTitle}>
                  {allowSubstitution ? t("supermarket.allowSubstitution") : t("supermarket.doNotReplace")}
                </Text>
                <Text style={styles.muted}>{t("supermarket.substitutionHelper")}</Text>
              </View>
            </Pressable>
          </ScrollView>
          <View style={styles.addBar}>
            {soldOut || remaining === 0 ? (
              <View style={styles.addBarUnavailable}>
                <Text style={styles.addBarUnavailableText}>{soldOut ? t("shop.outOfStock") : t("shop.allStockInBasket")}</Text>
              </View>
            ) : (
              <>
                <View style={styles.quantityStepper}>
                  <Pressable
                    accessibilityLabel={t("supermarket.decreaseQuantityAccessibility")}
                    accessibilityState={{ disabled: quantity <= 1 }}
                    disabled={quantity <= 1}
                    onPress={() => setQuantity((current) => Math.max(1, current - 1))}
                    style={[styles.stepperButton, quantity <= 1 && styles.stepperButtonDisabled]}
                  >
                    <Icon color={customerTheme.colors.primary} name="remove" size="sm" />
                  </Pressable>
                  <Text accessibilityLabel={t("supermarket.quantityLabel")} style={styles.stepperValue}>{quantity}</Text>
                  <Pressable
                    accessibilityLabel={t("supermarket.increaseQuantityAccessibility")}
                    accessibilityState={{ disabled: remaining !== null && quantity >= remaining }}
                    disabled={remaining !== null && quantity >= remaining}
                    onPress={() => setQuantity((current) => (remaining !== null ? Math.min(remaining, current + 1) : current + 1))}
                    style={[styles.stepperButton, remaining !== null && quantity >= remaining && styles.stepperButtonDisabled]}
                  >
                    <Icon color={customerTheme.colors.primary} name="add" size="sm" />
                  </Pressable>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={!canAddSelection}
                  onPress={() => {
                    props.onAddItem({ ...product, allowSubstitution }, quantity);
                    setQuantity(1);
                  }}
                  style={({ pressed }) => [styles.addDetailButton, pressed && styles.addDetailPressed]}
                  testID="add-to-basket"
                >
                  <Text numberOfLines={1} style={styles.addDetailText}>
                    {t("supermarket.addToBasketWithQuantity", { count: quantity, price: formatPrice(product.effectivePriceMinor * quantity) })}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const searchDebounceMs = 350;
const catalogPageSize = 40;

function Chip(props: { active: boolean; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
  return <Pressable onPress={props.onPress} style={[styles.chip, props.active && styles.chipActive]}><Text style={[styles.chipText, props.active && styles.chipTextActive]}>{props.label}</Text></Pressable>;
}

function BackButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation(["customer"]);
  const { colors } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
  return <Pressable accessibilityLabel={t("supermarket.goBackAccessibility")} onPress={onPress} style={styles.backButton}><Icon name={backIconName()} size="md" /></Pressable>;
}

function Centered({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
  return <View style={styles.centered}>{children}</View>;
}
function ErrorState(props: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation(["customer"]);
  const { colors } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
  return (
    <View style={styles.errorState}>
      <Text style={styles.errorText}>{props.message}</Text>
      {props.onRetry ? <Pressable onPress={props.onRetry} style={styles.retryButton}><Text style={styles.retryText}>{t("restaurants.tryAgain")}</Text></Pressable> : null}
    </View>
  );
}
const formatPrice = formatShekel;

const createStyles = (colors: ThemeColors, customerTheme: CustomerTheme) => StyleSheet.create({
  screen: { backgroundColor: customerTheme.colors.background, flex: 1 },
  catalogHeader: { alignItems: "center", backgroundColor: customerTheme.colors.inverseSurface, flexDirection: "row", minHeight: 86, padding: spacing[4] },
  headerCopy: { flex: 1, marginStart: spacing[4] },
  headerEyebrow: { ...text("label", "bold"), color: customerTheme.colors.primary },
  catalogTitle: { ...text("h2", "bold"), color: colors.textInverse, marginTop: spacing[1] },
  locationRow: { alignItems: "center", flexDirection: "row", gap: spacing[1], marginTop: spacing[1] },
  locationAddress: { ...text("caption"), color: withAlpha(colors.textInverse, 0.85), flexShrink: 1 },
  locationDirections: { ...text("caption", "bold"), color: customerTheme.colors.primary },
  backButton: { alignItems: "center", backgroundColor: withAlpha(colors.textInverse, 0.16), borderRadius: radius.lg, height: 44, justifyContent: "center", width: 44 },
  searchInput: { ...text("bodySm"), color: customerTheme.colors.text, flex: 1, minHeight: 44, outlineStyle: "none" } as never,
  centered: { alignItems: "center", flex: 1, justifyContent: "center", padding: spacing[7] },
  emptyIcon: {
    alignItems: "center",
    backgroundColor: colors.neutralSubtle,
    borderRadius: radius.pill,
    height: 64,
    justifyContent: "center",
    marginBottom: spacing[4],
    width: 64
  },
  emptyText: { ...text("bodySm", "bold"), color: customerTheme.colors.text, textAlign: "center" },
  emptyHint: { ...text("caption"), color: customerTheme.colors.textMuted, marginTop: spacing[1], textAlign: "center" },
  clearFiltersButton: {
    backgroundColor: customerTheme.colors.primarySoft,
    borderRadius: radius.md,
    marginTop: spacing[4],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3]
  },
  clearFiltersText: { ...text("bodySm", "bold"), color: customerTheme.colors.primaryDark },
  image: { height: "100%", width: "100%" },
  muted: { ...text("caption"), color: customerTheme.colors.textMuted, marginTop: spacing[1] },
  departmentStrip: { flexGrow: 0, flexShrink: 0, maxHeight: 54 },
  departmentContent: { alignItems: "center", paddingHorizontal: spacing[3], paddingBottom: spacing[2] },
  chip: { backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: radius.pill, borderWidth: 1, marginEnd: spacing[2], paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  chipActive: { backgroundColor: customerTheme.colors.inverseSurface, borderColor: customerTheme.colors.inverseSurface },
  chipText: { ...text("label", "bold"), color: customerTheme.colors.textMuted },
  chipTextActive: { color: colors.textInverse },
  productGrid: { alignSelf: "center", maxWidth: 900, padding: spacing[3], width: "100%" },
  productGridWithCart: { paddingBottom: cartBarClearance },
  productCardSlot: { flex: 1, marginBottom: spacing[2], maxWidth: "50%" },
  productRow: { gap: spacing[2] },
  offerBadge: { alignSelf: "flex-start", ...text("label", "bold"), backgroundColor: colors.successSubtle, borderRadius: radius.pill, color: colors.success, marginTop: spacing[2], paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
  productDetailHeader: { alignItems: "center", backgroundColor: customerTheme.colors.inverseSurface, flexDirection: "row", padding: spacing[4] },
  productDetailHeaderTitle: { ...text("h3", "bold"), color: colors.textInverse, flex: 1, marginHorizontal: spacing[3] },
  detailContent: { alignSelf: "center", maxWidth: 720, padding: spacing[5], width: "100%" },
  detailArtwork: { alignItems: "center", aspectRatio: 1.15, backgroundColor: customerTheme.colors.surface, borderRadius: radius.lg, justifyContent: "center", maxHeight: 360, overflow: "hidden", width: "100%" },
  detailDepartment: { ...text("label", "bold"), color: customerTheme.colors.primary, marginTop: spacing[5] },
  detailName: { ...text("h1", "bold"), color: customerTheme.colors.text, marginTop: spacing[2] },
  detailUnit: { ...text("caption"), color: customerTheme.colors.textMuted, marginTop: spacing[2] },
  detailDescription: { ...text("body"), color: customerTheme.colors.textMuted, marginTop: spacing[4] },
  detailPriceRow: { alignItems: "center", flexDirection: "row", gap: spacing[3], marginTop: spacing[4] },
  oldPrice: { ...text("body"), color: customerTheme.colors.textMuted, textDecorationLine: "line-through" },
  detailPrice: { ...text("h1", "bold"), color: customerTheme.colors.secondary },
  quantityStepper: { alignItems: "center", backgroundColor: customerTheme.colors.surfaceMuted, borderRadius: radius.md, flexDirection: "row", gap: spacing[3], padding: spacing[1] },
  stepperButton: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderRadius: radius.sm, height: 36, justifyContent: "center", width: 36 },
  stepperButtonDisabled: { opacity: 0.4 },
  stepperValue: { ...text("body", "bold"), color: customerTheme.colors.text, minWidth: 24, textAlign: "center" },
  substitutionCard: { alignItems: "flex-start", backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: spacing[3], marginTop: spacing[5], padding: spacing[4] },
  substitutionCardActive: { borderColor: customerTheme.colors.success },
  substitutionTitle: { ...text("caption", "bold"), color: customerTheme.colors.text },
  addDetailButton: { alignItems: "center", backgroundColor: customerTheme.colors.primary, borderRadius: radius.lg, flex: 1, justifyContent: "center", minHeight: 52, paddingHorizontal: spacing[3] },
  addDetailText: { ...text("body", "bold"), color: colors.textInverse },
  errorState: { alignItems: "center" },
  errorText: { ...text("caption"), color: customerTheme.colors.danger, textAlign: "center" },
  retryButton: { backgroundColor: customerTheme.colors.primary, borderRadius: radius.md, marginTop: spacing[3], paddingHorizontal: spacing[5], paddingVertical: spacing[2] },
  retryText: { ...text("bodySm", "bold"), color: colors.textInverse },
  searchField: {
    alignItems: "center",
    backgroundColor: customerTheme.colors.surface,
    borderColor: customerTheme.colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing[2],
    marginHorizontal: spacing[3],
    marginTop: spacing[3],
    marginBottom: spacing[2],
    minHeight: 48,
    paddingHorizontal: spacing[3]
  },
  clearSearch: { alignItems: "center", height: 32, justifyContent: "center", width: 32 },
  resultLine: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: spacing[4], paddingTop: spacing[1] },
  resultCount: { ...text("caption", "semibold"), color: customerTheme.colors.textMuted, flexShrink: 1 },
  resultClear: { ...text("caption", "bold"), color: customerTheme.colors.primary },
  loadingMore: { marginVertical: spacing[5] },
  endOfList: { ...text("caption"), color: customerTheme.colors.textMuted, marginVertical: spacing[5], textAlign: "center" },
  headerBasket: { alignItems: "center", backgroundColor: withAlpha(colors.textInverse, 0.16), borderRadius: radius.lg, height: 44, justifyContent: "center", width: 44 },
  headerBasketBadge: {
    alignItems: "center",
    backgroundColor: customerTheme.colors.primary,
    borderRadius: radius.pill,
    end: -4,
    height: 20,
    justifyContent: "center",
    minWidth: 20,
    paddingHorizontal: 4,
    position: "absolute",
    top: -4
  },
  headerBasketBadgeText: { ...text("label", "bold"), color: colors.textInverse },
  imageSoldOut: { opacity: 0.4 },
  inBasketNote: {
    alignItems: "center",
    backgroundColor: customerTheme.colors.successSoft,
    borderRadius: radius.md,
    flexDirection: "row",
    gap: spacing[2],
    marginTop: spacing[4],
    padding: spacing[3]
  },
  inBasketNoteText: { ...text("bodySm", "semibold"), color: customerTheme.colors.text, flex: 1 },
  inBasketNoteLink: { ...text("caption", "bold"), color: customerTheme.colors.primary },
  substitutionCheck: {
    alignItems: "center",
    borderColor: customerTheme.colors.border,
    borderRadius: 6,
    borderWidth: 2,
    height: 22,
    justifyContent: "center",
    width: 22
  },
  substitutionCheckOn: { backgroundColor: customerTheme.colors.success, borderColor: customerTheme.colors.success },
  substitutionCopy: { flex: 1 },
  addBar: {
    alignItems: "center",
    backgroundColor: customerTheme.colors.surface,
    borderTopColor: customerTheme.colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3]
  },
  addBarUnavailable: { alignItems: "center", backgroundColor: customerTheme.colors.surfaceMuted, borderRadius: radius.lg, flex: 1, justifyContent: "center", minHeight: 52 },
  addBarUnavailableText: { ...text("body", "bold"), color: customerTheme.colors.textMuted },
  addDetailPressed: { opacity: 0.85 }
});
