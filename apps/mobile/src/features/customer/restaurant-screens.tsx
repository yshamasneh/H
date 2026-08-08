import { useEffect, useMemo, useState } from "react";
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
import { customerTheme } from "./theme";

type RestaurantListScreenProps = {
  onBack: () => void;
  onOpenRestaurant: (restaurant: RestaurantSummary) => void;
};

export function RestaurantListScreen(props: RestaurantListScreenProps) {
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
            <Text style={styles.headerEyebrow}>TASAWAQ</Text>
            <Text style={styles.headerLocation}>Available restaurants</Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>
        <Text style={styles.pageTitle}>Find your favourite food</Text>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            onChangeText={setSearch}
            placeholder="Search restaurants"
            placeholderTextColor="#9A9F9C"
            style={styles.searchInput}
            value={search}
          />
          {search ? <Pressable onPress={() => setSearch("")}><Text style={styles.clearSearch}>×</Text></Pressable> : null}
        </View>
      </View>

      {restaurants === null ? (
        <Centered>{error ? <ErrorState message={error} onRetry={load} /> : <ActivityIndicator color={customerTheme.colors.primary} size="large" />}</Centered>
      ) : filtered?.length === 0 ? (
        <Centered><Text style={styles.emptyText}>No restaurants match your search.</Text></Centered>
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
  return (
    <Pressable onPress={props.onPress} style={({ pressed }) => [styles.restaurantCard, pressed && styles.pressed]}>
      <View style={[styles.restaurantImage, props.index % 2 ? styles.artGreen : styles.artPeach]}>
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
          <Text style={styles.openText}>Open now</Text>
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
            <Text style={styles.emptyText}>This restaurant has not published its menu yet.</Text>
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
            <Text style={styles.cartBarText}>View basket</Text>
            <Text style={styles.cartBarPrice}>{formatPrice(cartSubtotalMinor(props.cart!))}</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function MenuCategorySection(props: { category: MenuCategorySummary; onAddItem: (item: MenuItemSummary) => void }) {
  return (
    <View style={styles.categorySection}>
      <Text style={styles.categoryTitle}>{props.category.name}</Text>
      <Text style={styles.categorySubtitle}>{props.category.items.length} items</Text>
      {props.category.items.map((item, index) => (
        <View key={item.id} style={styles.itemCard}>
          <View style={styles.itemInfo}>
            <Text style={styles.itemName}>{item.name}</Text>
            {item.description ? <Text numberOfLines={2} style={styles.itemDescription}>{item.description}</Text> : null}
            {item.offer ? (
              <Text style={styles.itemOffer}>
                {item.offer.title} · {item.offer.discountPercent}% off
                {item.offer.minimumSubtotalMinor > 0 ? ` over ${formatPrice(item.offer.minimumSubtotalMinor)}` : ""}
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
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorIcon}>!</Text>
      <Text style={styles.errorText}>{props.message}</Text>
      {props.onRetry ? <Pressable onPress={props.onRetry} style={styles.retryButton}><Text style={styles.retryText}>Try again</Text></Pressable> : null}
    </View>
  );
}

function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ILS`;
}

function readError(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : "The request could not be completed.";
}

const styles = StyleSheet.create({
  screen: { backgroundColor: customerTheme.colors.background, flex: 1 },
  pageWidth: { alignSelf: "center", maxWidth: 900, width: "100%" },
  topHeader: { alignItems: "center", flexDirection: "row", paddingHorizontal: 20, paddingTop: 10 },
  topHeaderText: { alignItems: "center", flex: 1 },
  headerSpacer: { height: 44, width: 44 },
  headerEyebrow: { color: customerTheme.colors.textMuted, fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  headerLocation: { color: customerTheme.colors.text, fontSize: 13, fontWeight: "800", marginTop: 3 },
  circleButton: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderRadius: 15, height: 44, justifyContent: "center", width: 44, ...customerTheme.shadow },
  circleButtonDark: { backgroundColor: "rgba(255,255,255,0.16)" },
  circleButtonText: { color: customerTheme.colors.text, fontSize: 28, fontWeight: "500", marginTop: -3 },
  circleButtonTextDark: { color: "#FFFFFF" },
  pageTitle: { color: customerTheme.colors.text, fontSize: 27, fontWeight: "900", lineHeight: 33, paddingHorizontal: 20, paddingTop: 26 },
  searchBox: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: 17, borderWidth: 1, flexDirection: "row", marginHorizontal: 20, marginTop: 18, minHeight: 54, paddingHorizontal: 14 },
  searchIcon: { color: customerTheme.colors.text, fontSize: 24, marginRight: 8 },
  searchInput: { color: customerTheme.colors.text, flex: 1, fontSize: 14, outlineStyle: "none" } as never,
  clearSearch: { color: customerTheme.colors.textMuted, fontSize: 24, paddingHorizontal: 4 },
  centered: { alignItems: "center", flex: 1, justifyContent: "center", padding: 28 },
  emptyText: { color: customerTheme.colors.textMuted, fontSize: 14, padding: 30, textAlign: "center" },
  listContent: { padding: 20, paddingBottom: 50 },
  restaurantCard: { backgroundColor: customerTheme.colors.surface, borderRadius: 22, marginBottom: 19, overflow: "hidden", ...customerTheme.shadow },
  restaurantImage: { alignItems: "center", height: 170, justifyContent: "center", position: "relative" },
  artPeach: { backgroundColor: "#FFE1CC" },
  artGreen: { backgroundColor: "#DDEFE4" },
  fullImage: { height: "100%", width: "100%" },
  restaurantEmoji: { fontSize: 78 },
  restaurantBody: { padding: 16 },
  restaurantName: { color: customerTheme.colors.text, flex: 1, fontSize: 18, fontWeight: "900", marginRight: 10 },
  restaurantDescription: { color: customerTheme.colors.textMuted, fontSize: 12, marginTop: 5 },
  restaurantAddress: { color: customerTheme.colors.textMuted, fontSize: 11, marginTop: 9 },
  detailsRow: { alignItems: "center", flexDirection: "row", marginTop: 10 },
  openText: { color: customerTheme.colors.success, fontSize: 11, fontWeight: "800" },
  menuHero: { alignItems: "flex-start", backgroundColor: customerTheme.colors.secondary, height: 205, overflow: "hidden", padding: 18, position: "relative" },
  menuHeroArt: { alignItems: "center", backgroundColor: "#FFF1E8", borderColor: "#FFFFFF", borderRadius: 78, borderWidth: 7, height: 156, justifyContent: "center", position: "absolute", right: "27%", top: 27, transform: [{ rotate: "-6deg" }], width: 156 },
  menuHeroEmoji: { fontSize: 72 },
  heroHeart: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.16)", borderRadius: 22, height: 44, justifyContent: "center", position: "absolute", right: 18, top: 18, width: 44 },
  heroHeartText: { color: "#FFFFFF", fontSize: 23 },
  menuContent: { alignSelf: "center", maxWidth: 900, paddingBottom: 50, width: "100%" },
  menuContentWithCart: { paddingBottom: 115 },
  menuInfoCard: { backgroundColor: customerTheme.colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, marginTop: -26, padding: 22, paddingBottom: 18 },
  menuTitle: { color: customerTheme.colors.text, fontSize: 25, fontWeight: "900" },
  menuDescription: { color: customerTheme.colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 7 },
  menuAddress: { color: customerTheme.colors.textMuted, fontSize: 11, marginTop: 12 },
  categoryTabs: { flexGrow: 0, paddingHorizontal: 18, paddingVertical: 16 },
  categoryTab: { backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: 999, borderWidth: 1, marginRight: 9, paddingHorizontal: 16, paddingVertical: 9 },
  categoryTabActive: { backgroundColor: customerTheme.colors.secondary, borderColor: customerTheme.colors.secondary },
  categoryTabText: { color: customerTheme.colors.textMuted, fontSize: 12, fontWeight: "800" },
  categoryTabTextActive: { color: "#FFFFFF" },
  categorySection: { paddingHorizontal: 18, paddingTop: 8 },
  categoryTitle: { color: customerTheme.colors.text, fontSize: 21, fontWeight: "900" },
  categorySubtitle: { color: customerTheme.colors.textMuted, fontSize: 11, marginBottom: 12, marginTop: 3 },
  itemCard: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", marginBottom: 12, minHeight: 135, padding: 13 },
  itemInfo: { flex: 1, paddingRight: 12 },
  itemName: { color: customerTheme.colors.text, fontSize: 16, fontWeight: "900" },
  itemDescription: { color: customerTheme.colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 5 },
  itemOffer: { alignSelf: "flex-start", backgroundColor: "#DCFCE7", borderRadius: 999, color: "#166534", fontSize: 10, fontWeight: "900", marginTop: 8, paddingHorizontal: 9, paddingVertical: 5 },
  itemPriceRow: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 10 },
  itemOriginalPrice: { color: customerTheme.colors.textMuted, fontSize: 12, textDecorationLine: "line-through" },
  itemPrice: { color: customerTheme.colors.secondary, fontSize: 14, fontWeight: "900" },
  itemVisual: { alignItems: "center", backgroundColor: customerTheme.colors.surfaceMuted, borderRadius: 15, height: 105, justifyContent: "center", overflow: "visible", position: "relative", width: 105 },
  itemEmoji: { fontSize: 48 },
  addButton: { alignItems: "center", backgroundColor: customerTheme.colors.primary, borderColor: "#FFFFFF", borderRadius: 18, borderWidth: 3, bottom: -9, height: 38, justifyContent: "center", position: "absolute", right: -6, width: 38 },
  addButtonText: { color: "#FFFFFF", fontSize: 21, fontWeight: "800", marginTop: -2 },
  cartDock: { backgroundColor: "rgba(255,249,245,0.97)", bottom: 0, left: 0, padding: 14, position: "absolute", right: 0 },
  cartBar: { alignItems: "center", alignSelf: "center", backgroundColor: customerTheme.colors.primary, borderRadius: 16, flexDirection: "row", maxWidth: 870, minHeight: 58, paddingHorizontal: 14, width: "100%", ...customerTheme.shadow },
  cartCount: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.22)", borderRadius: 10, height: 34, justifyContent: "center", width: 34 },
  cartCountText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  cartBarText: { color: "#FFFFFF", flex: 1, fontSize: 15, fontWeight: "900", marginLeft: 12 },
  cartBarPrice: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  pressed: { opacity: 0.72, transform: [{ scale: 0.995 }] },
  errorBox: { alignItems: "center" },
  errorIcon: { backgroundColor: customerTheme.colors.primarySoft, borderRadius: 24, color: customerTheme.colors.danger, fontSize: 22, fontWeight: "900", overflow: "hidden", paddingHorizontal: 17, paddingVertical: 9 },
  errorText: { color: customerTheme.colors.danger, fontSize: 13, lineHeight: 19, marginTop: 12, textAlign: "center" },
  retryButton: { backgroundColor: customerTheme.colors.primary, borderRadius: 12, marginTop: 14, paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" }
});
