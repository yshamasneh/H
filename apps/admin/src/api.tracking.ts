import { request } from "./api";
import type { TrackedDeliveryStatus, TrackedDriver } from "./driver-tracking";

/**
 * Live driver tracking. Positions are read here on load and after a reconnect; between those, the
 * socket's `driver.location.updated` events carry each new position (see socket.ts and
 * driver-tracking.ts), so the map moves without polling.
 */

export type OrderTracking = {
  orderId: string;
  deliveryId: string | null;
  deliveryStatus: TrackedDeliveryStatus | null;
  driver: TrackedDriver | null;
  pickup: { name: string; latitude: number | null; longitude: number | null } | null;
  destination: { label: string; latitude: number | null; longitude: number | null };
};

export function listDriverLocations(): Promise<TrackedDriver[]> {
  return request("/api/v1/admin/drivers/locations");
}

export function getOrderTracking(orderId: string): Promise<OrderTracking> {
  return request(`/api/v1/admin/drivers/tracking/orders/${orderId}`);
}
