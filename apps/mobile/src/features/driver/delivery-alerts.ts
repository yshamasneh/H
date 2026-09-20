import { Platform } from "react-native";
import { registerMyPushToken, type PublicUser } from "../../core/api";
import { readError } from "../../core/errors";
import { getPushToken, getStoredPushToken, getStoredPushTokenOwner, storePushToken } from "../../core/push-notifications";
import { getAccessToken } from "../../core/session";

/**
 * Turning on the driver's delivery alerts.
 *
 * Push is opt-in per installation (the Settings toggle), and a driver who never found that toggle
 * would never hear a delivery come in with the app closed. So going on shift offers it directly.
 * This does what the Settings toggle does — permission, Android channel with the JOVO sound, token
 * registration — for the current user, and reports rather than throws so the shift toggle is never
 * blocked by a denied permission.
 */
export type DeliveryAlertsResult = { ok: true } | { ok: false; message: string };

/** Web has no push registration path in this app, so alerts are a native-only concept. */
export const deliveryAlertsSupported = Platform.OS !== "web";

export async function areDeliveryAlertsEnabled(user: PublicUser): Promise<boolean> {
  if (!deliveryAlertsSupported) return false;
  const [token, owner] = await Promise.all([getStoredPushToken(), getStoredPushTokenOwner()]);
  return Boolean(token) && (!owner || owner === user.id);
}

export async function enableDeliveryAlerts(user: PublicUser): Promise<DeliveryAlertsResult> {
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) return { ok: false, message: "" };
    const token = await getPushToken(user.role);
    await registerMyPushToken(accessToken, token, Platform.OS === "ios" ? "ios" : "android");
    await storePushToken(token, user.id);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: readError(error) };
  }
}
