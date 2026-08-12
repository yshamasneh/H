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
  listActiveRestaurantOffers,
  listRestaurants,
  listSupermarkets,
  type PublicUser,
  type RestaurantOffer,
  type RestaurantSummary
} from "../../core/api";
import { customerTheme } from "./theme";

const logo = require("../../../assets/logo/jovo-wordmark.png");

export function CustomerHomeScreen(props: {
  user: PublicUser;
  notice?: string;
  onBrowseRestaurants: () => void;
  onBrowseSupermarkets: () => void;
  onOpenRestaurant: (restaurant: Pick<RestaurantSummary, "id" | "name">) => void;
  onOpenSupermarket: (supermarket: Pick<RestaurantSummary, "id" | "name">) => void;
  onViewOrders: () => void;
  onOpenNotifications: () => void;
  onOpenAccount: () => void;
  onLogout: () => Promise<void>;
}) {
  const { t } = useTranslation(["customer", "common"]);
  const [restaurants, setRestaurants] = useState<RestaurantSummary[] | null>(null);
  const [supermarkets, setSupermarkets] = useState<RestaurantSummary[] | null>(null);
  const [offers, setOffers] = useState<RestaurantOffer[] | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    Promise.all([listActiveRestaurantOffers(), listRestaurants(1, 20), listSupermarkets(1, 6)])
      .then(([activeOffers, restaurantPage, supermarketPage]) => {
        setOffers(activeOffers);
        setRestaurants(restaurantPage.items);
        setSupermarkets(supermarketPage.items);
      })
      .catch(() => {
        setOffers([]);
        setRestaurants([]);
        setSupermarkets([]);
      });
  }, []);

  async function logout() {
    setLoggingOut(true);
    try {
      await props.onLogout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.background} barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <View>
            <Text style={styles.eyebrow}>JOVO</Text>
            <Text style={styles.location}>{t("home.localRestaurants")}</Text>
          </View>
          <Pressable onPress={props.onOpenNotifications} style={styles.iconButton}>
            <Text style={styles.iconText}>♢</Text>
            <View style={styles.notificationDot} />
          </Pressable>
        </View>

        <View style={styles.greetingRow}>
          <View style={styles.greetingText}>
            <Text style={styles.greeting}>{t("home.greeting", { name: firstName(props.user.fullName, t) })}</Text>
            <Text style={styles.greetingSubtitle}>{t("home.greetingSubtitle")}</Text>
          </View>
          <Image resizeMode="contain" source={logo} style={styles.logo} />
        </View>

        {props.notice ? <Text style={styles.notice}>{props.notice}</Text> : null}

        <Pressable onPress={props.onBrowseRestaurants} style={styles.searchBar}>
          <Text style={styles.searchIcon}>⌕</Text>
          <Text style={styles.searchText}>{t("home.searchRestaurantsPlaceholder")}</Text>
          <View style={styles.filterButton}><Text style={styles.filterText}>≡</Text></View>
        </Pressable>

        <Pressable onPress={props.onBrowseSupermarkets} style={styles.marketHero}>
          <View style={styles.marketIcon}><Text style={styles.marketEmoji}>🛒</Text></View>
          <View style={styles.marketCopy}>
            <Text style={styles.marketEyebrow}>{t("home.supermarketNewService")}</Text>
            <Text style={styles.marketTitle}>{t("home.supermarketTitle")}</Text>
            <Text style={styles.marketDescription}>{t("home.supermarketDescription")}</Text>
          </View>
          <Text style={styles.marketArrow}>›</Text>
        </Pressable>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("home.offersSectionTitle")}</Text>
        </View>
        {offers === null ? (
          <ActivityIndicator color={customerTheme.colors.primary} style={styles.loader} />
        ) : offers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t("home.noOffersTitle")}</Text>
            <Text style={styles.emptyText}>{t("home.noOffersText")}</Text>
          </View>
        ) : (
          offers.map((offer) => (
            <Pressable
              key={offer.id}
              onPress={() => {
                if (offer.restaurantId && offer.restaurantName) {
                  const target = { id: offer.restaurantId, name: offer.restaurantName };
                  offer.restaurantBusinessType === "SUPERMARKET"
                    ? props.onOpenSupermarket(target)
                    : props.onOpenRestaurant(target);
                } else {
                  props.onBrowseRestaurants();
                }
              }}
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
          <Text style={styles.sectionTitle}>{t("home.supermarketsSectionTitle")}</Text>
          <Pressable onPress={props.onBrowseSupermarkets}><Text style={styles.seeAll}>{t("home.seeAll")}</Text></Pressable>
        </View>
        {supermarkets === null ? (
          <ActivityIndicator color={customerTheme.colors.primary} style={styles.loader} />
        ) : supermarkets.length === 0 ? (
          <View style={styles.emptyCard}><Text style={styles.emptyText}>{t("home.supermarketsEmpty")}</Text></View>
        ) : (
          supermarkets.map((store) => (
            <Pressable key={store.id} onPress={() => props.onOpenSupermarket(store)} style={styles.marketStoreCard}>
              <View style={styles.marketStoreIcon}><Text style={styles.marketStoreEmoji}>🛍️</Text></View>
              <View style={styles.restaurantInfo}>
                <Text numberOfLines={1} style={styles.restaurantName}>{store.name}</Text>
                {store.description ? <Text numberOfLines={2} style={styles.restaurantMeta}>{store.description}</Text> : null}
                <Text numberOfLines={1} style={styles.restaurantAddress}>{store.addressLine}</Text>
                <Text style={styles.restaurantOpen}>{t("home.openNowCash")}</Text>
              </View>
            </Pressable>
          ))
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("home.restaurantsSectionTitle")}</Text>
          <Pressable onPress={props.onBrowseRestaurants}><Text style={styles.seeAll}>{t("home.seeAll")}</Text></Pressable>
        </View>
        {restaurants === null ? (
          <ActivityIndicator color={customerTheme.colors.primary} style={styles.loader} />
        ) : restaurants.length === 0 ? (
          <View style={styles.emptyCard}><Text style={styles.emptyText}>{t("home.restaurantsEmpty")}</Text></View>
        ) : (
          restaurants.map((restaurant, index) => (
            <Pressable key={restaurant.id} onPress={() => props.onOpenRestaurant(restaurant)} style={styles.restaurantCard}>
              <View style={[styles.restaurantVisual, index % 2 ? styles.visualGreen : styles.visualOrange]}>
                {restaurant.logoUrl ? <Image resizeMode="cover" source={{ uri: restaurant.logoUrl }} style={styles.fullImage} /> : <Text style={styles.restaurantEmoji}>🍽️</Text>}
              </View>
              <View style={styles.restaurantInfo}>
                <Text numberOfLines={1} style={styles.restaurantName}>{restaurant.name}</Text>
                {restaurant.description ? <Text numberOfLines={2} style={styles.restaurantMeta}>{restaurant.description}</Text> : null}
                <Text numberOfLines={1} style={styles.restaurantAddress}>{restaurant.addressLine}</Text>
                <Text style={styles.restaurantOpen}>{t("home.openNow")}</Text>
              </View>
            </Pressable>
          ))
        )}

        <View style={styles.quickActions}>
          <Pressable onPress={props.onOpenAccount} style={styles.quickButton}>
            <Text style={styles.quickIcon}>◎</Text><Text style={styles.quickLabel}>{t("home.myAccount")}</Text>
          </Pressable>
          <Pressable onPress={props.onViewOrders} style={styles.quickButton}>
            <Text style={styles.quickIcon}>▤</Text><Text style={styles.quickLabel}>{t("home.myOrders")}</Text>
          </Pressable>
          <Pressable onPress={props.onOpenNotifications} style={styles.quickButton}>
            <Text style={styles.quickIcon}>♢</Text><Text style={styles.quickLabel}>{t("common:notifications")}</Text>
          </Pressable>
          <Pressable disabled={loggingOut} onPress={() => void logout()} style={styles.quickButton}>
            {loggingOut ? <ActivityIndicator color={customerTheme.colors.primary} /> : <Text style={styles.quickIcon}>↗</Text>}
            <Text style={styles.quickLabel}>{t("common:logout")}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function firstName(fullName: string, t: (key: string) => string): string {
  return fullName.trim().split(/\s+/)[0] || t("home.defaultFirstName");
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
  content: { alignSelf: "center", maxWidth: 900, padding: 20, paddingBottom: 48, width: "100%" },
  topBar: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  eyebrow: { color: customerTheme.colors.textMuted, fontSize: 10, fontWeight: "800", letterSpacing: 1.4 },
  location: { color: customerTheme.colors.text, fontSize: 14, fontWeight: "800", marginTop: 3 },
  iconButton: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderRadius: 16, height: 46, justifyContent: "center", position: "relative", width: 46, ...customerTheme.shadow },
  iconText: { color: customerTheme.colors.secondary, fontSize: 25, fontWeight: "700" },
  notificationDot: { backgroundColor: customerTheme.colors.primary, borderColor: "#FFFFFF", borderRadius: 6, borderWidth: 2, height: 10, position: "absolute", end: 7, top: 7, width: 10 },
  greetingRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 24 },
  greetingText: { flex: 1 },
  greeting: { color: customerTheme.colors.text, fontSize: 28, fontWeight: "900" },
  greetingSubtitle: { color: customerTheme.colors.textMuted, fontSize: 15, marginTop: 5 },
  logo: { height: 34, width: 110 },
  notice: { backgroundColor: customerTheme.colors.successSoft, borderRadius: 12, color: customerTheme.colors.success, fontSize: 13, marginTop: 14, padding: 12 },
  searchBar: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", marginTop: 22, minHeight: 56, paddingHorizontal: 15 },
  searchIcon: { color: customerTheme.colors.text, fontSize: 25, marginEnd: 10 },
  searchText: { color: "#9A9F9C", flex: 1, fontSize: 14 },
  filterButton: { alignItems: "center", backgroundColor: customerTheme.colors.primarySoft, borderRadius: 11, height: 36, justifyContent: "center", width: 36 },
  filterText: { color: customerTheme.colors.primary, fontSize: 20, fontWeight: "900", transform: [{ rotate: "90deg" }] },
  marketHero: { alignItems: "center", backgroundColor: customerTheme.colors.secondary, borderRadius: 22, flexDirection: "row", marginTop: 18, minHeight: 112, padding: 16, ...customerTheme.shadow },
  marketIcon: { alignItems: "center", backgroundColor: "#E2F6EA", borderRadius: 18, height: 70, justifyContent: "center", width: 70 },
  marketEmoji: { fontSize: 35 },
  marketCopy: { flex: 1, marginStart: 14 },
  marketEyebrow: { color: "#A9D7C7", fontSize: 9, fontWeight: "900", letterSpacing: 1.1 },
  marketTitle: { color: "#FFFFFF", fontSize: 19, fontWeight: "900", marginTop: 4 },
  marketDescription: { color: "#D9E9E3", fontSize: 11, lineHeight: 16, marginTop: 4 },
  marketArrow: { color: "#FFFFFF", fontSize: 31, marginStart: 8 },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 14, marginTop: 28 },
  sectionTitle: { color: customerTheme.colors.text, fontSize: 20, fontWeight: "900" },
  seeAll: { color: customerTheme.colors.primary, fontSize: 13, fontWeight: "800" },
  loader: { marginVertical: 35 },
  emptyCard: { backgroundColor: customerTheme.colors.surface, borderRadius: 18, padding: 25 },
  emptyTitle: { color: customerTheme.colors.text, fontSize: 15, fontWeight: "900", marginBottom: 6, textAlign: "center" },
  emptyText: { color: customerTheme.colors.textMuted, textAlign: "center" },
  offerCard: { backgroundColor: customerTheme.colors.secondary, borderRadius: 22, flexDirection: "row", marginBottom: 14, minHeight: 150, overflow: "hidden", ...customerTheme.shadow },
  offerVisual: { alignItems: "center", backgroundColor: customerTheme.colors.primarySoft, justifyContent: "center", minHeight: 150, width: "38%" },
  fullImage: { height: "100%", width: "100%" },
  offerLogo: { height: 86, width: 86 },
  offerEmoji: { color: customerTheme.colors.primary, fontSize: 48, fontWeight: "900" },
  offerCopy: { flex: 1, justifyContent: "center", padding: 16 },
  offerRestaurant: { color: "#C8D9D3", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  offerTitle: { color: "#FFFFFF", fontSize: 19, fontWeight: "900", marginTop: 5 },
  offerDescription: { color: "#E2ECE8", fontSize: 11, lineHeight: 16, marginTop: 5 },
  offerDiscount: { color: "#FFCBB8", fontSize: 13, fontWeight: "900", marginTop: 9 },
  offerExpiry: { color: "#C8D9D3", fontSize: 10, marginTop: 4 },
  restaurantCard: { backgroundColor: customerTheme.colors.surface, borderRadius: 20, marginBottom: 15, overflow: "hidden", ...customerTheme.shadow },
  marketStoreCard: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderRadius: 20, flexDirection: "row", marginBottom: 15, overflow: "hidden", ...customerTheme.shadow },
  marketStoreIcon: { alignItems: "center", alignSelf: "stretch", backgroundColor: "#DDEFE4", justifyContent: "center", width: 105 },
  marketStoreEmoji: { fontSize: 45 },
  restaurantVisual: { alignItems: "center", height: 135, justifyContent: "center", position: "relative" },
  visualOrange: { backgroundColor: "#FFE0C8" },
  visualGreen: { backgroundColor: "#DDEFE4" },
  restaurantEmoji: { fontSize: 66 },
  restaurantInfo: { padding: 15 },
  restaurantName: { color: customerTheme.colors.text, flex: 1, fontSize: 17, fontWeight: "900", marginEnd: 10 },
  restaurantMeta: { color: customerTheme.colors.textMuted, fontSize: 12, marginTop: 5 },
  restaurantAddress: { color: customerTheme.colors.textMuted, fontSize: 11, marginTop: 8 },
  restaurantOpen: { color: customerTheme.colors.success, fontSize: 11, fontWeight: "800", marginTop: 8 },
  quickActions: { flexDirection: "row", gap: 10, marginTop: 14 },
  quickButton: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: 16, borderWidth: 1, flex: 1, minHeight: 80, justifyContent: "center", padding: 10 },
  quickIcon: { color: customerTheme.colors.primary, fontSize: 22, fontWeight: "900" },
  quickLabel: { color: customerTheme.colors.text, fontSize: 11, fontWeight: "700", marginTop: 5 }
});
