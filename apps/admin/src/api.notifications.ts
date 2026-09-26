import { request } from "./api";

export const broadcastAudiences = ["CUSTOMER", "DRIVER", "RESTAURANT"] as const;
export type BroadcastAudience = (typeof broadcastAudiences)[number];

export type BroadcastNotificationBody = {
  audience: BroadcastAudience;
  title: string;
  body: string;
};

export type BroadcastResult = { recipients: number };

/** The manual broadcast tool. The server guards this with the ADMIN role and MANAGE_NOTIFICATIONS. */
export const sendBroadcast = (body: BroadcastNotificationBody) =>
  request<BroadcastResult>("/api/v1/admin/notifications/broadcast", { method: "POST", body });
