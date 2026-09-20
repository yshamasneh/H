import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/**
 * The driver delivery alert.
 *
 * A driver has to hear about a new delivery while driving or with the phone in a pocket, so it gets
 * a channel of its own: maximum importance (heads-up on screen), the JOVO sound, and a long
 * vibration. Both names below must match the API (apps/api/src/notifications/push-presentation.ts),
 * which addresses pushes to this channel — a mismatch does not fail loudly, the alert just plays
 * the default sound. The API test suite pins the two together.
 *
 * Android channels are immutable once created (the user owns their settings), which is why this is
 * a new channel rather than an edit of "orders", and why the sound file has to be in the binary
 * before the channel is first created. That is the reason this ships as a new native build.
 */
export const deliveryAlertChannelId = "delivery-alerts";
export const deliveryAlertSound = "jovo_delivery.wav";

/**
 * Played on the alarm audio stream rather than the notification stream: it stays audible when the
 * phone's notification volume is low and is not silenced by a phone left on a quiet ringer profile.
 * A driver who has opted into a shift and wants it quieter can still turn the channel down in
 * system settings. Switch to NOTIFICATION if this proves too insistent on a real device.
 */
const alertAudioUsage = Notifications.AndroidAudioUsage.ALARM;

export const deliveryAlertChannel: Notifications.NotificationChannelInput = {
  name: "Delivery alerts",
  description: "A new delivery is waiting for you to accept.",
  importance: Notifications.AndroidImportance.MAX,
  sound: deliveryAlertSound,
  audioAttributes: {
    usage: alertAudioUsage,
    contentType: Notifications.AndroidAudioContentType.SONIFICATION
  },
  vibrationPattern: [0, 600, 250, 600, 250, 900],
  enableVibrate: true,
  enableLights: true,
  lightColor: "#F45A00",
  lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  showBadge: true
};

/**
 * Creates the delivery-alert channel. Android only: iOS has no channels and takes the sound from
 * the push payload, which the API fills in. Safe to call repeatedly; Android ignores changes to an
 * existing channel, so the first creation is the one that counts.
 */
export async function ensureDeliveryAlertChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(deliveryAlertChannelId, deliveryAlertChannel);
}
