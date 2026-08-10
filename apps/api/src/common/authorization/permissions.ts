/**
 * The platform's permission catalogue.
 *
 * Permissions are plain strings in the database, so adding one here and granting it to a role is a
 * data change rather than a migration. Keeping the catalogue in code as well gives compile-time
 * safety at every `@RequirePermission` call site.
 */

/** Permissions that apply across the whole platform. Held through `User.platformRoleId`. */
export const platformPermissions = [
  "MANAGE_BUSINESSES",
  "MANAGE_USERS",
  "MANAGE_ADMINS",
  "MANAGE_ROLES",
  "MANAGE_DRIVERS",
  "MANAGE_OFFERS",
  "VIEW_ACCOUNTING",
  "MANAGE_ACCOUNTING_SETTINGS",
  // Cross-business order monitoring, distinct from a business's own VIEW_ORDERS/MANAGE_ORDERS.
  "VIEW_ALL_ORDERS",
  "MANAGE_ALL_ORDERS"
] as const;

/** Permissions that apply inside one business. Held through a `BusinessMember` row. */
export const businessPermissions = [
  "MANAGE_PRODUCTS",
  "MANAGE_PRICES",
  "MANAGE_MENU",
  "MANAGE_INVENTORY",
  "VIEW_ORDERS",
  "MANAGE_ORDERS",
  "VIEW_SALES",
  "VIEW_REPORTS",
  "MANAGE_BUSINESS_SETTINGS",
  "MANAGE_BUSINESS_STAFF"
] as const;

/** Meaningful in both scopes: the platform sees every entry, a business sees only its own. */
export const sharedPermissions = ["VIEW_AUDIT_LOG"] as const;

export const allPermissions = [...platformPermissions, ...businessPermissions, ...sharedPermissions] as const;

export type PlatformPermission = (typeof platformPermissions)[number];
export type BusinessPermission = (typeof businessPermissions)[number];
export type SharedPermission = (typeof sharedPermissions)[number];
export type Permission = PlatformPermission | BusinessPermission | SharedPermission;

export const systemRoleKeys = {
  superAdmin: "SUPER_ADMIN",
  businessAdmin: "BUSINESS_ADMIN",
  businessStaff: "BUSINESS_STAFF"
} as const;

export type SystemRoleKey = (typeof systemRoleKeys)[keyof typeof systemRoleKeys];

/**
 * SUPER_ADMIN is deliberately absent from this map. It holds every permission implicitly (see
 * `hasPermission`), so a permission added to the catalogue later never has to be granted to it
 * by hand — and can never be accidentally missed.
 */
export const systemRolePermissions: Record<
  Exclude<SystemRoleKey, "SUPER_ADMIN">,
  readonly Permission[]
> = {
  BUSINESS_ADMIN: [
    "MANAGE_PRODUCTS",
    "MANAGE_PRICES",
    "MANAGE_MENU",
    "MANAGE_INVENTORY",
    "VIEW_ORDERS",
    "MANAGE_ORDERS",
    "VIEW_SALES",
    "VIEW_REPORTS",
    "MANAGE_BUSINESS_SETTINGS",
    "MANAGE_BUSINESS_STAFF",
    "VIEW_AUDIT_LOG"
  ],
  // Daily operations only: no pricing, no catalogue, no settings.
  BUSINESS_STAFF: ["VIEW_ORDERS", "MANAGE_ORDERS", "VIEW_SALES"]
};

export function isPermission(value: string): value is Permission {
  return (allPermissions as readonly string[]).includes(value);
}
