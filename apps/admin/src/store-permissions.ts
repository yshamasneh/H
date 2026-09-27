import type { Permission } from "./api";

/**
 * Which business capability the admin console's store section offers an admin. Each one is
 * translated to the admin permission the matching `admin/restaurants/:id/*` route demands, so an
 * admin sub-role sees exactly what the server will let it do: managing a store at all needs
 * MANAGE_BUSINESSES, and changing its orders (or opening / closing it) also needs MANAGE_ALL_ORDERS.
 * Proposing an operating cost is a store's own act; an admin decides costs in Accounting instead,
 * so it is never offered here.
 */
export function adminCan(permission: Permission, canAdmin: (permission: Permission) => boolean): boolean {
  if (permission === "PROPOSE_OPERATING_COSTS") return false;
  if (!canAdmin("MANAGE_BUSINESSES")) return false;
  return permission === "MANAGE_ORDERS" ? canAdmin("MANAGE_ALL_ORDERS") : true;
}
