import * as Location from "expo-location";

export type CurrentCoordinates = {
  latitude: number;
  longitude: number;
};

export async function getCurrentCoordinates(): Promise<CurrentCoordinates> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    throw new Error("Location permission is required to calculate delivery availability and price.");
  }

  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude
  };
}

export async function reverseGeocode(coordinates: CurrentCoordinates): Promise<string | null> {
  const [address] = await Location.reverseGeocodeAsync(coordinates);
  if (!address) return null;
  return [address.street, address.name, address.district, address.city, address.region]
    .filter((part, index, parts): part is string => Boolean(part) && parts.indexOf(part) === index)
    .join(", ") || null;
}

export async function watchCurrentCoordinates(
  onCoordinate: (coordinate: CurrentCoordinates) => void
): Promise<Location.LocationSubscription> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    throw new Error("Location permission is required while you are handling an active delivery.");
  }
  return Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, distanceInterval: 30, timeInterval: 10_000 },
    (position) => onCoordinate({ latitude: position.coords.latitude, longitude: position.coords.longitude })
  );
}
