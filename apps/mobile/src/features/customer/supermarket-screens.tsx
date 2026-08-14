import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
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
  type SupermarketCatalog,
  type SupermarketProduct
} from "../../core/api";
import { cartBelongsToRestaurant, cartItemCount, cartSubtotalMinor, type Cart } from "./cart";
import i18n from "../../i18n";
import { colors, iconSize, isRTL, radius, spacing, withAlpha } from "../../theme/tokens";
import { text } from "../../theme/typography";
import { customerTheme } from "./theme";

/**
 * JOVO MARKET is the only supermarket partner at launch, so the customer lands
 * on this catalogue directly — there is no store-selection screen in front of
 * it any more. `initialDepartmentId` / `initialSearch` let the home screen open
 * this already filtered, which is what makes a department tile on home a
 * single hop into the aisle rather than a hop into a picker.
 */
export function SupermarketCatalogScreen(props: {
  supermarketId: string;
  supermarketName: string;
  cart: Cart | null;
  initialDepartmentId?: string;
  initialSearch?: string;
  onBack: () => void;
  onAddItem: (item: SupermarketProduct) => void;
  onOpenProduct: (productId: string) => void;
  onViewCart: () => void;
}) {
  const { t } = useTranslation(["customer", "common"]);
  const [catalog, setCatalog] = useState<SupermarketCatalog | null>(null);
  const [searchInput, setSearchInput] = useState(props.initialSearch ?? "");
  const [search, setSearch] = useState(props.initialSearch ?? "");
  const [departmentId, setDepartmentId] = useState<string | undefined>(props.initialDepartmentId);
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
  return <Pressable accessibilityLabel={t("supermarket.goBackAccessibility")} onPress={onPress} style={styles.backButton}><Text style={styles.backText}>{isRTL() ? "›" : "‹"}</Text></Pressable>;
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
  catalogHeader: { alignItems: "center", backgroundColor: customerTheme.colors.secondary, flexDirection: "row", minHeight: 86, padding: spacing[4] },
  headerCopy: { flex: 1, marginStart: spacing[4] },
  headerEyebrow: { ...text("label", "bold"), color: customerTheme.colors.primary },
  catalogTitle: { ...text("h2", "bold"), color: colors.textInverse, marginTop: spacing[1] },
  backButton: { alignItems: "center", backgroundColor: withAlpha(colors.textInverse, 0.16), borderRadius: radius.lg, height: 44, justifyContent: "center", width: 44 },
  backText: { color: colors.textInverse, fontSize: iconSize.xl, marginTop: -4 },
  searchInput: { ...text("bodySm"), color: customerTheme.colors.text, flex: 1, outlineStyle: "none" } as never,
  centered: { alignItems: "center", flex: 1, justifyContent: "center", padding: spacing[7] },
  emptyText: { ...text("bodySm"), color: customerTheme.colors.textMuted, textAlign: "center" },
  image: { height: "100%", width: "100%" },
  muted: { ...text("caption"), color: customerTheme.colors.textMuted, marginTop: spacing[1] },
  catalogSearchRow: { flexDirection: "row", gap: spacing[2], padding: spacing[3] },
  catalogSearchInput: { backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: radius.lg, borderWidth: 1, minHeight: 48, paddingHorizontal: spacing[3] },
  searchButton: { alignItems: "center", backgroundColor: customerTheme.colors.primary, borderRadius: radius.lg, justifyContent: "center", paddingHorizontal: spacing[4] },
  searchButtonText: { ...text("caption", "bold"), color: colors.textInverse },
  departmentStrip: { flexGrow: 0, maxHeight: 54 },
  departmentContent: { paddingHorizontal: spacing[3], paddingBottom: spacing[2] },
  chip: { backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: radius.pill, borderWidth: 1, marginEnd: spacing[2], paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  chipActive: { backgroundColor: customerTheme.colors.secondary, borderColor: customerTheme.colors.secondary },
  chipText: { ...text("label", "bold"), color: customerTheme.colors.textMuted },
  chipTextActive: { color: colors.textInverse },
  productGrid: { alignSelf: "center", maxWidth: 900, padding: spacing[3], width: "100%" },
  productGridWithCart: { paddingBottom: 105 },
  productRow: { gap: spacing[2] },
  productCard: { backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: radius.lg, borderWidth: 1, flex: 1, marginBottom: spacing[2], maxWidth: "50%", overflow: "hidden", padding: spacing[2] },
  productArtwork: { alignItems: "center", backgroundColor: customerTheme.colors.surfaceMuted, borderRadius: radius.md, height: 115, justifyContent: "center", overflow: "hidden" },
  productEmoji: { fontSize: iconSize.xxl },
  productDepartment: { ...text("label", "bold"), color: customerTheme.colors.primary, marginTop: spacing[2] },
  productBrand: { ...text("label"), color: customerTheme.colors.textMuted, marginTop: spacing[1] },
  productName: { ...text("bodySm", "bold"), color: customerTheme.colors.text, marginTop: spacing[1], minHeight: 36 },
  productUnit: { ...text("label"), color: customerTheme.colors.textMuted, marginTop: spacing[1] },
  offerBadge: { alignSelf: "flex-start", ...text("label", "bold"), backgroundColor: colors.successSubtle, borderRadius: radius.pill, color: colors.success, marginTop: spacing[2], paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
  cardPriceRow: { alignItems: "center", flexDirection: "row", marginTop: spacing[2] },
  productPrice: { ...text("caption", "bold"), color: customerTheme.colors.secondary, flex: 1 },
  addButton: { alignItems: "center", backgroundColor: customerTheme.colors.primary, borderRadius: radius.md, height: 34, justifyContent: "center", width: 34 },
  addButtonText: { color: colors.textInverse, fontSize: iconSize.sm, fontWeight: "900" },
  cartDock: { backgroundColor: withAlpha(customerTheme.colors.background, 0.97), bottom: 0, start: 0, padding: spacing[3], position: "absolute", end: 0 },
  cartButton: { alignItems: "center", alignSelf: "center", backgroundColor: customerTheme.colors.primary, borderRadius: radius.lg, flexDirection: "row", maxWidth: 870, minHeight: 56, paddingHorizontal: spacing[4], width: "100%" },
  cartCount: { ...text("caption", "bold"), color: colors.textInverse },
  cartLabel: { ...text("bodySm", "bold"), color: colors.textInverse, flex: 1, marginStart: spacing[4] },
  cartPrice: { ...text("caption", "bold"), color: colors.textInverse },
  productDetailHeader: { alignItems: "center", backgroundColor: customerTheme.colors.secondary, flexDirection: "row", padding: spacing[4] },
  productDetailHeaderTitle: { ...text("h3", "bold"), color: colors.textInverse, flex: 1, marginStart: spacing[4] },
  detailContent: { alignSelf: "center", maxWidth: 720, padding: spacing[5], width: "100%" },
  detailArtwork: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderRadius: radius.lg, height: 270, justifyContent: "center", overflow: "hidden" },
  detailEmoji: { fontSize: iconSize.xxxl + 40 },
  detailDepartment: { ...text("label", "bold"), color: customerTheme.colors.primary, marginTop: spacing[5] },
  detailName: { ...text("display", "bold"), color: customerTheme.colors.text, marginTop: spacing[2] },
  detailBrand: { ...text("body", "bold"), color: customerTheme.colors.secondary, marginTop: spacing[2] },
  detailUnit: { ...text("caption"), color: customerTheme.colors.textMuted, marginTop: spacing[2] },
  detailDescription: { ...text("body"), color: customerTheme.colors.textMuted, marginTop: spacing[4] },
  detailPriceRow: { alignItems: "center", flexDirection: "row", gap: spacing[3], marginTop: spacing[5] },
  oldPrice: { ...text("body"), color: customerTheme.colors.textMuted, textDecorationLine: "line-through" },
  detailPrice: { ...text("h1", "bold"), color: customerTheme.colors.secondary },
  stockText: { ...text("caption", "bold"), color: customerTheme.colors.success, marginTop: spacing[2] },
  substitutionCard: { backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: radius.lg, borderWidth: 1, marginTop: spacing[6], padding: spacing[4] },
  substitutionCardActive: { borderColor: customerTheme.colors.success, borderWidth: 2 },
  substitutionTitle: { ...text("caption", "bold"), color: customerTheme.colors.text },
  addDetailButton: { alignItems: "center", backgroundColor: customerTheme.colors.primary, borderRadius: radius.lg, marginTop: spacing[5], minHeight: 56, justifyContent: "center" },
  addDetailText: { ...text("body", "bold"), color: colors.textInverse },
  errorState: { alignItems: "center" },
  errorText: { ...text("caption"), color: customerTheme.colors.danger, textAlign: "center" },
  retryButton: { backgroundColor: customerTheme.colors.primary, borderRadius: radius.md, marginTop: spacing[3], paddingHorizontal: spacing[5], paddingVertical: spacing[2] },
  retryText: { ...text("bodySm", "bold"), color: colors.textInverse },
  pressed: { opacity: 0.75 }
});
