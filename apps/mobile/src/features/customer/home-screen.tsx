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
import { colors, iconSize, radius, spacing } from "../../theme/tokens";
import { text } from "../../theme/typography";
import { customerTheme } from "./theme";

/* On the dark hero/offer panels below (customerTheme.colors.secondary, which
   resolves to the same near-black as surfaceInverse), text hierarchy uses
   translucent white the same way apps/admin's dark sidebar does — there is
   no token for it there either, since it's a function of the specific panel
   colour rather than a reusable semantic. */
const onDark = {
  strong: colors.textInverse,
  medium: "rgba(255, 255, 255, 0.72)",
  soft: "rgba(255, 255, 255, 0.55)"
};

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
          restaurants.map((restaurant) => (
            <Pressable key={restaurant.id} onPress={() => props.onOpenRestaurant(restaurant)} style={styles.restaurantCard}>
              <View style={styles.restaurantVisual}>
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
  content: { alignSelf: "center", maxWidth: 900, padding: spacing[5], paddingBottom: spacing[9], width: "100%" },
  topBar: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  eyebrow: { ...text("label", "bold"), color: customerTheme.colors.textMuted },
  location: { ...text("bodySm", "bold"), color: customerTheme.colors.text, marginTop: spacing[1] },
  iconButton: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderRadius: radius.lg, height: 46, justifyContent: "center", position: "relative", width: 46, ...customerTheme.shadow },
  iconText: { color: customerTheme.colors.secondary, fontSize: iconSize.md },
  notificationDot: { backgroundColor: customerTheme.colors.primary, borderColor: colors.surface, borderRadius: 6, borderWidth: 2, height: 10, position: "absolute", end: 7, top: 7, width: 10 },
  greetingRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: spacing[6] },
  greetingText: { flex: 1 },
  greeting: { ...text("display", "bold"), color: customerTheme.colors.text },
  greetingSubtitle: { ...text("body"), color: customerTheme.colors.textMuted, marginTop: spacing[1] },
  logo: { height: 34, width: 110 },
  notice: { ...text("bodySm"), backgroundColor: customerTheme.colors.successSoft, borderRadius: radius.md, color: customerTheme.colors.success, marginTop: spacing[4], padding: spacing[3] },
  searchBar: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", marginTop: spacing[6], minHeight: 56, paddingHorizontal: spacing[4] },
  searchIcon: { color: customerTheme.colors.text, fontSize: iconSize.md, marginEnd: spacing[3] },
  searchText: { ...text("bodySm"), color: customerTheme.colors.textMuted, flex: 1 },
  filterButton: { alignItems: "center", backgroundColor: customerTheme.colors.primarySoft, borderRadius: radius.md, height: 36, justifyContent: "center", width: 36 },
  filterText: { color: customerTheme.colors.primary, fontSize: iconSize.sm, fontWeight: "900", transform: [{ rotate: "90deg" }] },
  marketHero: { alignItems: "center", backgroundColor: customerTheme.colors.secondary, borderRadius: radius.lg, flexDirection: "row", marginTop: spacing[5], minHeight: 112, padding: spacing[4], ...customerTheme.shadow },
  marketIcon: { alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.lg, height: 70, justifyContent: "center", width: 70 },
  marketEmoji: { fontSize: iconSize.xl },
  marketCopy: { flex: 1, marginStart: spacing[4] },
  marketEyebrow: { ...text("label", "bold"), color: customerTheme.colors.primary },
  marketTitle: { ...text("h2", "bold"), color: onDark.strong, marginTop: spacing[1] },
  marketDescription: { ...text("caption"), color: onDark.medium, marginTop: spacing[1] },
  marketArrow: { color: onDark.strong, fontSize: iconSize.xl, marginStart: spacing[2] },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: spacing[4], marginTop: spacing[7] },
  sectionTitle: { ...text("h2", "bold"), color: customerTheme.colors.text },
  seeAll: { ...text("caption", "bold"), color: customerTheme.colors.primary },
  loader: { marginVertical: spacing[8] },
  emptyCard: { backgroundColor: customerTheme.colors.surface, borderRadius: radius.lg, padding: spacing[6] },
  emptyTitle: { ...text("body", "bold"), color: customerTheme.colors.text, marginBottom: spacing[2], textAlign: "center" },
  emptyText: { ...text("bodySm"), color: customerTheme.colors.textMuted, textAlign: "center" },
  offerCard: { backgroundColor: customerTheme.colors.secondary, borderRadius: radius.lg, flexDirection: "row", marginBottom: spacing[4], minHeight: 150, overflow: "hidden", ...customerTheme.shadow },
  offerVisual: { alignItems: "center", backgroundColor: colors.neutralSubtle, justifyContent: "center", minHeight: 150, width: "38%" },
  fullImage: { height: "100%", width: "100%" },
  offerLogo: { height: 86, width: 86 },
  offerEmoji: { color: customerTheme.colors.primary, fontSize: iconSize.xxxl, fontWeight: "900" },
  offerCopy: { flex: 1, justifyContent: "center", padding: spacing[4] },
  offerRestaurant: { ...text("label", "bold"), color: onDark.medium },
  offerTitle: { ...text("h2", "bold"), color: onDark.strong, marginTop: spacing[1] },
  offerDescription: { ...text("caption"), color: onDark.medium, marginTop: spacing[1] },
  offerDiscount: { ...text("bodySm", "bold"), color: customerTheme.colors.primary, marginTop: spacing[2] },
  offerExpiry: { ...text("label"), color: onDark.soft },
  restaurantCard: { backgroundColor: customerTheme.colors.surface, borderRadius: radius.lg, marginBottom: spacing[4], overflow: "hidden", ...customerTheme.shadow },
  marketStoreCard: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderRadius: radius.lg, flexDirection: "row", marginBottom: spacing[4], overflow: "hidden", ...customerTheme.shadow },
  marketStoreIcon: { alignItems: "center", alignSelf: "stretch", backgroundColor: colors.neutralSubtle, justifyContent: "center", width: 105 },
  marketStoreEmoji: { fontSize: iconSize.xxxl },
  restaurantVisual: { alignItems: "center", height: 135, justifyContent: "center", position: "relative", backgroundColor: colors.neutralSubtle },
  restaurantEmoji: { fontSize: iconSize.xxxl },
  restaurantInfo: { padding: spacing[4] },
  restaurantName: { ...text("h3", "bold"), color: customerTheme.colors.text, flex: 1, marginEnd: spacing[3] },
  restaurantMeta: { ...text("caption"), color: customerTheme.colors.textMuted, marginTop: spacing[1] },
  restaurantAddress: { ...text("label"), color: customerTheme.colors.textMuted, marginTop: spacing[2] },
  restaurantOpen: { ...text("label", "bold"), color: customerTheme.colors.success, marginTop: spacing[2] },
  quickActions: { flexDirection: "row", gap: spacing[2], marginTop: spacing[4] },
  quickButton: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: radius.lg, borderWidth: 1, flex: 1, minHeight: 80, justifyContent: "center", padding: spacing[3] },
  quickIcon: { color: customerTheme.colors.primary, fontSize: iconSize.md, fontWeight: "900" },
  quickLabel: { ...text("label", "medium"), color: customerTheme.colors.text, marginTop: spacing[1] }
});
