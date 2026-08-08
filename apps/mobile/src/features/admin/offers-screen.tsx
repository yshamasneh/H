import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  createAdminOffer,
  getAdminRestaurantMenu,
  listAdminOffers,
  listAdminRestaurants,
  offerTypes,
  updateAdminOffer,
  type AdminOfferInput,
  type AdminRestaurant,
  type MenuItemOwner,
  type OfferTypeValue,
  type RestaurantOffer
} from "../../core/api";
import { getAccessToken } from "../../core/session";
import {
  ActionButton,
  ActionRow,
  AdminPage,
  Card,
  CardTitle,
  EmptyState,
  ErrorBanner,
  FilterChips,
  Input,
  KeyValue,
  LoadingState,
  Meta,
  StatusPill,
  formatDate,
  formatMoney,
  readAdminError
} from "./ui";

const typeOptions = [
  { label: "Product %", value: "PRODUCT_PERCENTAGE" },
  { label: "Order %", value: "ORDER_PERCENTAGE" },
  { label: "Delivery %", value: "DELIVERY_PERCENTAGE" },
  { label: "Free delivery", value: "FREE_DELIVERY" }
] satisfies { label: string; value: OfferTypeValue }[];

export function AdminOffersScreen({ onBack }: { onBack: () => void }) {
  const [offers, setOffers] = useState<RestaurantOffer[] | null>(null);
  const [restaurants, setRestaurants] = useState<AdminRestaurant[]>([]);
  const [menuItems, setMenuItems] = useState<(MenuItemOwner & { categoryName: string })[]>([]);
  const [type, setType] = useState<OfferTypeValue>(offerTypes[0]);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [menuItemId, setMenuItemId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [discountPercent, setDiscountPercent] = useState("20");
  const [minimumSubtotal, setMinimumSubtotal] = useState("0");
  const [maxDiscount, setMaxDiscount] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const token = await requireToken();
      const [nextOffers, restaurantPage] = await Promise.all([
        listAdminOffers(token),
        listAdminRestaurants(token)
      ]);
      setOffers(nextOffers);
      setRestaurants(restaurantPage.items);
      setRestaurantId((current) => current ?? restaurantPage.items[0]?.id ?? null);
      setError(null);
    } catch (requestError) {
      setError(readAdminError(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setMenuItemId(null);
    if (!restaurantId || type !== "PRODUCT_PERCENTAGE") {
      setMenuItems([]);
      return;
    }
    void requireToken()
      .then((token) => getAdminRestaurantMenu(token, restaurantId))
      .then((menu) => setMenuItems(menu.categories.flatMap((category) => category.items)))
      .catch((requestError) => setError(readAdminError(requestError)));
  }, [restaurantId, type]);

  const requiresRestaurant = type === "PRODUCT_PERCENTAGE" || type === "ORDER_PERCENTAGE";
  const selectedRestaurant = useMemo(
    () => restaurants.find((restaurant) => restaurant.id === restaurantId) ?? null,
    [restaurantId, restaurants]
  );

  async function create() {
    if (!title.trim()) {
      setError("Enter an offer title.");
      return;
    }
    if (requiresRestaurant && !restaurantId) {
      setError("Select a restaurant for this offer.");
      return;
    }
    if (type === "PRODUCT_PERCENTAGE" && !menuItemId) {
      setError("Select the product receiving the offer.");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await createAdminOffer(await requireToken(), {
        type,
        restaurantId: restaurantId ?? undefined,
        menuItemId: type === "PRODUCT_PERCENTAGE" ? menuItemId ?? undefined : undefined,
        title: title.trim(),
        description: description.trim() || undefined,
        discountPercent: type === "FREE_DELIVERY" ? undefined : parsePositive(discountPercent),
        minimumSubtotalMinor: parseMoney(minimumSubtotal) ?? 0,
        maxDiscountMinor: type === "FREE_DELIVERY" ? undefined : parseMoney(maxDiscount),
        imageUrl: imageUrl.trim() || undefined,
        startsAt: startsAt.trim() || undefined,
        endsAt: endsAt.trim() || undefined,
        isActive: true
      });
      setTitle("");
      setDescription("");
      setImageUrl("");
      setEndsAt("");
      setNotice("Offer published. Eligible orders will receive it automatically.");
      await load();
    } catch (requestError) {
      setError(readAdminError(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(offer: RestaurantOffer) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await updateAdminOffer(await requireToken(), offer.id, offerToInput(offer, !offer.isActive));
      setNotice(offer.isActive ? "Offer paused." : "Offer activated.");
      await load();
    } catch (requestError) {
      setError(readAdminError(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage onBack={onBack} subtitle="Create and control product, order, and delivery promotions" title="Offers">
      <ErrorBanner message={error} />
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <Card>
        <CardTitle>New offer</CardTitle>
        <Meta>The server applies the best eligible product/order offer plus the best delivery offer.</Meta>
        <Text style={styles.label}>Offer type</Text>
        <FilterChips onChange={setType} options={typeOptions} value={type} />

        <Text style={styles.label}>Store scope</Text>
        {!requiresRestaurant ? (
          <Pressable onPress={() => setRestaurantId(null)} style={[styles.choice, restaurantId === null && styles.choiceSelected]}>
            <Text style={[styles.choiceText, restaurantId === null && styles.choiceTextSelected]}>All stores</Text>
          </Pressable>
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {restaurants.map((restaurant) => (
            <Pressable
              key={restaurant.id}
              onPress={() => setRestaurantId(restaurant.id)}
              style={[styles.choice, restaurantId === restaurant.id && styles.choiceSelected]}
            >
              <Text style={[styles.choiceText, restaurantId === restaurant.id && styles.choiceTextSelected]}>{restaurant.name} · {restaurant.businessType === "SUPERMARKET" ? "Market" : "Restaurant"}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {selectedRestaurant ? <Meta>Selected: {selectedRestaurant.name}</Meta> : <Meta>Global delivery promotion</Meta>}

        {type === "PRODUCT_PERCENTAGE" ? (
          <>
            <Text style={styles.label}>Product</Text>
            <View style={styles.choiceWrap}>
              {menuItems.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => setMenuItemId(item.id)}
                  style={[styles.choice, menuItemId === item.id && styles.choiceSelected]}
                >
                  <Text style={[styles.choiceText, menuItemId === item.id && styles.choiceTextSelected]}>
                    {item.name} · {formatMoney(item.priceMinor)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.label}>Customer-facing title</Text>
        <Input onChangeText={setTitle} placeholder="Weekend special" value={title} />
        <Input multiline onChangeText={setDescription} placeholder="Description (optional)" value={description} />
        {type !== "FREE_DELIVERY" ? (
          <Input onChangeText={setDiscountPercent} placeholder="Discount percent, e.g. 20" value={discountPercent} />
        ) : null}
        <Input onChangeText={setMinimumSubtotal} placeholder="Minimum subtotal in ILS, e.g. 50" value={minimumSubtotal} />
        {type !== "FREE_DELIVERY" ? (
          <Input onChangeText={setMaxDiscount} placeholder="Maximum discount in ILS (optional)" value={maxDiscount} />
        ) : null}
        <Input onChangeText={setImageUrl} placeholder="Campaign image URL (optional)" value={imageUrl} />
        <Input onChangeText={setStartsAt} placeholder="Start ISO date (blank = now)" value={startsAt} />
        <Input onChangeText={setEndsAt} placeholder="End ISO date (optional)" value={endsAt} />
        <ActionButton disabled={busy} label="Publish offer" loading={busy} onPress={() => void create()} />
      </Card>

      <Text style={styles.heading}>All offers</Text>
      {offers === null ? (
        <LoadingState />
      ) : offers.length === 0 ? (
        <EmptyState message="No offers have been created." />
      ) : (
        offers.map((offer) => (
          <Card key={offer.id}>
            <View style={styles.row}>
              <View style={styles.copy}>
                <CardTitle>{offer.title}</CardTitle>
                <Meta>{offer.restaurantName ?? "All stores"}{offer.menuItemName ? ` · ${offer.menuItemName}` : ""}</Meta>
              </View>
              <StatusPill status={offer.isActive ? "ACTIVE" : "INACTIVE"} />
            </View>
            <KeyValue label="Type" value={offer.type.replace(/_/g, " ")} />
            <KeyValue label="Discount" value={offer.type === "FREE_DELIVERY" ? "100% delivery" : `${offer.discountPercent}%`} />
            <KeyValue label="Minimum" value={formatMoney(offer.minimumSubtotalMinor)} />
            <KeyValue label="Starts" value={formatDate(offer.startsAt)} />
            {offer.endsAt ? <KeyValue label="Ends" value={formatDate(offer.endsAt)} /> : null}
            <ActionRow>
              <ActionButton
                disabled={busy}
                label={offer.isActive ? "Pause" : "Activate"}
                onPress={() => void toggle(offer)}
                variant={offer.isActive ? "danger" : "primary"}
              />
            </ActionRow>
          </Card>
        ))
      )}
    </AdminPage>
  );
}

function offerToInput(offer: RestaurantOffer, isActive: boolean): AdminOfferInput {
  return {
    type: offer.type,
    restaurantId: offer.restaurantId ?? undefined,
    menuItemId: offer.menuItemId ?? undefined,
    title: offer.title,
    description: offer.description ?? undefined,
    discountPercent: offer.discountPercent ?? undefined,
    minimumSubtotalMinor: offer.minimumSubtotalMinor,
    maxDiscountMinor: offer.type === "FREE_DELIVERY" ? undefined : offer.maxDiscountMinor ?? undefined,
    imageUrl: offer.imageUrl ?? undefined,
    startsAt: offer.startsAt,
    endsAt: offer.endsAt ?? undefined,
    isActive
  };
}

function parsePositive(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function parseMoney(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : undefined;
}

async function requireToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error("Your session has expired. Please log in again.");
  return token;
}

const styles = StyleSheet.create({
  copy: { flex: 1 },
  choice: { backgroundColor: "#E2E8F0", borderRadius: 999, marginRight: 8, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8 },
  choiceSelected: { backgroundColor: "#0F766E" },
  choiceText: { color: "#475569", fontSize: 12, fontWeight: "700" },
  choiceTextSelected: { color: "#FFFFFF" },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", marginBottom: 4 },
  heading: { color: "#0F172A", fontSize: 18, fontWeight: "900", marginTop: 8 },
  label: { color: "#334155", fontSize: 12, fontWeight: "800", marginBottom: 6, marginTop: 14 },
  notice: { backgroundColor: "#DCFCE7", borderRadius: 10, color: "#166534", padding: 12 },
  row: { alignItems: "flex-start", flexDirection: "row", gap: 10, justifyContent: "space-between" }
});
