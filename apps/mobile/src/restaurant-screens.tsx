import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ApiError,
  getRestaurantMenu,
  listRestaurants,
  type MenuCategorySummary,
  type MenuItemSummary,
  type RestaurantMenu,
  type RestaurantSummary
} from "./api";
import { cartBelongsToRestaurant, cartItemCount, cartSubtotalMinor, type Cart } from "./cart";

const currencyCode = "ILS";

type RestaurantListScreenProps = {
  onBack: () => void;
  onOpenRestaurant: (restaurant: RestaurantSummary) => void;
};

export function RestaurantListScreen(props: RestaurantListScreenProps) {
  const [restaurants, setRestaurants] = useState<RestaurantSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setError(null);
    try {
      const page = await listRestaurants(1, 20);
      setRestaurants(page.items);
    } catch (requestError) {
      setError(readError(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor="#F5FAFC" barStyle="dark-content" />
      <Header onBack={props.onBack} subtitle="Open restaurants near you" title="Restaurants" />
      {restaurants === null ? (
        <View style={styles.centered}>
          {error ? <ErrorState message={error} onRetry={load} /> : <ActivityIndicator color="#0F766E" size="large" />}
        </View>
      ) : restaurants.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No restaurants are open right now. Check back soon.</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={restaurants}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl onRefresh={refresh} refreshing={refreshing} tintColor="#0F766E" />}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => props.onOpenRestaurant(item)}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            >
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.cardSubtitle}>{item.addressLine}</Text>
              {item.description ? <Text style={styles.cardDescription}>{item.description}</Text> : null}
              <View style={styles.openBadge}>
                <Text style={styles.openBadgeText}>Open now</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
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
    let isMounted = true;
    setMenu(null);
    setError(null);
    getRestaurantMenu(props.restaurantId)
      .then((result) => {
        if (isMounted) setMenu(result);
      })
      .catch((requestError) => {
        if (isMounted) setError(readError(requestError));
      });
    return () => {
      isMounted = false;
    };
  }, [props.restaurantId]);

  const showCartBar = props.cart !== null && cartBelongsToRestaurant(props.cart, props.restaurantId);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor="#F5FAFC" barStyle="dark-content" />
      <Header
        onBack={props.onBack}
        subtitle={menu?.restaurant.addressLine ?? "Menu"}
        title={menu?.restaurant.name ?? props.restaurantName}
      />
      {error ? (
        <View style={styles.centered}>
          <ErrorState message={error} />
        </View>
      ) : menu === null ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#0F766E" size="large" />
        </View>
      ) : menu.categories.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>This restaurant has not published its menu yet.</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={menu.categories}
          keyExtractor={(category) => category.id}
          renderItem={({ item }) => <MenuCategorySection category={item} onAddItem={props.onAddItem} />}
        />
      )}
      {showCartBar ? (
        <Pressable
          accessibilityRole="button"
          onPress={props.onViewCart}
          style={({ pressed }) => [styles.cartBar, pressed && styles.cartBarPressed]}
        >
          <Text style={styles.cartBarText}>
            View Cart ({cartItemCount(props.cart!)}) - {formatPrice(cartSubtotalMinor(props.cart!))}
          </Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

function MenuCategorySection(props: { category: MenuCategorySummary; onAddItem: (item: MenuItemSummary) => void }) {
  return (
    <View style={styles.categorySection}>
      <Text style={styles.categoryTitle}>{props.category.name}</Text>
      {props.category.items.map((item) => (
        <View key={item.id} style={styles.itemRow}>
          <View style={styles.itemInfo}>
            <Text style={styles.itemName}>{item.name}</Text>
            {item.description ? <Text style={styles.itemDescription}>{item.description}</Text> : null}
            <Text style={styles.itemPrice}>{formatPrice(item.priceMinor)}</Text>
          </View>
          <Pressable
            accessibilityLabel={`Add ${item.name} to cart`}
            accessibilityRole="button"
            onPress={() => props.onAddItem(item)}
            style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
          >
            <Text style={styles.addButtonText}>Add</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function Header(props: { title: string; subtitle: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" onPress={props.onBack} style={styles.backButton}>
        <Text style={styles.backButtonText}>Back</Text>
      </Pressable>
      <Text style={styles.headerTitle}>{props.title}</Text>
      <Text style={styles.headerSubtitle}>{props.subtitle}</Text>
    </View>
  );
}

function ErrorState(props: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{props.message}</Text>
      {props.onRetry ? (
        <Pressable onPress={props.onRetry} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Try Again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ${currencyCode}`;
}

function readError(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message;
  }
  return "The request could not be completed. Please try again.";
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#F5FAFC", flex: 1 },
  header: {
    backgroundColor: "#FFFFFF",
    borderBottomColor: "#D9E2EC",
    borderBottomWidth: 1,
    padding: 20,
    paddingTop: 12
  },
  backButton: { alignSelf: "flex-start", marginBottom: 10, paddingVertical: 4 },
  backButtonText: { color: "#0369A1", fontSize: 14, fontWeight: "700" },
  headerTitle: { color: "#0F172A", fontSize: 24, fontWeight: "800" },
  headerSubtitle: { color: "#64748B", fontSize: 14, marginTop: 4 },
  centered: { alignItems: "center", flex: 1, justifyContent: "center", padding: 24 },
  emptyText: { color: "#64748B", fontSize: 15, textAlign: "center" },
  listContent: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D9E2EC",
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    padding: 16
  },
  cardPressed: { backgroundColor: "#F0FDFA", borderColor: "#0F766E" },
  cardTitle: { color: "#0F172A", fontSize: 17, fontWeight: "800" },
  cardSubtitle: { color: "#64748B", fontSize: 13, marginTop: 4 },
  cardDescription: { color: "#475569", fontSize: 13, marginTop: 8 },
  openBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#DCFCE7",
    borderRadius: 8,
    marginTop: 10,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  openBadgeText: { color: "#166534", fontSize: 11, fontWeight: "800" },
  categorySection: { marginBottom: 22 },
  categoryTitle: { color: "#0F172A", fontSize: 17, fontWeight: "800", marginBottom: 10, marginTop: 6 },
  itemRow: {
    alignItems: "flex-start",
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
    padding: 14
  },
  itemInfo: { flex: 1, paddingRight: 12 },
  itemName: { color: "#0F172A", fontSize: 15, fontWeight: "700" },
  itemDescription: { color: "#64748B", fontSize: 13, marginTop: 4 },
  itemPrice: { color: "#0F766E", fontSize: 15, fontWeight: "800", marginTop: 6 },
  addButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#0F766E",
    borderRadius: 10,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  addButtonPressed: { opacity: 0.85 },
  addButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  cartBar: {
    backgroundColor: "#0F766E",
    bottom: 0,
    left: 0,
    padding: 16,
    position: "absolute",
    right: 0
  },
  cartBarPressed: { opacity: 0.9 },
  cartBarText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800", textAlign: "center" },
  errorBox: { alignItems: "center" },
  errorText: { color: "#B91C1C", fontSize: 14, lineHeight: 20, textAlign: "center" },
  retryButton: {
    borderColor: "#0F766E",
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10
  },
  retryButtonText: { color: "#0F766E", fontSize: 14, fontWeight: "800" }
});
