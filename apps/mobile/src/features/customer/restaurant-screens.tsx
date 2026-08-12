import { useEffect, useMemo, useState } from "react";
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
  getRestaurantMenu,
  listRestaurants,
  type MenuCategorySummary,
  type MenuItemSummary,
  type RestaurantMenu,
  type RestaurantSummary
} from "../../core/api";
import { cartBelongsToRestaurant, cartItemCount, cartSubtotalMinor, type Cart } from "./cart";
import i18n from "../../i18n";
import { colors, iconSize, radius, spacing, withAlpha } from "../../theme/tokens";
import { text } from "../../theme/typography";
import { customerTheme } from "./theme";

type RestaurantListScreenProps = {
  onBack: () => void;
  onOpenRestaurant: (restaurant: RestaurantSummary) => void;
};

export function RestaurantListScreen(props: RestaurantListScreenProps) {
  const { t } = useTranslation(["customer"]);
  const [restaurants, setRestaurants] = useState<RestaurantSummary[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setError(null);
    try {
      setRestaurants((await listRestaurants(1, 30)).items);
    } catch (requestError) {
      setError(readError(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query || !restaurants) return restaurants;
    return restaurants.filter((restaurant) =>
      [restaurant.name, restaurant.description, restaurant.addressLine].some((value) => value?.toLowerCase().includes(query))
    );
  }, [restaurants, search]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.background} barStyle="dark-content" />
      <View style={styles.pageWidth}>
        <View style={styles.topHeader}>
          <CircleButton label="‹" onPress={props.onBack} />
          <View style={styles.topHeaderText}>
            <Text style={styles.headerEyebrow}>JOVO</Text>
            <Text style={styles.headerLocation}>{t("restaurants.availableRestaurants")}</Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>
        <Text style={styles.pageTitle}>{t("restaurants.findFavoriteFood")}</Text>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            onChangeText={setSearch}
            placeholder={t("restaurants.searchPlaceholder")}
            placeholderTextColor={customerTheme.colors.textMuted}
            style={styles.searchInput}
            value={search}
          />
          {search ? <Pressable onPress={() => setSearch("")}><Text style={styles.clearSearch}>×</Text></Pressable> : null}
        </View>
      </View>

      {restaurants === null ? (
        <Centered>{error ? <ErrorState message={error} onRetry={load} /> : <ActivityIndicator color={customerTheme.colors.primary} size="large" />}</Centered>
      ) : filtered?.length === 0 ? (
        <Centered><Text style={styles.emptyText}>{t("restaurants.noMatch")}</Text></Centered>
      ) : (
        <FlatList
          contentContainerStyle={[styles.listContent, styles.pageWidth]}
          data={filtered}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl onRefresh={refresh} refreshing={refreshing} tintColor={customerTheme.colors.primary} />}
          renderItem={({ item, index }) => (
            <RestaurantCard index={index} onPress={() => props.onOpenRestaurant(item)} restaurant={item} />
          )}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

function RestaurantCard(props: { restaurant: RestaurantSummary; index: number; onPress: () => void }) {
  const { t } = useTranslation(["customer"]);
  return (
    <Pressable onPress={props.onPress} style={({ pressed }) => [styles.restaurantCard, pressed && styles.pressed]}>
      <View style={styles.restaurantImage}>
        {props.restaurant.logoUrl ? (
          <Image resizeMode="cover" source={{ uri: props.restaurant.logoUrl }} style={styles.fullImage} />
        ) : (
          <Text style={styles.restaurantEmoji}>{props.index % 2 ? "🍲" : "🥘"}</Text>
        )}
      </View>
      <View style={styles.restaurantBody}>
        <Text numberOfLines={1} style={styles.restaurantName}>{props.restaurant.name}</Text>
        {props.restaurant.description ? <Text numberOfLines={2} style={styles.restaurantDescription}>{props.restaurant.description}</Text> : null}
        <Text numberOfLines={1} style={styles.restaurantAddress}>{props.restaurant.addressLine}</Text>
        <View style={styles.detailsRow}>
          <Text style={styles.openText}>{t("restaurants.openNow")}</Text>
        </View>
      </View>
    </Pressable>
  );
}

type RestaurantMenuScreenProps = {
  restaurantId: string;
  restaurantName: string;
  cart: Cart | null;
  onBack: () => void;
  onAddItem: (item: MenuItemSummary) => void;
  onViewCart: () => void;
};

export function RestaurantMenuScreen(props: RestaurantMenuScreenProps) {
  const { t } = useTranslation(["customer"]);
  const [menu, setMenu] = useState<RestaurantMenu | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setMenu(null);
    setError(null);
    getRestaurantMenu(props.restaurantId)
      .then((result) => mounted && setMenu(result))
      .catch((requestError) => mounted && setError(readError(requestError)));
    return () => { mounted = false; };
  }, [props.restaurantId]);

  const showCartBar = props.cart !== null && cartBelongsToRestaurant(props.cart, props.restaurantId);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.secondary} barStyle="light-content" />
      <View style={styles.menuHero}>
        <CircleButton dark label="‹" onPress={props.onBack} />
        <View style={styles.menuHeroArt}>
          <Text style={styles.menuHeroEmoji}>🍽️</Text>
        </View>
        <View style={styles.heroHeart}><Text style={styles.heroHeartText}>♡</Text></View>
      </View>

      {error ? (
        <Centered><ErrorState message={error} /></Centered>
      ) : menu === null ? (
        <Centered><ActivityIndicator color={customerTheme.colors.primary} size="large" /></Centered>
      ) : (
        <ScrollView contentContainerStyle={[styles.menuContent, showCartBar && styles.menuContentWithCart]} showsVerticalScrollIndicator={false}>
          <View style={styles.menuInfoCard}>
            <Text style={styles.menuTitle}>{menu.restaurant.name}</Text>
            {menu.restaurant.description ? <Text style={styles.menuDescription}>{menu.restaurant.description}</Text> : null}
            <Text style={styles.menuAddress}>⌖ {menu.restaurant.addressLine}</Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryTabs}>
            {menu.categories.map((category, index) => (
              <View key={category.id} style={[styles.categoryTab, index === 0 && styles.categoryTabActive]}>
                <Text style={[styles.categoryTabText, index === 0 && styles.categoryTabTextActive]}>{category.name}</Text>
              </View>
            ))}
          </ScrollView>

          {menu.categories.length === 0 ? (
            <Text style={styles.emptyText}>{t("restaurants.menuNotPublished")}</Text>
          ) : (
            menu.categories.map((category) => (
              <MenuCategorySection category={category} key={category.id} onAddItem={props.onAddItem} />
            ))
          )}
        </ScrollView>
      )}

      {showCartBar ? (
        <View style={styles.cartDock}>
          <Pressable onPress={props.onViewCart} style={({ pressed }) => [styles.cartBar, pressed && styles.pressed]}>
            <View style={styles.cartCount}><Text style={styles.cartCountText}>{cartItemCount(props.cart!)}</Text></View>
            <Text style={styles.cartBarText}>{t("restaurants.viewBasket")}</Text>
            <Text style={styles.cartBarPrice}>{formatPrice(cartSubtotalMinor(props.cart!))}</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function MenuCategorySection(props: { category: MenuCategorySummary; onAddItem: (item: MenuItemSummary) => void }) {
  const { t } = useTranslation(["customer"]);
  return (
    <View style={styles.categorySection}>
      <Text style={styles.categoryTitle}>{props.category.name}</Text>
      <Text style={styles.categorySubtitle}>{t("restaurants.itemCount", { count: props.category.items.length })}</Text>
      {props.category.items.map((item, index) => (
        <View key={item.id} style={styles.itemCard}>
          <View style={styles.itemInfo}>
            <Text style={styles.itemName}>{item.name}</Text>
            {item.description ? <Text numberOfLines={2} style={styles.itemDescription}>{item.description}</Text> : null}
            {item.offer ? (
              <Text style={styles.itemOffer}>
                {item.offer.minimumSubtotalMinor > 0
                  ? t("restaurants.itemOfferLabelWithMinimum", {
                      title: item.offer.title,
                      percent: item.offer.discountPercent,
                      amount: formatPrice(item.offer.minimumSubtotalMinor)
                    })
                  : t("restaurants.itemOfferLabel", { title: item.offer.title, percent: item.offer.discountPercent })}
              </Text>
            ) : null}
            <View style={styles.itemPriceRow}>
              {item.offer ? <Text style={styles.itemOriginalPrice}>{formatPrice(item.priceMinor)}</Text> : null}
              <Text style={styles.itemPrice}>{formatPrice(item.effectivePriceMinor)}</Text>
            </View>
          </View>
          <View style={styles.itemVisual}>
            {item.imageUrl ? <Image resizeMode="cover" source={{ uri: item.imageUrl }} style={styles.fullImage} /> : <Text style={styles.itemEmoji}>{index % 2 ? "🥗" : "🍛"}</Text>}
            <Pressable onPress={() => props.onAddItem(item)} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
              <Text style={styles.addButtonText}>＋</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

function CircleButton(props: { label: string; onPress: () => void; dark?: boolean }) {
  return (
    <Pressable onPress={props.onPress} style={({ pressed }) => [styles.circleButton, props.dark && styles.circleButtonDark, pressed && styles.pressed]}>
      <Text style={[styles.circleButtonText, props.dark && styles.circleButtonTextDark]}>{props.label}</Text>
    </Pressable>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

function ErrorState(props: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation(["customer"]);
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorIcon}>!</Text>
      <Text style={styles.errorText}>{props.message}</Text>
      {props.onRetry ? <Pressable onPress={props.onRetry} style={styles.retryButton}><Text style={styles.retryText}>{t("restaurants.tryAgain")}</Text></Pressable> : null}
    </View>
  );
}

function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ILS`;
}

function readError(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : i18n.t("common:requestFailed");
}

const styles = StyleSheet.create({
  screen: { backgroundColor: customerTheme.colors.background, flex: 1 },
  pageWidth: { alignSelf: "center", maxWidth: 900, width: "100%" },
  topHeader: { alignItems: "center", flexDirection: "row", paddingHorizontal: spacing[5], paddingTop: spacing[2] },
  topHeaderText: { alignItems: "center", flex: 1 },
  headerSpacer: { height: 44, width: 44 },
  headerEyebrow: { ...text("label", "bold"), color: customerTheme.colors.textMuted },
  headerLocation: { ...text("caption", "bold"), color: customerTheme.colors.text, marginTop: spacing[1] },
  circleButton: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderRadius: radius.lg, height: 44, justifyContent: "center", width: 44, ...customerTheme.shadow },
  circleButtonDark: { backgroundColor: withAlpha(colors.textInverse, 0.16) },
  circleButtonText: { color: customerTheme.colors.text, fontSize: iconSize.lg, fontWeight: "500", marginTop: -3 },
  circleButtonTextDark: { color: colors.textInverse },
  pageTitle: { ...text("display", "bold"), color: customerTheme.colors.text, paddingHorizontal: spacing[5], paddingTop: spacing[6] },
  searchBox: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", marginHorizontal: spacing[5], marginTop: spacing[5], minHeight: 54, paddingHorizontal: spacing[4] },
  searchIcon: { color: customerTheme.colors.text, fontSize: iconSize.md, marginEnd: spacing[2] },
  searchInput: { ...text("bodySm"), color: customerTheme.colors.text, flex: 1, outlineStyle: "none" } as never,
  clearSearch: { color: customerTheme.colors.textMuted, fontSize: iconSize.md, paddingHorizontal: spacing[1] },
  centered: { alignItems: "center", flex: 1, justifyContent: "center", padding: spacing[7] },
  emptyText: { ...text("bodySm"), color: customerTheme.colors.textMuted, padding: spacing[7], textAlign: "center" },
  listContent: { padding: spacing[5], paddingBottom: spacing[9] },
  restaurantCard: { backgroundColor: customerTheme.colors.surface, borderRadius: radius.lg, marginBottom: spacing[5], overflow: "hidden", ...customerTheme.shadow },
  restaurantImage: { alignItems: "center", backgroundColor: colors.neutralSubtle, height: 170, justifyContent: "center", position: "relative" },
  fullImage: { height: "100%", width: "100%" },
  restaurantEmoji: { fontSize: iconSize.xxxl },
  restaurantBody: { padding: spacing[4] },
  restaurantName: { ...text("h3", "bold"), color: customerTheme.colors.text, flex: 1, marginEnd: spacing[3] },
  restaurantDescription: { ...text("caption"), color: customerTheme.colors.textMuted, marginTop: spacing[1] },
  restaurantAddress: { ...text("label"), color: customerTheme.colors.textMuted, marginTop: spacing[2] },
  detailsRow: { alignItems: "center", flexDirection: "row", marginTop: spacing[2] },
  openText: { ...text("label", "bold"), color: customerTheme.colors.success },
  menuHero: { alignItems: "flex-start", backgroundColor: customerTheme.colors.secondary, height: 205, overflow: "hidden", padding: spacing[4], position: "relative" },
  menuHeroArt: { alignItems: "center", backgroundColor: colors.primarySubtle, borderColor: colors.surface, borderRadius: 78, borderWidth: 7, height: 156, justifyContent: "center", position: "absolute", end: "27%", top: 27, transform: [{ rotate: "-6deg" }], width: 156 },
  menuHeroEmoji: { fontSize: iconSize.xxxl + 24 },
  heroHeart: { alignItems: "center", backgroundColor: withAlpha(colors.textInverse, 0.16), borderRadius: 22, height: 44, justifyContent: "center", position: "absolute", end: 18, top: 18, width: 44 },
  heroHeartText: { color: colors.textInverse, fontSize: iconSize.md },
  menuContent: { alignSelf: "center", maxWidth: 900, paddingBottom: spacing[9], width: "100%" },
  menuContentWithCart: { paddingBottom: 115 },
  menuInfoCard: { backgroundColor: customerTheme.colors.surface, borderTopLeftRadius: radius.lg * 2, borderTopRightRadius: radius.lg * 2, marginTop: -26, padding: spacing[6], paddingBottom: spacing[4] },
  menuTitle: { ...text("display", "bold"), color: customerTheme.colors.text },
  menuDescription: { ...text("bodySm"), color: customerTheme.colors.textMuted, marginTop: spacing[2] },
  menuAddress: { ...text("label"), color: customerTheme.colors.textMuted, marginTop: spacing[3] },
  categoryTabs: { flexGrow: 0, paddingHorizontal: spacing[4], paddingVertical: spacing[4] },
  categoryTab: { backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: radius.pill, borderWidth: 1, marginEnd: spacing[2], paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  categoryTabActive: { backgroundColor: customerTheme.colors.secondary, borderColor: customerTheme.colors.secondary },
  categoryTabText: { ...text("caption", "bold"), color: customerTheme.colors.textMuted },
  categoryTabTextActive: { color: colors.textInverse },
  categorySection: { paddingHorizontal: spacing[4], paddingTop: spacing[2] },
  categoryTitle: { ...text("h1", "bold"), color: customerTheme.colors.text },
  categorySubtitle: { ...text("label"), color: customerTheme.colors.textMuted, marginBottom: spacing[3], marginTop: spacing[1] },
  itemCard: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", marginBottom: spacing[3], minHeight: 135, padding: spacing[3] },
  itemInfo: { flex: 1, paddingEnd: spacing[3] },
  itemName: { ...text("h3", "bold"), color: customerTheme.colors.text },
  itemDescription: { ...text("caption"), color: customerTheme.colors.textMuted, marginTop: spacing[1] },
  itemOffer: { alignSelf: "flex-start", ...text("label", "bold"), backgroundColor: colors.successSubtle, borderRadius: radius.pill, color: colors.success, marginTop: spacing[2], paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
  itemPriceRow: { alignItems: "center", flexDirection: "row", gap: spacing[2], marginTop: spacing[2] },
  itemOriginalPrice: { ...text("caption"), color: customerTheme.colors.textMuted, textDecorationLine: "line-through" },
  itemPrice: { ...text("bodySm", "bold"), color: customerTheme.colors.secondary },
  itemVisual: { alignItems: "center", backgroundColor: customerTheme.colors.surfaceMuted, borderRadius: radius.lg, height: 105, justifyContent: "center", overflow: "visible", position: "relative", width: 105 },
  itemEmoji: { fontSize: iconSize.xxxl },
  addButton: { alignItems: "center", backgroundColor: customerTheme.colors.primary, borderColor: colors.surface, borderRadius: radius.lg, borderWidth: 3, bottom: -9, height: 38, justifyContent: "center", position: "absolute", end: -6, width: 38 },
  addButtonText: { color: colors.textInverse, fontSize: iconSize.sm, fontWeight: "800", marginTop: -2 },
  cartDock: { backgroundColor: withAlpha(customerTheme.colors.background, 0.97), bottom: 0, start: 0, padding: spacing[3], position: "absolute", end: 0 },
  cartBar: { alignItems: "center", alignSelf: "center", backgroundColor: customerTheme.colors.primary, borderRadius: radius.lg, flexDirection: "row", maxWidth: 870, minHeight: 58, paddingHorizontal: spacing[3], width: "100%", ...customerTheme.shadow },
  cartCount: { alignItems: "center", backgroundColor: withAlpha(colors.textInverse, 0.22), borderRadius: radius.md, height: 34, justifyContent: "center", width: 34 },
  cartCountText: { ...text("caption", "bold"), color: colors.textInverse },
  cartBarText: { ...text("body", "bold"), color: colors.textInverse, flex: 1, marginStart: spacing[3] },
  cartBarPrice: { ...text("caption", "bold"), color: colors.textInverse },
  pressed: { opacity: 0.72, transform: [{ scale: 0.995 }] },
  errorBox: { alignItems: "center" },
  errorIcon: { ...text("h2", "bold"), backgroundColor: customerTheme.colors.primarySoft, borderRadius: 24, color: customerTheme.colors.danger, overflow: "hidden", paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  errorText: { ...text("caption"), color: customerTheme.colors.danger, marginTop: spacing[3], textAlign: "center" },
  retryButton: { backgroundColor: customerTheme.colors.primary, borderRadius: radius.md, marginTop: spacing[4], paddingHorizontal: spacing[5], paddingVertical: spacing[2] },
  retryText: { ...text("caption", "bold"), color: colors.textInverse }
});
