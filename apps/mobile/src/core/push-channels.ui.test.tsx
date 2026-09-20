import { Platform } from "react-native";

const mockSetChannel = jest.fn().mockResolvedValue(undefined);
jest.mock("expo-notifications", () => ({
  setNotificationChannelAsync: (...args: unknown[]) => mockSetChannel(...args),
  AndroidImportance: { MAX: 5, HIGH: 4 },
  AndroidAudioUsage: { ALARM: 4, NOTIFICATION: 5 },
  AndroidAudioContentType: { SONIFICATION: 4 },
  AndroidNotificationVisibility: { PUBLIC: 1 }
}));

import { deliveryAlertChannel, deliveryAlertChannelId, deliveryAlertSound, ensureDeliveryAlertChannel } from "./push-channels";

const originalOs = Platform.OS;
afterEach(() => {
  mockSetChannel.mockClear();
  Object.defineProperty(Platform, "OS", { configurable: true, value: originalOs });
});

function setPlatform(os: "android" | "ios") {
  Object.defineProperty(Platform, "OS", { configurable: true, value: os });
}

test("the delivery-alert channel is loud: maximum importance, the JOVO sound, alarm audio and a long vibration", () => {
  expect(deliveryAlertChannel.importance).toBe(5);
  expect(deliveryAlertChannel.sound).toBe(deliveryAlertSound);
  expect(deliveryAlertSound).toBe("jovo_delivery.wav");
  expect(deliveryAlertChannel.audioAttributes?.usage).toBe(4);
  expect(deliveryAlertChannel.enableVibrate).toBe(true);
  expect((deliveryAlertChannel.vibrationPattern ?? []).reduce((sum, value) => sum + value, 0)).toBeGreaterThan(1500);
});

test("on Android the channel is created under the id the API addresses its pushes to", async () => {
  setPlatform("android");
  await ensureDeliveryAlertChannel();

  expect(mockSetChannel).toHaveBeenCalledTimes(1);
  expect(mockSetChannel).toHaveBeenCalledWith("delivery-alerts", deliveryAlertChannel);
  expect(deliveryAlertChannelId).toBe("delivery-alerts");
});

test("iOS has no channels, so nothing is created there", async () => {
  setPlatform("ios");
  await ensureDeliveryAlertChannel();

  expect(mockSetChannel).not.toHaveBeenCalled();
});
