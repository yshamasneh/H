import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import i18n from "../../i18n";
import {
  approveAdminRestaurant,
  getAdminRestaurant,
  listAdminRestaurants,
  reactivateAdminRestaurant,
  rejectAdminRestaurant,
  suspendAdminRestaurant,
  type AdminRestaurant,
  type AdminRestaurantDetail,
  type RestaurantStatusValue
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
  adminStyles,
  formatDate,
  formatMoney,
  readAdminError
} from "./ui";

type RestaurantFilter = "ALL" | RestaurantStatusValue;

const filterValues: RestaurantFilter[] = ["ALL", "PENDING", "APPROVED", "SUSPENDED", "REJECTED"];

export function AdminRestaurantsScreen(props: {
  onBack: () => void;
  onOpenRestaurant: (restaurantId: string) => void;
}) {
  const { t } = useTranslation(["admin", "common"]);
  const [restaurants, setRestaurants] = useState<AdminRestaurant[] | null>(null);
  const [filter, setFilter] = useState<RestaurantFilter>("ALL");
  const [error, setError] = useState<string | null>(null);
  const filters = filterValues.map((value) => ({
    value,
    label: value === "ALL" ? t("restaurants.filterAll") : t(`common:status.${value}`)
  }));

  async function load() {
    try {
      const token = await requireToken();
      const page = await listAdminRestaurants(token, filter === "ALL" ? {} : { status: filter });
      setRestaurants(page.items);
      setError(null);
    } catch (requestError) {
      setError(readAdminError(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, [filter]);

  return (
    <AdminPage onBack={props.onBack} subtitle={t("restaurants.subtitle")} title={t("restaurants.title")}>
      <FilterChips onChange={setFilter} options={filters} value={filter} />
      <ErrorBanner message={error} />
      {restaurants === null ? (
        <LoadingState />
      ) : restaurants.length === 0 ? (
        <EmptyState message={t("restaurants.empty")} />
      ) : (
        restaurants.map((restaurant) => (
          <Card key={restaurant.id}>
            <View style={adminStyles.rowBetween}>
              <View style={{ flex: 1 }}>
                <CardTitle>{restaurant.name}</CardTitle>
                <Meta>{restaurant.businessType === "SUPERMARKET" ? t("restaurants.businessTypeSupermarket") : t("restaurants.businessTypeRestaurant")}</Meta>
                <Meta>{restaurant.addressLine}</Meta>
              </View>
              <StatusPill status={restaurant.status} />
            </View>
            <KeyValue label={t("restaurants.openLabel")} value={restaurant.isOpen ? t("common:yes") : t("common:no")} />
            <KeyValue label={t("restaurants.phoneLabel")} value={restaurant.phone} />
            <ActionButton label={t("restaurants.viewDetails")} onPress={() => props.onOpenRestaurant(restaurant.id)} variant="secondary" />
          </Card>
        ))
      )}
    </AdminPage>
  );
}

export function AdminRestaurantDetailScreen(props: { restaurantId: string; onBack: () => void }) {
  const { t } = useTranslation(["admin", "common"]);
  const [restaurant, setRestaurant] = useState<AdminRestaurantDetail | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setRestaurant(await getAdminRestaurant(await requireToken(), props.restaurantId));
      setError(null);
    } catch (requestError) {
      setError(readAdminError(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, [props.restaurantId]);

  async function act(action: (token: string) => Promise<unknown>) {
    setBusy(true);
    try {
      await action(await requireToken());
      setReason("");
      await load();
    } catch (requestError) {
      setError(readAdminError(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage onBack={props.onBack} subtitle={t("restaurantDetail.subtitle")} title={restaurant?.name ?? t("restaurantDetail.notFoundTitle")}>
      <ErrorBanner message={error} />
      {!restaurant ? (
        error ? null : <LoadingState />
      ) : (
        <>
          <Card>
            <View style={adminStyles.rowBetween}>
              <CardTitle>{restaurant.name}</CardTitle>
              <Meta>{restaurant.businessType === "SUPERMARKET" ? t("restaurants.businessTypeSupermarket") : t("restaurants.businessTypeRestaurant")}</Meta>
              <StatusPill status={restaurant.status} />
            </View>
            <KeyValue label={t("restaurantDetail.ownerLabel")} value={restaurant.ownerFullName} />
            <KeyValue label={t("restaurantDetail.ownerPhoneLabel")} value={restaurant.ownerPhone} />
            <KeyValue label={t("restaurantDetail.addressLabel")} value={restaurant.addressLine} />
            <KeyValue label={t("restaurants.openLabel")} value={restaurant.isOpen ? t("common:yes") : t("common:no")} />
            <KeyValue label={t("restaurantDetail.ordersLabel")} value={String(restaurant.totalOrdersCount)} />
            <KeyValue label={t("restaurantDetail.revenueLabel")} value={formatMoney(restaurant.revenueMinor)} />
            <KeyValue label={t("restaurantDetail.createdLabel")} value={formatDate(restaurant.createdAt)} />
          </Card>

          {restaurant.status === "APPROVED" ? (
            <View style={adminStyles.reasonBox}>
              <Input multiline onChangeText={setReason} placeholder={t("restaurantDetail.suspendReasonPlaceholder")} value={reason} />
              <ActionButton
                disabled={!reason.trim()}
                label={t("restaurantDetail.suspendButton")}
                loading={busy}
                onPress={() => void act((token) => suspendAdminRestaurant(token, restaurant.id, reason.trim()))}
                variant="danger"
              />
            </View>
          ) : null}

          <ActionRow>
            {restaurant.status === "PENDING" ? (
              <>
                <ActionButton label={t("common:approve")} loading={busy} onPress={() => void act((token) => approveAdminRestaurant(token, restaurant.id))} />
                <ActionButton label={t("common:reject")} loading={busy} onPress={() => void act((token) => rejectAdminRestaurant(token, restaurant.id))} variant="danger" />
              </>
            ) : null}
            {restaurant.status === "SUSPENDED" ? (
              <ActionButton label={t("common:reactivate")} loading={busy} onPress={() => void act((token) => reactivateAdminRestaurant(token, restaurant.id))} />
            ) : null}
          </ActionRow>
        </>
      )}
    </AdminPage>
  );
}

async function requireToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error(i18n.t("common:sessionExpired"));
  return token;
}
