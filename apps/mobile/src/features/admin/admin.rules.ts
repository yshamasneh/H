import type { OrderStatusValue } from "../../core/api";

export const cancellableAdminOrderStatuses: OrderStatusValue[] = [
  "PLACED",
  "ACCEPTED",
  "PREPARING",
  "READY_FOR_PICKUP"
];
