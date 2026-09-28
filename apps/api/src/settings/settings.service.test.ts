import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { SettingsService } from "./settings.service";

const row = { id: "singleton", substitutionOptionEnabled: true, updatedAt: new Date() };
const prisma = { platformSetting: { findUnique: async () => row, create: async () => row } };

test("the public settings tell the customer app whether restaurants are open, from the server-side gate", async () => {
  const off = new SettingsService(prisma as never, new ConfigService({ RESTAURANT_ORDERING_ENABLED: false }));
  assert.deepEqual(await off.getPublic(), { substitutionOptionEnabled: true, restaurantOrderingEnabled: false });

  const on = new SettingsService(prisma as never, new ConfigService({ RESTAURANT_ORDERING_ENABLED: true }));
  assert.equal((await on.getPublic()).restaurantOrderingEnabled, true);
});

test("restaurants stay hidden when the gate is unset or the service has no config", async () => {
  const unset = new SettingsService(prisma as never, new ConfigService({}));
  assert.equal((await unset.getPublic()).restaurantOrderingEnabled, false);
  assert.equal((await new SettingsService(prisma as never).getPublic()).restaurantOrderingEnabled, false);
});
