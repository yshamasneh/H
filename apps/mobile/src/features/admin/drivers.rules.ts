import type { AdminDriver } from "../../core/api";
import { normalizeSearch } from "../restaurant/product-search";

/**
 * Driver management rules for the phone — the twin of the admin console's drivers-view.ts: the
 * filters, the search, and the API's password rule (checked here so the message sits next to the
 * field). Kept free of React so it is tested directly.
 */

export type DriverFilter = "ALL" | "ONLINE" | "APPROVED" | "SUSPENDED" | "PENDING" | "REJECTED";
export const driverFilters: DriverFilter[] = ["ALL", "ONLINE", "APPROVED", "SUSPENDED", "PENDING", "REJECTED"];

export function matchesDriverFilter(driver: Pick<AdminDriver, "status" | "isOnline">, filter: DriverFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "ONLINE") return driver.status === "APPROVED" && driver.isOnline;
  return driver.status === filter;
}

/** Name words in any order (Arabic-aware), or digits of the phone (a leading 0 is fine). */
export function matchesDriverSearch(driver: Pick<AdminDriver, "fullName" | "phone">, search: string): boolean {
  const query = normalizeSearch(search);
  if (!query) return true;
  const compact = query.replace(/[\s+-]/g, "");
  if (/^\d{3,}$/.test(compact)) {
    const phoneDigits = driver.phone.replace(/\D/g, "");
    return phoneDigits.includes(compact) || phoneDigits.includes(compact.replace(/^0/, ""));
  }
  const name = normalizeSearch(driver.fullName);
  return query.split(/\s+/).every((word) => name.includes(word));
}

/** On shift first, then approved, then awaiting approval, then the rest — each by name. */
export function selectDrivers<T extends AdminDriver>(drivers: T[], filter: DriverFilter, search: string): T[] {
  const rank = (driver: T) =>
    driver.status === "APPROVED" && driver.isOnline ? 0 : driver.status === "APPROVED" ? 1 : driver.status === "PENDING" ? 2 : 3;
  return drivers
    .filter((driver) => matchesDriverFilter(driver, filter) && matchesDriverSearch(driver, search))
    .sort((left, right) => rank(left) - rank(right) || left.fullName.localeCompare(right.fullName));
}

/** Pending and rejected only exist for applications made before admin-created accounts. */
export function visibleDriverFilters(drivers: AdminDriver[], current: DriverFilter): DriverFilter[] {
  return driverFilters.filter(
    (filter) =>
      (filter !== "PENDING" && filter !== "REJECTED") || filter === current || drivers.some((driver) => driver.status === filter)
  );
}

/** The API's password rule (apps/api/src/auth/auth.dto.ts strongPasswordPattern). */
const strongPasswordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,72}$/;

export function isStrongPassword(password: string): boolean {
  return strongPasswordPattern.test(password);
}

/** A 12-character password without look-alike characters that always meets the rule. */
export function generateDriverPassword(random: (max: number) => number = (max) => Math.floor(Math.random() * max)): string {
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "@#$%&*!?";
  const pick = (set: string) => set[random(set.length)];
  const characters = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (characters.length < 12) characters.push(pick(lower + upper + digits));
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = random(index + 1);
    [characters[index], characters[swap]] = [characters[swap], characters[index]];
  }
  return characters.join("");
}

/** A stored "+970599…" number as the local digits the sign-in form takes ("0599…"). */
export function splitDriverPhone(phone: string): { countryCode: "+970" | "+972"; phoneNumber: string } {
  const match = /^\+(970|972)(\d+)$/.exec(phone);
  return match
    ? { countryCode: `+${match[1]}` as "+970" | "+972", phoneNumber: `0${match[2]}` }
    : { countryCode: "+970", phoneNumber: phone };
}
