import * as Location from "expo-location";
import i18n from "../i18n";
import { reverseGeocodeOnline } from "./geocode";

export type CurrentCoordinates = {
  latitude: number;
  longitude: number;
};

// A high-accuracy fix indoors can take half a minute or never arrive; the customer must not sit on
// a spinner that long. After this the app settles for the best fix it can get quickly.
const highAccuracyTimeoutMs = 10_000;
const fallbackTimeoutMs = 8_000;
// A fix this recent and this tight is as good as a fresh one and returns instantly.
const recentFixMaxAgeMs = 60_000;
const recentFixRequiredAccuracyMeters = 100;

function toCoordinates(position: Location.LocationObject): CurrentCoordinates {
  return { latitude: position.coords.latitude, longitude: position.coords.longitude };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("location-timeout")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

async function lastKnown(options: Location.LocationLastKnownOptions): Promise<Location.LocationObject | null> {
  try {
    return await Location.getLastKnownPositionAsync(options);
  } catch {
    // Not implemented on every platform (web); a missing cache is not an error.
    return null;
  }
}

/**
 * The device's position for "use my current location". Fast path first: a recent, accurate cached
 * fix returns immediately. Otherwise a high-accuracy fix with a hard timeout, then progressively
 * looser fallbacks, so the button always resolves in bounded time with the best fix available.
 */
export async function getCurrentCoordinates(): Promise<CurrentCoordinates> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    throw new Error(i18n.t("common:locationPermissionRequired"));
  }

  const recent = await lastKnown({ maxAge: recentFixMaxAgeMs, requiredAccuracy: recentFixRequiredAccuracyMeters });
  if (recent) return toCoordinates(recent);

  try {
    return toCoordinates(
      await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), highAccuracyTimeoutMs)
    );
  } catch {
    const stale = await lastKnown({});
    try {
      return toCoordinates(
        await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), fallbackTimeoutMs)
      );
    } catch (error) {
      if (stale) return toCoordinates(stale);
      throw new Error(i18n.t("common:locationUnavailable"), { cause: error });
    }
  }
}

/**
 * A starting point for a map, read WITHOUT prompting. Only returns something when location
 * permission was already granted and the device has a recent fix; otherwise null and the map keeps
 * its default centre. This is what stops a first-time customer opening a map centred on some other
 * town, without throwing a permission dialog at them before they asked for anything.
 */
export async function getPassiveCoordinates(): Promise<CurrentCoordinates | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== Location.PermissionStatus.GRANTED) return null;
    const position = await lastKnown({ maxAge: 5 * 60_000 });
    return position ? toCoordinates(position) : null;
  } catch {
    return null;
  }
}

/**
 * A readable address for a point, or null. Tries the platform geocoder first (fast and offline-ish
 * on iOS/most Android), then an OpenStreetMap lookup — which is the only path on web, where the
 * platform geocoder does not exist. Never throws.
 */
export async function reverseGeocode(coordinates: CurrentCoordinates): Promise<string | null> {
  try {
    const [address] = await Location.reverseGeocodeAsync(coordinates);
    if (address) {
      const line = [address.street, address.name, address.district, address.city, address.region]
        .filter((part, index, parts): part is string => Boolean(part) && parts.indexOf(part) === index)
        .join(", ");
      if (line) return line;
    }
  } catch {
    // Unsupported on web and unavailable without Play services on some Android devices: fall through.
  }
  return reverseGeocodeOnline(coordinates, i18n.language?.startsWith("en") ? "en" : "ar");
}

export async function watchCurrentCoordinates(
  onCoordinate: (coordinate: CurrentCoordinates) => void
): Promise<Location.LocationSubscription> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    throw new Error(i18n.t("common:locationPermissionRequiredDelivery"));
  }
  return Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, distanceInterval: 30, timeInterval: 10_000 },
    (position) => onCoordinate({ latitude: position.coords.latitude, longitude: position.coords.longitude })
  );
}
