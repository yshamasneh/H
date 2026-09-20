import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import i18n from "../i18n";
import { ensureDeliveryAlertChannel } from "./push-channels";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true
  })
});

/** `role` decides which Android channels exist: only drivers get the delivery-alert channel. */
export async function getPushToken(role?: string): Promise<string> {
  if (Platform.OS === "web") {
    throw new Error(i18n.t("common:pushWebUnsupported"));
  }
  if (!Device.isDevice) {
    throw new Error(i18n.t("common:pushRequiresDevice"));
  }
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("orders", {
      name: "Order updates",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250]
    });
    if (role === "DRIVER") await ensureDeliveryAlertChannel();
  }
  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.granted ? existing : await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error(i18n.t("common:pushPermissionDenied"));

  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    throw new Error(i18n.t("common:pushProjectIdMissing"));
  }
  const result = await Notifications.getExpoPushTokenAsync({ projectId });
  return result.data;
}

const pushTokenKey = "tasawaq.push-token";
const pushTokenOwnerKey = "tasawaq.push-token-owner";
const pushEnabledKey = "tasawaq.push-enabled";

export function getStoredPushToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return Promise.resolve(readWebToken(pushTokenKey));
  }
  return SecureStore.getItemAsync(pushTokenKey);
}

export function getStoredPushTokenOwner(): Promise<string | null> {
  if (Platform.OS === "web") {
    return Promise.resolve(readWebToken(pushTokenOwnerKey));
  }
  return SecureStore.getItemAsync(pushTokenOwnerKey);
}

export async function isPushNotificationsEnabled(): Promise<boolean> {
  const enabled = Platform.OS === "web"
    ? readWebToken(pushEnabledKey)
    : await SecureStore.getItemAsync(pushEnabledKey);
  if (enabled === "true") return true;

  // Existing installations predate the preference key. A stored token means the user had
  // explicitly enabled notifications, so preserve that choice and reconcile it after login.
  return Boolean(await getStoredPushToken());
}

export async function storePushToken(token: string, ownerUserId: string): Promise<void> {
  if (Platform.OS === "web") {
    writeWebToken(pushTokenKey, token);
    writeWebToken(pushTokenOwnerKey, ownerUserId);
    writeWebToken(pushEnabledKey, "true");
    return;
  }
  await Promise.all([
    SecureStore.setItemAsync(pushTokenKey, token),
    SecureStore.setItemAsync(pushTokenOwnerKey, ownerUserId),
    SecureStore.setItemAsync(pushEnabledKey, "true")
  ]);
}

export async function clearStoredPushTokenAssociation(): Promise<void> {
  if (Platform.OS === "web") {
    deleteWebToken(pushTokenKey);
    deleteWebToken(pushTokenOwnerKey);
    return;
  }
  await Promise.all([
    SecureStore.deleteItemAsync(pushTokenKey),
    SecureStore.deleteItemAsync(pushTokenOwnerKey)
  ]);
}

/** Clears both the current account association and the user's device-level opt-in. */
export async function clearStoredPushToken(): Promise<void> {
  await clearStoredPushTokenAssociation();
  if (Platform.OS === "web") {
    deleteWebToken(pushEnabledKey);
    return;
  }
  await SecureStore.deleteItemAsync(pushEnabledKey);
}

function readWebToken(key: string): string | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(key);
}

function writeWebToken(key: string, value: string): void {
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(key, value);
}

function deleteWebToken(key: string): void {
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(key);
}
