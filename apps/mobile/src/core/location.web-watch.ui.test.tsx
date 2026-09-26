import { Platform } from "react-native";
import * as Location from "expo-location";
import { watchCurrentCoordinates } from "./location";

// expo-location 19 on web: removing a watch calls LocationEventEmitter.removeSubscription, which the
// web emitter does not have. The mock reproduces exactly that failure so these tests fail if the web
// path ever goes back through expo-location's watcher.
jest.mock("expo-location", () => ({
  PermissionStatus: { GRANTED: "granted" },
  Accuracy: { High: 4, Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  watchPositionAsync: jest.fn(async () => ({
    remove: () => {
      throw new TypeError("LocationEventEmitter.removeSubscription is not a function");
    }
  }))
}));

const setPlatform = (os: string) => Object.defineProperty(Platform, "OS", { configurable: true, get: () => os });

type Callbacks = { success: (position: unknown) => void };
let callbacks: Callbacks | null = null;
const watchPosition = jest.fn((success: Callbacks["success"]) => {
  callbacks = { success };
  return 7;
});
const clearWatch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  callbacks = null;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { geolocation: { watchPosition, clearWatch } } });
});

const position = (latitude: number, longitude: number) => ({ coords: { latitude, longitude } });

test("on web, removing the watch does not throw, because the browser's own watch is used", async () => {
  setPlatform("web");
  const onFix = jest.fn();
  const watch = await watchCurrentCoordinates(onFix);

  expect(Location.watchPositionAsync).not.toHaveBeenCalled();
  expect(() => watch.remove()).not.toThrow();
  expect(clearWatch).toHaveBeenCalledWith(7);
});

test("on web, fixes are delivered with the same 10 s / 30 m throttle as native, and stop after remove()", async () => {
  setPlatform("web");
  const onFix = jest.fn();
  const watch = await watchCurrentCoordinates(onFix);

  callbacks!.success(position(31.83804, 35.14047));
  callbacks!.success(position(31.83805, 35.14047)); // ~1 m and moments later: dropped
  callbacks!.success(position(31.84, 35.14047)); // ~170 m: delivered
  expect(onFix.mock.calls.map(([c]) => c.latitude)).toEqual([31.83804, 31.84]);

  watch.remove();
  callbacks!.success(position(31.9, 35.2));
  expect(onFix).toHaveBeenCalledTimes(2);
});

test("on web without a geolocation API, the watch fails with a readable error instead of crashing later", async () => {
  setPlatform("web");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  await expect(watchCurrentCoordinates(jest.fn())).rejects.toThrow();
});

test("on native the expo-location watcher is still the one used", async () => {
  setPlatform("android");
  (Location.watchPositionAsync as jest.Mock).mockResolvedValueOnce({ remove: jest.fn() });
  await watchCurrentCoordinates(jest.fn());
  expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);
  expect(watchPosition).not.toHaveBeenCalled();
});
