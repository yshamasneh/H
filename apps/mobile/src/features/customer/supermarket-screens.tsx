import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import {
  ApiError,
  getSupermarketCatalog,
  getSupermarketProduct,
  listSupermarkets,
  type RestaurantSummary,
  type SupermarketCatalog,
  type SupermarketProduct
} from "../../core/api";
import { cartBelongsToRestaurant, cartItemCount, cartSubtotalMinor, type Cart } from "./cart";
import i18n from "../../i18n";
import { customerTheme } from "./theme";

export function SupermarketListScreen(props: {
  onBack: () => void;
  onOpenSupermarket: (supermarket: RestaurantSummary) => void;
}) {
  const { t } = useTranslation(["customer"]);
  const [stores, setStores] = useState<RestaurantSummary[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setError(null);
    try {
      setStores((await listSupermarkets(1, 50)).items);
    } catch (requestError) {
      setError(readError(requestError));
    }
  }

  useEffect(() => { void load(); }, []);

  const query = search.trim().toLowerCase();
  const visibleStores = stores?.filter((store) =>
    !query || [store.name, store.description, store.addressLine].some((value) => value?.toLowerCase().includes(query))
  );

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.secondary} barStyle="light-content" />
      <View style={styles.storeHeader}>
        <BackButton onPress={props.onBack} />
        <View style={styles.headerCopy}>
          <Text style={styles.headerEyebrow}>{t("supermarket.marketLabel")}</Text>
          <Text style={styles.headerTitle}>{t("supermarket.title")}</Text>
          <Text style={styles.headerSubtitle}>{t("supermarket.subtitle")}</Text>
        </View>
      </View>
      <View style={styles.searchBox}>
        <TextInput
          onChangeText={setSearch}
          placeholder={t("supermarket.searchPlaceholder")}
          placeholderTextColor={customerTheme.colors.textMuted}
          style={styles.searchInput}
          value={search}
        />
        {search ? <Pressable onPress={() => setSearch("")}><Text style={styles.clearText}>×</Text></Pressable> : null}
      </View>
      {stores === null ? (
        <Centered>{error ? <ErrorState message={error} onRetry={load} /> : <ActivityIndicator color={customerTheme.colors.primary} size="large" />}</Centered>
      ) : visibleStores?.length === 0 ? (
        <Centered><Text style={styles.emptyText}>{t("supermarket.noMatch")}</Text></Centered>
      ) : (
        <FlatList
          contentContainerStyle={styles.storeList}
          data={visibleStores}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl onRefresh={refresh} refreshing={refreshing} tintColor={customerTheme.colors.primary} />}
          renderItem={({ item }) => (
            <Pressable onPress={() => props.onOpenSupermarket(item)} style={({ pressed }) => [styles.storeCard, pressed && styles.pressed]}>
              <View style={styles.storeArtwork}>
                {item.logoUrl ? <Image resizeMode="cover" source={{ uri: item.logoUrl }} style={styles.image} /> : <Text style={styles.storeEmoji}>🛒</Text>}
              </View>
              <View style={styles.storeCopy}>
                <Text style={styles.storeName}>{item.name}</Text>
                {item.description ? <Text numberOfLines={2} style={styles.muted}>{item.description}</Text> : null}
                <Text numberOfLines={1} style={styles.address}>⌖ {item.addressLine}</Text>
                <Text style={styles.open}>{t("home.openNowCash")}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

export function SupermarketCatalogScreen(props: {
  supermarketId: string;
  supermarketName: string;
  cart: Cart | null;
  onBack: () => void;
  onAddItem: (item: SupermarketProduct) => void;
  onOpenProduct: (productId: string) => void;
  onViewCart: () => void;
}) {
  const { t } = useTranslation(["customer", "common"]);
  const [catalog, setCatalog] = useState<SupermarketCatalog | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState<string | undefined>();
  const [featured, setFeatured] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setError(null);
    getSupermarketCatalog(props.supermarketId, { pageSize: 50, search: search || undefined, categoryId: departmentId, featured: featured || undefined })
      .then((result) => mounted && setCatalog(result))
      .catch((requestError) => mounted && setError(readError(requestError)));
    return () => { mounted = false; };
  }, [props.supermarketId, search, departmentId, featured]);

  const showCart = props.cart !== null && cartBelongsToRestaurant(props.cart, props.supermarketId);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.secondary} barStyle="light-content" />
      <View style={styles.catalogHeader}>
        <BackButton onPress={props.onBack} />
        <View style={styles.headerCopy}>
          <Text style={styles.headerEyebrow}>{t("supermarket.supermarketLabel")}</Text>
          <Text numberOfLines={1} style={styles.catalogTitle}>{catalog?.supermarket.name ?? props.supermarketName}</Text>
        </View>
      </View>
      <View style={styles.catalogSearchRow}>
        <TextInput
          onChangeText={setSearchInput}
          onSubmitEditing={() => setSearch(searchInput.trim())}
          placeholder={t("supermarket.searchProductsPlaceholder")}
          placeholderTextColor={customerTheme.colors.textMuted}
          returnKeyType="search"
          style={[styles.searchInput, styles.catalogSearchInput]}
          value={searchInput}
        />
        <Pressable onPress={() => setSearch(searchInput.trim())} style={styles.searchButton}><Text style={styles.searchButtonText}>{t("common:search")}</Text></Pressable>
      </View>
      {catalog ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.departmentStrip} contentContainerStyle={styles.departmentContent}>
          <Chip active={!departmentId} label={t("supermarket.allChip")} onPress={() => setDepartmentId(undefined)} />
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
      {error ? <Centered><ErrorState message={error} /></Centered> : catalog === null ? (
        <Centered><ActivityIndicator color={customerTheme.colors.primary} size="large" /></Centered>
      ) : catalog.products.length === 0 ? (
        <Centered><Text style={styles.emptyText}>{t("supermarket.noProductsFound")}</Text></Centered>
      ) : (
        <FlatList
          contentContainerStyle={[styles.productGrid, showCart && styles.productGridWithCart]}
          data={catalog.products}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.productRow}
          renderItem={({ item }) => (
            <ProductCard item={item} onAdd={() => props.onAddItem(item)} onOpen={() => props.onOpenProduct(item.id)} />
          )}
        />
      )}
      {showCart ? <CartDock cart={props.cart!} onPress={props.onViewCart} /> : null}
    </SafeAreaView>
  );
}

export function SupermarketProductScreen(props: {
  supermarketId: string;
  productId: string;
  cart: Cart | null;
  onBack: () => void;
  onAddItem: (item: SupermarketProduct & { allowSubstitution?: boolean }) => void;
  onViewCart: () => void;
}) {
  const { t } = useTranslation(["customer"]);
  const [product, setProduct] = useState<SupermarketProduct | null>(null);
  const [allowSubstitution, setAllowSubstitution] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    getSupermarketProduct(props.supermarketId, props.productId)
      .then((result) => mounted && setProduct(result))
      .catch((requestError) => mounted && setError(readError(requestError)));
    return () => { mounted = false; };
  }, [props.supermarketId, props.productId]);

  const showCart = props.cart !== null && cartBelongsToRestaurant(props.cart, props.supermarketId);
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.secondary} barStyle="light-content" />
      <View style={styles.productDetailHeader}><BackButton onPress={props.onBack} /><Text style={styles.productDetailHeaderTitle}>{t("supermarket.productDetailsTitle")}</Text></View>
      {error ? <Centered><ErrorState message={error} /></Centered> : product === null ? (
        <Centered><ActivityIndicator color={customerTheme.colors.primary} size="large" /></Centered>
      ) : (
        <ScrollView contentContainerStyle={[styles.detailContent, showCart && styles.productGridWithCart]}>
          <View style={styles.detailArtwork}>{product.imageUrl ? <Image resizeMode="contain" source={{ uri: product.imageUrl }} style={styles.image} /> : <Text style={styles.detailEmoji}>🛍️</Text>}</View>
          <Text style={styles.detailDepartment}>{product.categoryName}</Text>
          <Text style={styles.detailName}>{product.name}</Text>
          {product.brand ? <Text style={styles.detailBrand}>{product.brand}</Text> : null}
          <Text style={styles.detailUnit}>
            {product.sku
              ? t("supermarket.soldByLabelWithSku", { unit: product.unitLabel, sku: product.sku })
              : t("supermarket.soldByLabel", { unit: product.unitLabel })}
          </Text>
          {product.description ? <Text style={styles.detailDescription}>{product.description}</Text> : null}
          {product.offer ? (
            <Text style={styles.offerBadge}>{t("supermarket.offerLabel", { title: product.offer.title, percent: product.offer.discountPercent })}</Text>
          ) : null}
          <View style={styles.detailPriceRow}>
            {product.offer ? <Text style={styles.oldPrice}>{formatPrice(product.priceMinor)}</Text> : null}
            <Text style={styles.detailPrice}>{formatPrice(product.effectivePriceMinor)}</Text>
          </View>
          <Text style={styles.stockText}>
            {product.stockQuantity === null ? t("supermarket.availableStock") : t("supermarket.inStock", { count: product.stockQuantity })}
          </Text>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: allowSubstitution }}
            onPress={() => setAllowSubstitution((current) => !current)}
            style={[styles.substitutionCard, allowSubstitution && styles.substitutionCardActive]}
          >
            <Text style={styles.substitutionTitle}>
              {allowSubstitution ? t("supermarket.allowSubstitution") : t("supermarket.doNotReplace")}
            </Text>
            <Text style={styles.muted}>{t("supermarket.substitutionHelper")}</Text>
          </Pressable>
          <Pressable onPress={() => props.onAddItem({ ...product, allowSubstitution })} style={styles.addDetailButton}>
            <Text style={styles.addDetailText}>{t("supermarket.addToBasket", { price: formatPrice(product.effectivePriceMinor) })}</Text>
          </Pressable>
        </ScrollView>
      )}
      {showCart ? <CartDock cart={props.cart!} onPress={props.onViewCart} /> : null}
    </SafeAreaView>
  );
}

function ProductCard(props: { item: SupermarketProduct; onAdd: () => void; onOpen: () => void }) {
  const { t } = useTranslation(["customer"]);
  return (
    <Pressable onPress={props.onOpen} style={({ pressed }) => [styles.productCard, pressed && styles.pressed]}>
      <View style={styles.productArtwork}>{props.item.imageUrl ? <Image resizeMode="cover" source={{ uri: props.item.imageUrl }} style={styles.image} /> : <Text style={styles.productEmoji}>🥫</Text>}</View>
      <Text style={styles.productDepartment}>{props.item.categoryName}</Text>
      {props.item.brand ? <Text numberOfLines={1} style={styles.productBrand}>{props.item.brand}</Text> : null}
      <Text numberOfLines={2} style={styles.productName}>{props.item.name}</Text>
      <Text style={styles.productUnit}>{props.item.unitLabel}</Text>
      {props.item.offer ? (
        <Text style={styles.offerBadge}>{t("supermarket.offerPercentOnly", { percent: props.item.offer.discountPercent })}</Text>
      ) : null}
      <View style={styles.cardPriceRow}>
        <Text style={styles.productPrice}>{formatPrice(props.item.effectivePriceMinor)}</Text>
        <Pressable
          accessibilityLabel={t("supermarket.addProductAccessibility", { name: props.item.name })}
          onPress={(event) => { event.stopPropagation(); props.onAdd(); }}
          style={styles.addButton}
        >
          <Text style={styles.addButtonText}>+</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

function Chip(props: { active: boolean; label: string; onPress: () => void }) {
  return <Pressable onPress={props.onPress} style={[styles.chip, props.active && styles.chipActive]}><Text style={[styles.chipText, props.active && styles.chipTextActive]}>{props.label}</Text></Pressable>;
}

function CartDock(props: { cart: Cart; onPress: () => void }) {
  const { t } = useTranslation(["customer"]);
  return (
    <View style={styles.cartDock}>
      <Pressable onPress={props.onPress} style={styles.cartButton}>
        <Text style={styles.cartCount}>{cartItemCount(props.cart)}</Text>
        <Text style={styles.cartLabel}>{t("restaurants.viewBasket")}</Text>
        <Text style={styles.cartPrice}>{formatPrice(cartSubtotalMinor(props.cart))}</Text>
      </Pressable>
    </View>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation(["customer"]);
  return <Pressable accessibilityLabel={t("supermarket.goBackAccessibility")} onPress={onPress} style={styles.backButton}><Text style={styles.backText}>‹</Text></Pressable>;
}

function Centered({ children }: { children: React.ReactNode }) { return <View style={styles.centered}>{children}</View>; }
function ErrorState(props: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation(["customer"]);
  return (
    <View style={styles.errorState}>
      <Text style={styles.errorText}>{props.message}</Text>
      {props.onRetry ? <Pressable onPress={props.onRetry} style={styles.retryButton}><Text style={styles.retryText}>{t("restaurants.tryAgain")}</Text></Pressable> : null}
    </View>
  );
}
function formatPrice(value: number) { return `${(value / 100).toFixed(2)} ILS`; }
function readError(error: unknown) { return error instanceof ApiError || error instanceof Error ? error.message : i18n.t("common:requestFailed"); }

const styles = StyleSheet.create({
  screen: { backgroundColor: customerTheme.colors.background, flex: 1 },
  storeHeader: { alignItems: "center", backgroundColor: customerTheme.colors.secondary, flexDirection: "row", padding: 20 },
  catalogHeader: { alignItems: "center", backgroundColor: customerTheme.colors.secondary, flexDirection: "row", minHeight: 86, padding: 16 },
  headerCopy: { flex: 1, marginStart: 14 },
  headerEyebrow: { color: "#B8D8CD", fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  headerTitle: { color: "#FFFFFF", fontSize: 28, fontWeight: "900", marginTop: 4 },
  catalogTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", marginTop: 3 },
  headerSubtitle: { color: "#D9E9E3", fontSize: 12, marginTop: 5 },
  backButton: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.16)", borderRadius: 14, height: 44, justifyContent: "center", width: 44 },
  backText: { color: "#FFFFFF", fontSize: 30, marginTop: -4 },
  searchBox: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: 16, borderWidth: 1, flexDirection: "row", margin: 18, minHeight: 54, paddingHorizontal: 15 },
  searchInput: { color: customerTheme.colors.text, flex: 1, fontSize: 14, outlineStyle: "none" } as never,
  clearText: { color: customerTheme.colors.textMuted, fontSize: 24, padding: 5 },
  centered: { alignItems: "center", flex: 1, justifyContent: "center", padding: 28 },
  emptyText: { color: customerTheme.colors.textMuted, textAlign: "center" },
  storeList: { alignSelf: "center", maxWidth: 900, padding: 18, width: "100%" },
  storeCard: { backgroundColor: customerTheme.colors.surface, borderRadius: 22, marginBottom: 16, overflow: "hidden", ...customerTheme.shadow },
  storeArtwork: { alignItems: "center", backgroundColor: "#DDEFE4", height: 145, justifyContent: "center" },
  image: { height: "100%", width: "100%" },
  storeEmoji: { fontSize: 65 },
  storeCopy: { padding: 16 },
  storeName: { color: customerTheme.colors.text, fontSize: 19, fontWeight: "900" },
  muted: { color: customerTheme.colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  address: { color: customerTheme.colors.textMuted, fontSize: 11, marginTop: 9 },
  open: { color: customerTheme.colors.success, fontSize: 11, fontWeight: "800", marginTop: 9 },
  catalogSearchRow: { flexDirection: "row", gap: 8, padding: 12 },
  catalogSearchInput: { backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: 14, borderWidth: 1, minHeight: 48, paddingHorizontal: 13 },
  searchButton: { alignItems: "center", backgroundColor: customerTheme.colors.primary, borderRadius: 14, justifyContent: "center", paddingHorizontal: 15 },
  searchButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  departmentStrip: { flexGrow: 0, maxHeight: 54 },
  departmentContent: { paddingHorizontal: 12, paddingBottom: 8 },
  chip: { backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: 999, borderWidth: 1, marginEnd: 8, paddingHorizontal: 14, paddingVertical: 9 },
  chipActive: { backgroundColor: customerTheme.colors.secondary, borderColor: customerTheme.colors.secondary },
  chipText: { color: customerTheme.colors.textMuted, fontSize: 11, fontWeight: "800" },
  chipTextActive: { color: "#FFFFFF" },
  productGrid: { alignSelf: "center", maxWidth: 900, padding: 12, width: "100%" },
  productGridWithCart: { paddingBottom: 105 },
  productRow: { gap: 10 },
  productCard: { backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: 18, borderWidth: 1, flex: 1, marginBottom: 10, maxWidth: "50%", overflow: "hidden", padding: 10 },
  productArtwork: { alignItems: "center", backgroundColor: customerTheme.colors.surfaceMuted, borderRadius: 13, height: 115, justifyContent: "center", overflow: "hidden" },
  productEmoji: { fontSize: 45 },
  productDepartment: { color: customerTheme.colors.primary, fontSize: 9, fontWeight: "900", marginTop: 10, textTransform: "uppercase" },
  productBrand: { color: customerTheme.colors.textMuted, fontSize: 10, marginTop: 3 },
  productName: { color: customerTheme.colors.text, fontSize: 14, fontWeight: "900", lineHeight: 18, marginTop: 3, minHeight: 36 },
  productUnit: { color: customerTheme.colors.textMuted, fontSize: 10, marginTop: 4 },
  offerBadge: { alignSelf: "flex-start", backgroundColor: "#DCFCE7", borderRadius: 999, color: "#166534", fontSize: 10, fontWeight: "900", marginTop: 7, paddingHorizontal: 8, paddingVertical: 4 },
  cardPriceRow: { alignItems: "center", flexDirection: "row", marginTop: 9 },
  productPrice: { color: customerTheme.colors.secondary, flex: 1, fontSize: 13, fontWeight: "900" },
  addButton: { alignItems: "center", backgroundColor: customerTheme.colors.primary, borderRadius: 12, height: 34, justifyContent: "center", width: 34 },
  addButtonText: { color: "#FFFFFF", fontSize: 21, fontWeight: "900" },
  cartDock: { backgroundColor: "rgba(255,249,245,0.97)", bottom: 0, start: 0, padding: 13, position: "absolute", end: 0 },
  cartButton: { alignItems: "center", alignSelf: "center", backgroundColor: customerTheme.colors.primary, borderRadius: 16, flexDirection: "row", maxWidth: 870, minHeight: 56, paddingHorizontal: 14, width: "100%" },
  cartCount: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  cartLabel: { color: "#FFFFFF", flex: 1, fontSize: 14, fontWeight: "900", marginStart: 14 },
  cartPrice: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  productDetailHeader: { alignItems: "center", backgroundColor: customerTheme.colors.secondary, flexDirection: "row", padding: 16 },
  productDetailHeaderTitle: { color: "#FFFFFF", flex: 1, fontSize: 18, fontWeight: "900", marginStart: 14 },
  detailContent: { alignSelf: "center", maxWidth: 720, padding: 20, width: "100%" },
  detailArtwork: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderRadius: 24, height: 270, justifyContent: "center", overflow: "hidden" },
  detailEmoji: { fontSize: 100 },
  detailDepartment: { color: customerTheme.colors.primary, fontSize: 11, fontWeight: "900", marginTop: 20, textTransform: "uppercase" },
  detailName: { color: customerTheme.colors.text, fontSize: 27, fontWeight: "900", marginTop: 6 },
  detailBrand: { color: customerTheme.colors.secondary, fontSize: 14, fontWeight: "800", marginTop: 6 },
  detailUnit: { color: customerTheme.colors.textMuted, fontSize: 12, marginTop: 7 },
  detailDescription: { color: customerTheme.colors.textMuted, fontSize: 14, lineHeight: 21, marginTop: 16 },
  detailPriceRow: { alignItems: "center", flexDirection: "row", gap: 10, marginTop: 18 },
  oldPrice: { color: customerTheme.colors.textMuted, fontSize: 14, textDecorationLine: "line-through" },
  detailPrice: { color: customerTheme.colors.secondary, fontSize: 24, fontWeight: "900" },
  stockText: { color: customerTheme.colors.success, fontSize: 12, fontWeight: "800", marginTop: 8 },
  substitutionCard: { backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: 16, borderWidth: 1, marginTop: 22, padding: 15 },
  substitutionCardActive: { borderColor: customerTheme.colors.success, borderWidth: 2 },
  substitutionTitle: { color: customerTheme.colors.text, fontSize: 13, fontWeight: "900" },
  addDetailButton: { alignItems: "center", backgroundColor: customerTheme.colors.primary, borderRadius: 16, marginTop: 18, minHeight: 56, justifyContent: "center" },
  addDetailText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  errorState: { alignItems: "center" },
  errorText: { color: customerTheme.colors.danger, fontSize: 13, textAlign: "center" },
  retryButton: { backgroundColor: customerTheme.colors.primary, borderRadius: 12, marginTop: 13, paddingHorizontal: 18, paddingVertical: 10 },
  retryText: { color: "#FFFFFF", fontWeight: "800" },
  pressed: { opacity: 0.75 }
});
