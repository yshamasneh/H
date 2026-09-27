import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { Permission } from "./api";
import { adminStoreApi, ownStoreApi, type BusinessType, type StoreApi } from "./api.business";
import { useAuth } from "./auth";
import { adminCan } from "./store-permissions";

/**
 * The store workspace a page is running in: which API it calls, what it may offer, and where its
 * sibling pages live.
 *
 * The same pages (live orders, an order's packing screen, stock, reports, staff) serve two callers:
 * the store's own business shell under `/business`, acting on `/restaurant/me/*`, and a platform
 * admin managing a store from the admin console under `/restaurants/:id`, acting on
 * `admin/restaurants/:id/*`. Only this context differs between the two, so the experience cannot
 * drift apart. The API authorises every call either way; `can` only decides what is worth showing.
 */
export type StoreWorkspace = {
  api: StoreApi;
  can: (permission: Permission) => boolean;
  business: { id: string; name: string; businessType: BusinessType } | null;
  /** Route prefix of this workspace's pages: `/business`, or `/restaurants/:id` in the admin console. */
  basePath: string;
  /** The live order board: the business shell's home page, or the store section's Orders tab. */
  boardPath: string;
  /** Re-reads the store's own record (e.g. its open flag) after the workspace changed it. */
  refreshBusiness: () => Promise<void>;
};

const StoreWorkspaceContext = createContext<StoreWorkspace | null>(null);

export function useStoreWorkspace(): StoreWorkspace {
  const workspace = useContext(StoreWorkspaceContext);
  if (!workspace) throw new Error("useStoreWorkspace must be used inside a store workspace provider");
  return workspace;
}

/** The business shell: the signed-in member's own store, with their own business permissions. */
export function OwnStoreWorkspaceProvider({ children }: { children: ReactNode }) {
  const { can, access, refreshAccess } = useAuth();
  const business = access?.business ?? null;
  const value = useMemo<StoreWorkspace>(
    () => ({
      api: ownStoreApi,
      can,
      business: business ? { id: business.id, name: business.name, businessType: business.businessType } : null,
      basePath: "/business",
      boardPath: "/business",
      refreshBusiness: refreshAccess
    }),
    [can, business, refreshAccess]
  );
  return <StoreWorkspaceContext.Provider value={value}>{children}</StoreWorkspaceContext.Provider>;
}

/** The admin console's store section, with business permissions translated by `adminCan`. */
export function AdminStoreWorkspaceProvider(props: {
  business: { id: string; name: string; businessType: BusinessType };
  refreshBusiness: () => Promise<void>;
  children: ReactNode;
}) {
  const { can: canAdmin } = useAuth();
  const { business, refreshBusiness } = props;
  const can = useCallback((permission: Permission) => adminCan(permission, canAdmin), [canAdmin]);
  const value = useMemo<StoreWorkspace>(
    () => ({
      api: adminStoreApi(business.id),
      can,
      business,
      basePath: `/restaurants/${business.id}`,
      boardPath: `/restaurants/${business.id}/orders`,
      refreshBusiness
    }),
    [business, can, refreshBusiness]
  );
  return <StoreWorkspaceContext.Provider value={value}>{props.children}</StoreWorkspaceContext.Provider>;
}
