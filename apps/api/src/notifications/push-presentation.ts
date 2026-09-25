import type { NotificationType } from "../generated/prisma/client";

/**
 * How a push is presented on the device, decided per notification type.
 *
 * The delivery alert is the one notification a driver must not miss while driving or with the phone
 * in a pocket, so it gets its own Android channel (max importance, JOVO sound) and its own iOS sound
 * file. Both names are duplicated in the mobile app (apps/mobile/src/core/push-channels.ts) because
 * the device has to create the channel before the first push arrives; a mismatch does not fail, it
 * silently falls back to the default sound, so push-presentation.test.ts pins the two together.
 */
export const deliveryAlertChannelId = "delivery-alerts";
export const deliveryAlertSound = "jovo_delivery.wav";
/**
 * The Android channel every other notification is sent to. The app creates it (high importance, so
 * a new-order or order-status push is shown as a heads-up rather than sitting silently in the tray);
 * without naming it, Android files the push under Expo's fallback channel and the app's own channel
 * is never used.
 */
export const orderUpdatesChannelId = "orders";
/** A "delivery available" alert that has not reached the phone within this window is stale. */
export const deliveryAlertTtlSeconds = 120;

export type PushPlatform = "android" | "ios" | "web" | string;

export type PushPresentation = {
  sound: string;
  channelId?: string;
  ttl?: number;
};

export function pushPresentation(type: NotificationType, platform: PushPlatform): PushPresentation {
  if (type !== "DELIVERY_AVAILABLE") return { sound: "default", channelId: orderUpdatesChannelId };
  return {
    // Android 8+ takes the sound from the channel and ignores a per-message custom sound, so only
    // iOS is told the file name; Android is pointed at the channel that owns the sound.
    sound: platform === "ios" ? deliveryAlertSound : "default",
    channelId: deliveryAlertChannelId,
    ttl: deliveryAlertTtlSeconds
  };
}
