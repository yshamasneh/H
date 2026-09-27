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
/**
 * The store's new-order alert: ORDER_PLACED goes only to the business's members, and with the app
 * closed this push is the only way the shop hears the order, so it carries the same JOVO order sound
 * the app plays in the foreground. Both names are duplicated in apps/mobile/src/core/push-channels.ts.
 * The channel and the sound file exist only in binaries from storeOrderAlertMinVersion on; an older
 * build keeps the ordinary "orders" channel (a push to a channel the phone never created falls back
 * to Expo's low-importance "Miscellaneous" channel, which is worse than today's behaviour).
 */
export const storeOrderChannelId = "store-orders";
export const storeOrderSound = "jovo_order.wav";
export const storeOrderAlertMinVersion = "0.17.0";
/** A "delivery available" alert that has not reached the phone within this window is stale. */
export const deliveryAlertTtlSeconds = 120;

export type PushPlatform = "android" | "ios" | "web" | string;

export type PushPresentation = {
  sound: string;
  channelId?: string;
  ttl?: number;
};

export function pushPresentation(type: NotificationType, platform: PushPlatform, appVersion?: string | null): PushPresentation {
  if (type === "ORDER_PLACED" && isAtLeast(appVersion, storeOrderAlertMinVersion)) {
    // As for drivers: Android takes the sound from the channel, iOS from the named file.
    return { sound: platform === "ios" ? storeOrderSound : "default", channelId: storeOrderChannelId };
  }
  if (type !== "DELIVERY_AVAILABLE") return { sound: "default", channelId: orderUpdatesChannelId };
  return {
    // Android 8+ takes the sound from the channel and ignores a per-message custom sound, so only
    // iOS is told the file name; Android is pointed at the channel that owns the sound.
    sound: platform === "ios" ? deliveryAlertSound : "default",
    channelId: deliveryAlertChannelId,
    ttl: deliveryAlertTtlSeconds
  };
}

/** Compares dotted numeric versions ("0.17.0"); a missing or malformed version is never "at least". */
export function isAtLeast(version: string | null | undefined, minimum: string): boolean {
  const parse = (value: string) => (/^\d+(\.\d+)*$/.test(value) ? value.split(".").map(Number) : null);
  const actual = version ? parse(version) : null;
  const floor = parse(minimum);
  if (!actual || !floor) return false;
  for (let index = 0; index < Math.max(actual.length, floor.length); index += 1) {
    const difference = (actual[index] ?? 0) - (floor[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}
