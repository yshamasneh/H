import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import i18n from "../../i18n";
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

const typeValues: OfferTypeValue[] = ["PRODUCT_PERCENTAGE", "ORDER_PERCENTAGE", "DELIVERY_PERCENTAGE", "FREE_DELIVERY"];

export function AdminOffersScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation(["admin", "common"]);
  const typeOptions = typeValues.map((value) => ({
    value,
    label: t(
      {
        PRODUCT_PERCENTAGE: "offers.typeProductPercent",
        ORDER_PERCENTAGE: "offers.typeOrderPercent",
        DELIVERY_PERCENTAGE: "offers.typeDeliveryPercent",
        FREE_DELIVERY: "offers.typeFreeDelivery"
      }[value]
    )
  }));
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
      setError(t("offers.enterTitleError"));
      return;
    }
    if (requiresRestaurant && !restaurantId) {
      setError(t("offers.selectRestaurantError"));
      return;
    }
    if (type === "PRODUCT_PERCENTAGE" && !menuItemId) {
      setError(t("offers.selectProductError"));
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
      setNotice(t("offers.publishSuccess"));
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
      setNotice(offer.isActive ? t("offers.pausedSuccess") : t("offers.activatedSuccess"));
      await load();
    } catch (requestError) {
      setError(readAdminError(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage onBack={onBack} subtitle={t("offers.subtitle")} title={t("offers.title")}>
      <ErrorBanner message={error} />
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <Card>
        <CardTitle>{t("offers.newOfferTitle")}</CardTitle>
        <Meta>{t("offers.newOfferMeta")}</Meta>
        <Text style={styles.label}>{t("offers.offerTypeLabel")}</Text>
        <FilterChips onChange={setType} options={typeOptions} value={type} />

        <Text style={styles.label}>{t("offers.storeScopeLabel")}</Text>
        {!requiresRestaurant ? (
          <Pressable onPress={() => setRestaurantId(null)} style={[styles.choice, restaurantId === null && styles.choiceSelected]}>
            <Text style={[styles.choiceText, restaurantId === null && styles.choiceTextSelected]}>{t("offers.allStores")}</Text>
          </Pressable>
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {restaurants.map((restaurant) => (
            <Pressable
              key={restaurant.id}
              onPress={() => setRestaurantId(restaurant.id)}
              style={[styles.choice, restaurantId === restaurant.id && styles.choiceSelected]}
            >
              <Text style={[styles.choiceText, restaurantId === restaurant.id && styles.choiceTextSelected]}>
                {restaurant.name} · {restaurant.businessType === "SUPERMARKET" ? t("offers.marketLabel") : t("offers.restaurantLabel")}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        {selectedRestaurant ? (
          <Meta>{t("offers.selectedLabel", { name: selectedRestaurant.name })}</Meta>
        ) : (
          <Meta>{t("offers.globalDeliveryPromo")}</Meta>
        )}

        {type === "PRODUCT_PERCENTAGE" ? (
          <>
            <Text style={styles.label}>{t("offers.productLabel")}</Text>
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

        <Text style={styles.label}>{t("offers.customerFacingTitleLabel")}</Text>
        <Input onChangeText={setTitle} placeholder={t("offers.titlePlaceholder")} value={title} />
        <Input multiline onChangeText={setDescription} placeholder={t("offers.descriptionPlaceholder")} value={description} />
        {type !== "FREE_DELIVERY" ? (
          <Input onChangeText={setDiscountPercent} placeholder={t("offers.discountPercentPlaceholder")} value={discountPercent} />
        ) : null}
        <Input onChangeText={setMinimumSubtotal} placeholder={t("offers.minimumSubtotalPlaceholder")} value={minimumSubtotal} />
        {type !== "FREE_DELIVERY" ? (
          <Input onChangeText={setMaxDiscount} placeholder={t("offers.maxDiscountPlaceholder")} value={maxDiscount} />
        ) : null}
        <Input onChangeText={setImageUrl} placeholder={t("offers.imageUrlPlaceholder")} value={imageUrl} />
        <Input onChangeText={setStartsAt} placeholder={t("offers.startDatePlaceholder")} value={startsAt} />
        <Input onChangeText={setEndsAt} placeholder={t("offers.endDatePlaceholder")} value={endsAt} />
        <ActionButton disabled={busy} label={t("offers.publishButton")} loading={busy} onPress={() => void create()} />
      </Card>

      <Text style={styles.heading}>{t("offers.allOffersTitle")}</Text>
      {offers === null ? (
        <LoadingState />
      ) : offers.length === 0 ? (
        <EmptyState message={t("offers.empty")} />
      ) : (
        offers.map((offer) => (
          <Card key={offer.id}>
            <View style={styles.row}>
              <View style={styles.copy}>
                <CardTitle>{offer.title}</CardTitle>
                <Meta>{offer.restaurantName ?? t("offers.allStores")}{offer.menuItemName ? ` · ${offer.menuItemName}` : ""}</Meta>
              </View>
              <StatusPill status={offer.isActive ? "ACTIVE" : "INACTIVE"} />
            </View>
            <KeyValue label={t("offers.typeLabel")} value={offer.type.replace(/_/g, " ")} />
            <KeyValue label={t("offers.discountLabel")} value={offer.type === "FREE_DELIVERY" ? t("offers.freeDeliveryDiscountValue") : `${offer.discountPercent}%`} />
            <KeyValue label={t("offers.minimumLabel")} value={formatMoney(offer.minimumSubtotalMinor)} />
            <KeyValue label={t("offers.startsLabel")} value={formatDate(offer.startsAt)} />
            {offer.endsAt ? <KeyValue label={t("offers.endsLabel")} value={formatDate(offer.endsAt)} /> : null}
            <ActionRow>
              <ActionButton
                disabled={busy}
                label={offer.isActive ? t("offers.pauseButton") : t("offers.activateButton")}
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
  if (!token) throw new Error(i18n.t("common:sessionExpired"));
  return token;
}

const styles = StyleSheet.create({
  copy: { flex: 1 },
  choice: { backgroundColor: "#E2E8F0", borderRadius: 999, marginEnd: 8, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8 },
  choiceSelected: { backgroundColor: "#0F766E" },
  choiceText: { color: "#475569", fontSize: 12, fontWeight: "700" },
  choiceTextSelected: { color: "#FFFFFF" },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", marginBottom: 4 },
  heading: { color: "#0F172A", fontSize: 18, fontWeight: "900", marginTop: 8 },
  label: { color: "#334155", fontSize: 12, fontWeight: "800", marginBottom: 6, marginTop: 14 },
  notice: { backgroundColor: "#DCFCE7", borderRadius: 10, color: "#166534", padding: 12 },
  row: { alignItems: "flex-start", flexDirection: "row", gap: 10, justifyContent: "space-between" }
});
