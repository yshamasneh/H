import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  deliveryAlertChannelId,
  deliveryAlertSound,
  deliveryAlertTtlSeconds,
  orderUpdatesChannelId,
  pushPresentation
} from "./push-presentation";

test("an ordinary notification keeps the default sound and goes to the order-updates channel", () => {
  assert.deepEqual(pushPresentation("ORDER_STATUS_CHANGED", "android"), { sound: "default", channelId: orderUpdatesChannelId });
  assert.deepEqual(pushPresentation("DELIVERY_ASSIGNED", "ios"), { sound: "default", channelId: orderUpdatesChannelId });
  assert.deepEqual(pushPresentation("ADMIN_ALERT", "android"), { sound: "default", channelId: orderUpdatesChannelId });
});

test("only the delivery alert carries the JOVO sound, a channel of its own and a TTL", () => {
  for (const type of ["ORDER_PLACED", "ORDER_STATUS_CHANGED", "DELIVERY_ASSIGNED", "DELIVERY_STATUS_CHANGED", "ADMIN_ALERT"] as const) {
    const presentation = pushPresentation(type, "ios");
    assert.equal(presentation.sound, "default", type);
    assert.equal(presentation.ttl, undefined, type);
    assert.notEqual(presentation.channelId, deliveryAlertChannelId, type);
  }
});

test("a delivery alert on iOS names the bundled JOVO sound file", () => {
  const presentation = pushPresentation("DELIVERY_AVAILABLE", "ios");
  assert.equal(presentation.sound, deliveryAlertSound);
  assert.equal(presentation.channelId, deliveryAlertChannelId);
  assert.equal(presentation.ttl, deliveryAlertTtlSeconds);
});

test("a delivery alert on Android targets the channel that owns the sound, since Android 8+ ignores a per-message sound", () => {
  const presentation = pushPresentation("DELIVERY_AVAILABLE", "android");
  assert.equal(presentation.sound, "default");
  assert.equal(presentation.channelId, deliveryAlertChannelId);
});

test("a stale alert expires rather than arriving minutes late", () => {
  assert.ok(deliveryAlertTtlSeconds > 0 && deliveryAlertTtlSeconds <= 300);
});

test("the API and the mobile app agree on the channel id and sound file (a mismatch fails silently, as the default sound)", () => {
  const mobile = readFileSync(
    path.resolve(__dirname, "../../../mobile/src/core/push-channels.ts"),
    "utf8"
  );
  assert.ok(mobile.includes(`"${deliveryAlertChannelId}"`), "mobile channel id differs from the API's");
  assert.ok(mobile.includes(`"${deliveryAlertSound}"`), "mobile sound file name differs from the API's");
  const registration = readFileSync(
    path.resolve(__dirname, "../../../mobile/src/core/push-notifications.ts"),
    "utf8"
  );
  assert.ok(
    registration.includes(`setNotificationChannelAsync("${orderUpdatesChannelId}"`),
    "the app does not create the order-updates channel the API addresses"
  );
});

test("the app ships the alert sound file and registers it with the notifications plugin", () => {
  const mobileRoot = path.resolve(__dirname, "../../../mobile");
  const wav = readFileSync(path.join(mobileRoot, "assets/sounds", deliveryAlertSound));
  assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF", "the alert sound is not a WAV file");
  assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
  const config = JSON.parse(readFileSync(path.join(mobileRoot, "app.json"), "utf8"));
  const plugin = config.expo.plugins.find((entry: unknown) => Array.isArray(entry) && entry[0] === "expo-notifications");
  assert.ok(
    plugin?.[1]?.sounds?.some((sound: string) => sound.endsWith(deliveryAlertSound)),
    "app.json does not bundle the alert sound through expo-notifications"
  );
});
