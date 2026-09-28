import type { AdminDriverView } from "./api";
import { normalizeSearch } from "./catalogue-view";

/**
 * The rules behind the driver management screens: which drivers a filter shows, how the search
 * matches, and the password rule a new driver account must meet (the API's own rule, checked here
 * so the message sits next to the field instead of after a round trip).
 */

export type DriverFilter = "all" | "onShift" | "active" | "suspended" | "pending" | "rejected";
export const driverFilters: DriverFilter[] = ["all", "onShift", "active", "suspended", "pending", "rejected"];

export function matchesDriverFilter(driver: Pick<AdminDriverView, "status" | "isOnline">, filter: DriverFilter): boolean {
  switch (filter) {
    case "onShift":
      return driver.status === "APPROVED" && driver.isOnline;
    case "active":
      return driver.status === "APPROVED";
    case "suspended":
      return driver.status === "SUSPENDED";
    case "pending":
      return driver.status === "PENDING";
    case "rejected":
      return driver.status === "REJECTED";
    default:
      return true;
  }
}

/** Name words in any order (Arabic-aware), or any run of digits from the phone number. */
export function matchesDriverSearch(driver: Pick<AdminDriverView, "fullName" | "phone">, search: string): boolean {
  const query = normalizeSearch(search);
  if (!query) return true;
  const digits = query.replace(/\D/g, "");
  // A local number typed with its leading 0 ("0599…") still matches the stored "+970599…".
  if (digits.length >= 3 && digits.length === query.replace(/[\s+-]/g, "").length) {
    const phoneDigits = driver.phone.replace(/\D/g, "");
    return phoneDigits.includes(digits) || phoneDigits.includes(digits.replace(/^0/, ""));
  }
  const name = normalizeSearch(driver.fullName);
  return query.split(/\s+/).every((word) => name.includes(word));
}

/**
 * Drivers to show: matching the filter and search, with drivers on shift first, then approved,
 * then the rest, each group by name.
 */
export function selectDrivers<T extends AdminDriverView>(drivers: T[], filter: DriverFilter, search: string): T[] {
  const rank = (driver: T) => (driver.status === "APPROVED" && driver.isOnline ? 0 : driver.status === "APPROVED" ? 1 : driver.status === "PENDING" ? 2 : 3);
  return drivers
    .filter((driver) => matchesDriverFilter(driver, filter) && matchesDriverSearch(driver, search))
    .sort((left, right) => rank(left) - rank(right) || left.fullName.localeCompare(right.fullName));
}

export function driverFilterCounts(drivers: AdminDriverView[]): Record<DriverFilter, number> {
  return Object.fromEntries(
    driverFilters.map((filter) => [filter, drivers.filter((driver) => matchesDriverFilter(driver, filter)).length])
  ) as Record<DriverFilter, number>;
}

/** The API's password rule (apps/api/src/auth/auth.dto.ts strongPasswordPattern). */
export const strongPasswordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,72}$/;

export function isStrongPassword(password: string): boolean {
  return strongPasswordPattern.test(password);
}

/**
 * A password the administrator can read out or send to the driver: 12 characters from sets without
 * look-alikes (no 0/O, 1/l/I), always meeting the strong-password rule.
 */
export function generateDriverPassword(random: (max: number) => number = cryptoRandom): string {
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "@#$%&*!?";
  const all = lower + upper + digits;
  const pick = (set: string) => set[random(set.length)];
  const characters = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (characters.length < 12) characters.push(pick(all));
  // Shuffle so the required characters are not always at the front.
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = random(index + 1);
    [characters[index], characters[swap]] = [characters[swap], characters[index]];
  }
  return characters.join("");
}

function cryptoRandom(max: number): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0] % max;
}
