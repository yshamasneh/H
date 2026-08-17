import { RestaurantStatus } from "../generated/prisma/client";

export const restaurantModerationTransitions: Record<"suspend" | "reactivate", RestaurantStatus> = {
  suspend: RestaurantStatus.APPROVED,
  reactivate: RestaurantStatus.SUSPENDED
};

const timeOfDayPattern = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True when "HH:mm" (24h) is a valid time of day. */
export function isValidTimeOfDay(value: string): boolean {
  return timeOfDayPattern.test(value);
}

function minutesInDay(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Whether `now` falls inside a store's weekly opening window. A store with no
 * schedule (either bound null) is never time-restricted, so this returns true
 * and openness is left entirely to the manual `isOpen` switch. A window whose
 * close is earlier than its open is treated as spanning midnight
 * (e.g. 18:00–02:00). An empty window (open === close) is always closed.
 */
export function isWithinWeeklyHours(opensAt: string | null, closesAt: string | null, now: Date): boolean {
  if (!opensAt || !closesAt) return true;
  const current = now.getHours() * 60 + now.getMinutes();
  const open = minutesInDay(opensAt);
  const close = minutesInDay(closesAt);
  if (open === close) return false;
  if (open < close) return current >= open && current < close;
  return current >= open || current < close;
}
