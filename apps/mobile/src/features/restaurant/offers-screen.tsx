import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchAdminAccess,
  listRestaurantMenuCategories,
  listRestaurantMenuItems,
  updateRestaurantMenuItem,
  type AdminAccess
} from "../../core/api";
import { getAccessToken } from "../../core/session";
import i18n from "../../i18n";
import { hasAdminPermission } from "../admin/users.rules";
import { ProductOffersScreen, type ProductOffersApi } from "../shared/product-offers-screen";

async function requireToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error(i18n.t("common:sessionExpired"));
  return token;
}

/**
 * The store manager's own product offers: the store's catalogue from /restaurant/me/menu/*, and an
 * offer price saved through the same product update the catalogue screen uses. Setting a price
 * needs both MANAGE_PRODUCTS and MANAGE_PRICES — exactly what the API checks — so staff without
 * them see the offers read-only instead of a button the server would refuse.
 */
export function RestaurantOffersScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation(["admin"]);
  const [access, setAccess] = useState<AdminAccess | "failed" | null>(null);

  useEffect(() => {
    let cancelled = false;
    requireToken()
      .then(fetchAdminAccess)
      .then((result) => !cancelled && setAccess(result))
      .catch(() => !cancelled && setAccess("failed"));
    return () => {
      cancelled = true;
    };
  }, []);

  const api = useMemo<ProductOffersApi>(
    () => ({
      listCategories: async () => listRestaurantMenuCategories(await requireToken()),
      listItems: async () => listRestaurantMenuItems(await requireToken()),
      updateItem: async (itemId, body) => updateRestaurantMenuItem(await requireToken(), itemId, body)
    }),
    []
  );
  // If the access check itself failed, editing is offered and the server decides (as elsewhere).
  const canEdit =
    access === "failed" ||
    (access !== null && hasAdminPermission(access, "MANAGE_PRODUCTS") && hasAdminPermission(access, "MANAGE_PRICES"));

  return (
    <ProductOffersScreen
      api={access === null ? null : api}
      canEdit={canEdit}
      onBack={onBack}
      storeKey="me"
      subtitle={t("admin:productOffers.storeSubtitle")}
      title={t("admin:productOffers.title")}
    />
  );
}
