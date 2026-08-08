import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

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
    throw new Error("Push notifications are currently available in the Android and iOS apps.");
  }
  if (!Device.isDevice) {
    throw new Error("Push notifications require a physical device.");
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
  if (!permission.granted) throw new Error("Notification permission was not granted.");

  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    throw new Error("EAS project ID is required before push notifications can be enabled.");
  }
  const result = await Notifications.getExpoPushTokenAsync({ projectId });
  return result.data;
}

const pushTokenKey = "tasawaq.push-token";

export function getStoredPushToken(): Promise<string | null> {
  return SecureStore.getItemAsync(pushTokenKey);
}

export function storePushToken(token: string): Promise<void> {
  return SecureStore.setItemAsync(pushTokenKey, token);
}

export function clearStoredPushToken(): Promise<void> {
  return SecureStore.deleteItemAsync(pushTokenKey);
}
