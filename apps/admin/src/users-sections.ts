/**
 * The Users screen is two lists, not one: customers who buy, and the staff and administrators who
 * run the platform. Each has its own filters and actions, so they are never mixed in one table.
 */

export const userSections = ["customers", "staff"] as const;
export type UserSection = (typeof userSections)[number];

/** Roles that can be picked inside the staff list. "" = every staff role. */
export const staffRoleOptions = ["", "RESTAURANT", "DRIVER", "ADMIN"] as const;

/** The section named in the URL, defaulting to customers for anything unrecognised. */
export function parseUserSection(value: string | null | undefined): UserSection {
  return value === "staff" ? "staff" : "customers";
}

export type UsersListQuery = {
  audience: "CUSTOMERS" | "STAFF";
  role?: string;
  search?: string;
  page: number;
  pageSize: number;
};

/** The list request for a section. A role filter only ever applies to the staff list. */
export function usersListQuery(
  section: UserSection,
  filters: { role?: string; search?: string; page: number; pageSize: number }
): UsersListQuery {
  const search = filters.search?.trim() || undefined;
  if (section === "customers") {
    return { audience: "CUSTOMERS", search, page: filters.page, pageSize: filters.pageSize };
  }
  const role = (staffRoleOptions as readonly string[]).includes(filters.role ?? "") ? filters.role || undefined : undefined;
  return { audience: "STAFF", role, search, page: filters.page, pageSize: filters.pageSize };
}

export function customerDetailPath(userId: string): string {
  return `/users/customers/${encodeURIComponent(userId)}`;
}

/** A completed order is a DELIVERED one; only those count toward a customer's totals. */
export function countsTowardCustomerTotals(status: string): boolean {
  return status === "DELIVERED";
}
