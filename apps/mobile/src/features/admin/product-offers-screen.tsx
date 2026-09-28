import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import {
  fetchAdminAccess,
  listAdminRestaurants,
  listAdminStoreMenuCategories,
  listAdminStoreMenuItems,
  updateAdminStoreMenuItem,
  type AdminAccess,
  type AdminRestaurant
} from "../../core/api";
import { getAccessToken } from "../../core/session";
import i18n from "../../i18n";
import { ProductOffersScreen, type ProductOffersApi } from "../shared/product-offers-screen";
import { EmptyState, ErrorBanner, FilterChips, LoadingState, readAdminError } from "./ui";
import { hasAdminPermission } from "./users.rules";

async function requireToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error(i18n.t("common:sessionExpired"));
  return token;
}

/** Every approved store, a page at a time (the list endpoint is paged). */
async function listApprovedStores(token: string): Promise<AdminRestaurant[]> {
  const stores: AdminRestaurant[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await listAdminRestaurants(token, { status: "APPROVED", page, pageSize: 50 });
    stores.push(...result.items);
    if (stores.length >= result.total || result.items.length === 0) break;
  }
  return stores;
}

/** Supermarkets first (that is where product offers live), then by name. */
export function orderStoresForOffers(stores: AdminRestaurant[]): AdminRestaurant[] {
  return [...stores].sort((left, right) => {
    const leftMarket = left.businessType === "SUPERMARKET" ? 0 : 1;
    const rightMarket = right.businessType === "SUPERMARKET" ? 0 : 1;
    return leftMarket - rightMarket || left.name.localeCompare(right.name);
  });
}

/**
 * Product offers for any approved store, for an administrator on the phone. The same screen as the
 * store manager's, pointed at /admin/restaurants/:id/menu/*; changing a store's catalogue is the
 * MANAGE_BUSINESSES permission, as on the web console.
 */
export function AdminProductOffersScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation(["admin"]);
  const [access, setAccess] = useState<AdminAccess | "failed" | null>(null);
  const [stores, setStores] = useState<AdminRestaurant[] | null>(null);
  const [storeId, setStoreId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    requireToken()
      .then(fetchAdminAccess)
      .then((result) => !cancelled && setAccess(result))
      .catch(() => !cancelled && setAccess("failed"));
    requireToken()
      .then(listApprovedStores)
      .then((all) => {
        if (cancelled) return;
        const ordered = orderStoresForOffers(all);
        setStores(ordered);
        setStoreId((current) => current || ordered[0]?.id || "");
      })
      .catch((caught) => !cancelled && setError(readAdminError(caught)));
    return () => {
      cancelled = true;
    };
  }, []);

  const api = useMemo<ProductOffersApi | null>(
    () =>
      storeId
        ? {
            listCategories: async () => listAdminStoreMenuCategories(await requireToken(), storeId),
            listItems: async () => listAdminStoreMenuItems(await requireToken(), storeId),
            updateItem: async (itemId, body) => updateAdminStoreMenuItem(await requireToken(), storeId, itemId, body)
          }
        : null,
    [storeId]
  );
  const canEdit = access === "failed" || (access !== null && hasAdminPermission(access, "MANAGE_BUSINESSES"));

  const header = error ? (
    <ErrorBanner message={error} />
  ) : !stores ? (
    <LoadingState />
  ) : stores.length === 0 ? (
    <EmptyState message={t("admin:productOffers.noStores")} />
  ) : stores.length > 1 ? (
    <View>
      <FilterChips
        onChange={setStoreId}
        options={stores.map((store) => ({ value: store.id, label: store.name }))}
        value={storeId}
      />
    </View>
  ) : null;

  return (
    <ProductOffersScreen
      api={access === null ? null : api}
      canEdit={canEdit}
      header={header}
      onBack={onBack}
      storeKey={storeId}
      subtitle={t("admin:productOffers.adminSubtitle")}
      title={t("admin:productOffers.title")}
    />
  );
}
