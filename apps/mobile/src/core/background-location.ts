import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import { Linking, Platform } from "react-native";
import i18n from "../i18n";
import { updateDriverLocation } from "./api";
import { getAccessToken } from "./session";
import {
  parseConsent,
  planBackgroundTracking,
  serializeConsent,
  type BackgroundPermission,
  type BackgroundPlan
} from "./tracking/location-consent";
import { TrackingController } from "./tracking/tracking-controller";
import { createTrackingReporter, type LocationFix } from "./tracking/tracking-reporter";

/**
 * Background location, for one purpose: while a delivery is active, dispatch keeps seeing where it
 * is even when the driver has handed the trip to a navigation app and JOVO is in the background.
 *
 * It is never on while there is no active delivery. The rules live in tracking/ (pure and tested);
 * this file is the thin Expo layer: the OS task, the permission prompts, and the stored consent.
 * Native only. On web every function here is a no-op.
 */

export const deliveryTrackingTask = "jovo-delivery-tracking";
const consentKey = "jovo.background-location-consent";

const isNative = Platform.OS === "android" || Platform.OS === "ios";

const reportFixes = createTrackingReporter({
  getAccessToken,
  send: (accessToken, latitude, longitude) => updateDriverLocation(accessToken, latitude, longitude),
  stopTracking: () => stopDeliveryTracking()
});

/**
 * The task body. It must be defined at module load, in the app entry, because the OS can start it
 * with no screen mounted at all (the driver is in another app). index.ts imports this file first.
 */
if (isNative && !TaskManager.isTaskDefined(deliveryTrackingTask)) {
  TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(deliveryTrackingTask, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    const fixes: LocationFix[] = data.locations.map((location) => ({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      timestamp: location.timestamp
    }));
    await reportFixes(fixes);
  });
}

async function startDeliveryTracking(): Promise<void> {
  if (!isNative) return;
  if (await Location.hasStartedLocationUpdatesAsync(deliveryTrackingTask).catch(() => false)) return;
  const permission = await Location.getBackgroundPermissionsAsync();
  // Never prompts here: the disclosure has to come first, and only the driver's own action shows it.
  if (permission.status !== Location.PermissionStatus.GRANTED) throw new Error("background location not granted");
  await Location.startLocationUpdatesAsync(deliveryTrackingTask, {
    accuracy: Location.Accuracy.High,
    timeInterval: 10_000,
    distanceInterval: 30,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    // iOS shows the blue "JOVO is using your location" bar while this runs.
    showsBackgroundLocationIndicator: true,
    // Android requires a visible notification for as long as location is collected in the background.
    foregroundService: {
      notificationTitle: i18n.t("driver:tracking.notificationTitle"),
      notificationBody: i18n.t("driver:tracking.notificationBody"),
      notificationColor: "#F45A00"
    }
  });
}

export async function stopDeliveryTracking(): Promise<void> {
  if (!isNative) return;
  if (await Location.hasStartedLocationUpdatesAsync(deliveryTrackingTask).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(deliveryTrackingTask);
  }
}

/** One controller for the whole app, so two screens asking at once cannot start it twice or stop it early. */
export const trackingController = new TrackingController({
  start: startDeliveryTracking,
  stop: stopDeliveryTracking,
  schedule: (run, delayMs) => setTimeout(run, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
});

// ---- permission and consent -------------------------------------------------------------------------

async function readConsent() {
  return parseConsent(await SecureStore.getItemAsync(consentKey).catch(() => null));
}

export async function recordConsent(decision: "accepted" | "declined"): Promise<void> {
  await SecureStore.setItemAsync(consentKey, serializeConsent(decision, new Date())).catch(() => undefined);
}

async function backgroundPermission(): Promise<BackgroundPermission> {
  if (!isNative) return "denied";
  const permission = await Location.getBackgroundPermissionsAsync();
  if (permission.status === Location.PermissionStatus.GRANTED) return "granted";
  return permission.canAskAgain ? "undetermined" : "denied";
}

/** What the app should do next about background tracking, from the stored consent and the OS permission. */
export async function currentBackgroundPlan(): Promise<BackgroundPlan> {
  if (!isNative) return "foreground-only";
  return planBackgroundTracking({ consent: await readConsent(), permission: await backgroundPermission() });
}

/**
 * The system prompts, run only after the driver has accepted the in-app disclosure.
 * Foreground first (a prerequisite on both platforms), then "all the time". On Android 11 and later
 * the second step opens the system settings page rather than showing a dialog.
 */
export async function requestBackgroundPermission(): Promise<boolean> {
  if (!isNative) return false;
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== Location.PermissionStatus.GRANTED) return false;
  const background = await Location.requestBackgroundPermissionsAsync();
  return background.status === Location.PermissionStatus.GRANTED;
}

export function openLocationSettings(): Promise<void> {
  return Linking.openSettings().catch(() => undefined);
}
