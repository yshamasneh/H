import type { AdminAccess, AdminUserAudience, UserRole } from "../../core/api";

/**
 * The admin Users screens, mirroring the admin web console (apps/admin/src/users-sections.ts):
 * customers and the staff who run the platform are two separate lists, never one mixed table.
 */

export const userSections = ["customers", "staff"] as const;
export type UserSection = (typeof userSections)[number];

/** Roles that can be picked inside the staff list. "ALL" = every staff role. */
export const staffRoleFilters = ["ALL", "RESTAURANT", "DRIVER", "ADMIN"] as const;
export type StaffRoleFilter = (typeof staffRoleFilters)[number];

export const usersPageSize = 20;

export type UsersListQuery = {
  audience: AdminUserAudience;
  role?: UserRole;
  search?: string;
  page: number;
  pageSize: number;
};

/** The list request for a section. A role filter only ever applies to the staff list. */
export function usersListQuery(
  section: UserSection,
  filters: { role?: string; search?: string; page: number; pageSize?: number }
): UsersListQuery {
  const search = filters.search?.trim() || undefined;
  const pageSize = filters.pageSize ?? usersPageSize;
  if (section === "customers") {
    return { audience: "CUSTOMERS", search, page: filters.page, pageSize };
  }
  const role =
    filters.role && filters.role !== "ALL" && (staffRoleFilters as readonly string[]).includes(filters.role)
      ? (filters.role as UserRole)
      : undefined;
  return { audience: "STAFF", role, search, page: filters.page, pageSize };
}

export function pageCount(total: number, pageSize: number = usersPageSize): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Same rule as the web console: a super admin holds every permission implicitly. */
export function hasAdminPermission(access: AdminAccess | null, permission: string): boolean {
  if (!access) return false;
  return access.isSuperAdmin || access.permissions.includes(permission);
}

/** A completed order is a DELIVERED one; only those count toward a customer's totals. */
export function countsTowardCustomerTotals(status: string): boolean {
  return status === "DELIVERED";
}

/**
 * Agorot as "116.18 ILS", built from integers only. `minor / 100` is a float, and a total shown to
 * an operator must never drift by an agora because of how a division happened to round.
 */
export function formatMinorExact(minor: number): string {
  if (!Number.isSafeInteger(minor)) throw new Error(`Amounts are whole agorot; received ${minor}`);
  const sign = minor < 0 ? "-" : "";
  const absolute = Math.abs(minor);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")} ILS`;
}

/** The create-admin form is ready once it has a name, a number and a password of 8+ characters. */
export function canSubmitNewAdmin(draft: { fullName: string; phoneNumber: string; password: string }): boolean {
  return Boolean(draft.fullName.trim()) && Boolean(draft.phoneNumber.trim()) && draft.password.length >= 8;
}
