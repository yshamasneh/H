import { useEffect, useState } from "react";
import { View } from "react-native";
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

const filters: { label: string; value: RestaurantFilter }[] = [
  { label: "All", value: "ALL" },
  { label: "Pending", value: "PENDING" },
  { label: "Approved", value: "APPROVED" },
  { label: "Suspended", value: "SUSPENDED" },
  { label: "Rejected", value: "REJECTED" }
];

export function AdminRestaurantsScreen(props: {
  onBack: () => void;
  onOpenRestaurant: (restaurantId: string) => void;
}) {
  const [restaurants, setRestaurants] = useState<AdminRestaurant[] | null>(null);
  const [filter, setFilter] = useState<RestaurantFilter>("ALL");
  const [error, setError] = useState<string | null>(null);

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
    <AdminPage onBack={props.onBack} subtitle="Approvals and operational status" title="Restaurants">
      <FilterChips onChange={setFilter} options={filters} value={filter} />
      <ErrorBanner message={error} />
      {restaurants === null ? (
        <LoadingState />
      ) : restaurants.length === 0 ? (
        <EmptyState message="No restaurants match this filter." />
      ) : (
        restaurants.map((restaurant) => (
          <Card key={restaurant.id}>
            <View style={adminStyles.rowBetween}>
              <View style={{ flex: 1 }}>
                <CardTitle>{restaurant.name}</CardTitle>
                <Meta>{restaurant.addressLine}</Meta>
              </View>
              <StatusPill status={restaurant.status} />
            </View>
            <KeyValue label="Open" value={restaurant.isOpen ? "Yes" : "No"} />
            <KeyValue label="Phone" value={restaurant.phone} />
            <ActionButton label="View details" onPress={() => props.onOpenRestaurant(restaurant.id)} variant="secondary" />
          </Card>
        ))
      )}
    </AdminPage>
  );
}

export function AdminRestaurantDetailScreen(props: { restaurantId: string; onBack: () => void }) {
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
    <AdminPage onBack={props.onBack} subtitle="Restaurant account and performance" title={restaurant?.name ?? "Restaurant details"}>
      <ErrorBanner message={error} />
      {!restaurant ? (
        error ? null : <LoadingState />
      ) : (
        <>
          <Card>
            <View style={adminStyles.rowBetween}>
              <CardTitle>{restaurant.name}</CardTitle>
              <StatusPill status={restaurant.status} />
            </View>
            <KeyValue label="Owner" value={restaurant.ownerFullName} />
            <KeyValue label="Owner phone" value={restaurant.ownerPhone} />
            <KeyValue label="Address" value={restaurant.addressLine} />
            <KeyValue label="Open" value={restaurant.isOpen ? "Yes" : "No"} />
            <KeyValue label="Orders" value={String(restaurant.totalOrdersCount)} />
            <KeyValue label="Revenue" value={formatMoney(restaurant.revenueMinor)} />
            <KeyValue label="Created" value={formatDate(restaurant.createdAt)} />
          </Card>

          {restaurant.status === "APPROVED" ? (
            <View style={adminStyles.reasonBox}>
              <Input multiline onChangeText={setReason} placeholder="Required suspension reason" value={reason} />
              <ActionButton
                disabled={!reason.trim()}
                label="Suspend restaurant"
                loading={busy}
                onPress={() => void act((token) => suspendAdminRestaurant(token, restaurant.id, reason.trim()))}
                variant="danger"
              />
            </View>
          ) : null}

          <ActionRow>
            {restaurant.status === "PENDING" ? (
              <>
                <ActionButton label="Approve" loading={busy} onPress={() => void act((token) => approveAdminRestaurant(token, restaurant.id))} />
                <ActionButton label="Reject" loading={busy} onPress={() => void act((token) => rejectAdminRestaurant(token, restaurant.id))} variant="danger" />
              </>
            ) : null}
            {restaurant.status === "SUSPENDED" ? (
              <ActionButton label="Reactivate" loading={busy} onPress={() => void act((token) => reactivateAdminRestaurant(token, restaurant.id))} />
            ) : null}
          </ActionRow>
        </>
      )}
    </AdminPage>
  );
}

async function requireToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error("Your session has expired. Please log in again.");
  return token;
}
