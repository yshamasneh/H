import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import i18n from "../i18n";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true
  })
});

export async function getPushToken(): Promise<string> {
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

export function getStoredPushToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return Promise.resolve(readWebToken(pushTokenKey));
  }
  return SecureStore.getItemAsync(pushTokenKey);
}

export function storePushToken(token: string): Promise<void> {
  if (Platform.OS === "web") {
    writeWebToken(pushTokenKey, token);
    return Promise.resolve();
  }
  return SecureStore.setItemAsync(pushTokenKey, token);
}

export function clearStoredPushToken(): Promise<void> {
  if (Platform.OS === "web") {
    deleteWebToken(pushTokenKey);
    return Promise.resolve();
  }
  return SecureStore.deleteItemAsync(pushTokenKey);
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
