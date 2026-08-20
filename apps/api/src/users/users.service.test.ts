import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiException } from "../common/api.exception";
import { UserRole } from "../generated/prisma/client";
import { UsersService } from "./users.service";
import { FakeUsersPrisma } from "./testing/fake-prisma";

function createService() {
  const prisma = new FakeUsersPrisma();
  const service = new UsersService(prisma as never);
  return { prisma, service };
}

// --- gap closures: TC-027/028/037 --------------------------------------------------

test("getProfile returns the account's public fields (TC-027)", async () => {
  const { prisma, service } = createService();
  const user = prisma.seedUser({ fullName: "Sara Customer", email: "sara@example.com" });
  const profile = await service.getProfile(user.id);
  assert.equal(profile.id, user.id);
  assert.equal(profile.fullName, "Sara Customer");
  assert.equal(profile.email, "sara@example.com");
  assert.equal(profile.role, UserRole.CUSTOMER);
  assert.ok(profile.createdAt);
});

test("updateProfile trims the name, lowercases the email, and clears it on null (TC-028)", async () => {
  const { prisma, service } = createService();
  const user = prisma.seedUser();
  const updated = await service.updateProfile(user.id, { fullName: "  Sara   Al  Customer ", email: "SARA@Example.COM" });
  assert.equal(updated.fullName, "Sara Al Customer");
  assert.equal(updated.email, "sara@example.com");
  const cleared = await service.updateProfile(user.id, { email: null });
  assert.equal(cleared.email, null);
});

test("addresses list default-first, then newest-first (TC-037)", async () => {
  const { prisma, service } = createService();
  const user = prisma.seedUser();
  const oldest = prisma.seedAddress(user.id, { label: "Oldest", isDefault: false });
  const newer = prisma.seedAddress(user.id, { label: "Newer", isDefault: false });
  const theDefault = prisma.seedAddress(user.id, { label: "Default", isDefault: true });
  const list = await service.listAddresses(user.id);
  assert.equal(list[0].id, theDefault.id, "default is first");
  assert.equal(list[1].id, newer.id, "then newest non-default");
  assert.equal(list[2].id, oldest.id);
});

function hasCode(code: string) {
  return (error: unknown) =>
    error instanceof ApiException && (error.getResponse() as { code?: string }).code === code;
}

// --- Delete account: anonymize, not just sign out ---------------------------------

test("deleteMyAccount anonymizes the customer and scrubs their linked personal data", async () => {
  const { prisma, service } = createService();
  const user = prisma.seedUser({ fullName: "Sara Customer", email: "sara@example.com" });
  prisma.seedAddress(user.id, { isDefault: true });
  prisma.seedAddress(user.id);
  prisma.pushTokens.push({ id: "pt1", userId: user.id, token: "expo-token", isActive: true });
  prisma.refreshSessions.push({ id: "s1", userId: user.id, revokedAt: null });
  prisma.refreshSessions.push({ id: "s2", userId: user.id, revokedAt: null });

  await service.deleteMyAccount(user.id);

  const stored = prisma.users[0];
  assert.equal(stored.fullName, "Deleted account");
  assert.equal(stored.email, null);
  assert.equal(stored.passwordHash, "DELETED");
  assert.equal(stored.isActive, false);
  assert.match(stored.phone, /^deleted-/);
  // Every existing access token is invalidated by bumping the token version.
  assert.equal(stored.tokenVersion, 1);
  // Personal data linked to the account is removed, and live sessions are revoked.
  assert.equal(prisma.addresses.length, 0);
  assert.equal(prisma.pushTokens.length, 0);
  assert.ok(prisma.refreshSessions.every((session) => session.revokedAt !== null));
  // The deletion is recorded for audit.
  assert.equal(prisma.auditLogs.length, 1);
  assert.equal(prisma.auditLogs[0].action, "CUSTOMER_ACCOUNT_DEACTIVATED");
  assert.equal(prisma.auditLogs[0].entityId, user.id);
});

test("deleteMyAccount refuses non-customer accounts and leaves their data untouched", async () => {
  const { prisma, service } = createService();
  const owner = prisma.seedUser({ role: UserRole.RESTAURANT, fullName: "Store Owner" });
  prisma.seedAddress(owner.id, { isDefault: true });

  await assert.rejects(
    service.deleteMyAccount(owner.id),
    hasCode("ACCOUNT_DELETION_SUPPORT_REQUIRED")
  );
  // Nothing was anonymized or removed.
  assert.equal(prisma.users[0].fullName, "Store Owner");
  assert.equal(prisma.users[0].isActive, true);
  assert.equal(prisma.addresses.length, 1);
  assert.equal(prisma.auditLogs.length, 0);
});

test("deleteMyAccount rejects an already-deleted (inactive) account", async () => {
  const { prisma, service } = createService();
  const user = prisma.seedUser({ isActive: false });

  await assert.rejects(service.deleteMyAccount(user.id), hasCode("USER_NOT_FOUND"));
});

// --- Saved address CRUD + default selection --------------------------------------

test("the first saved address is forced to be the default even without asking", async () => {
  const { prisma, service } = createService();
  const user = prisma.seedUser();

  const created = await service.createAddress(user.id, {
    label: "Home",
    addressLine: "Al-Manara Square, Ramallah",
    latitude: 31.9,
    longitude: 35.2
  } as never);

  assert.equal(created.isDefault, true);
});

test("marking a new address default demotes the previous default", async () => {
  const { prisma, service } = createService();
  const user = prisma.seedUser();
  const first = await service.createAddress(user.id, {
    label: "Home",
    addressLine: "Al-Manara Square, Ramallah",
    latitude: 31.9,
    longitude: 35.2
  } as never);

  const second = await service.createAddress(user.id, {
    label: "Work",
    addressLine: "Rawabi",
    latitude: 32.0,
    longitude: 35.1,
    isDefault: true
  } as never);

  const stored = await service.listAddresses(user.id);
  assert.equal(second.isDefault, true);
  assert.equal(stored.find((address) => address.id === first.id)?.isDefault, false);
  // Exactly one default at all times.
  assert.equal(stored.filter((address) => address.isDefault).length, 1);
});

test("deleting the default address promotes another saved address to default", async () => {
  const { prisma, service } = createService();
  const user = prisma.seedUser();
  const defaultAddress = prisma.seedAddress(user.id, { isDefault: true });
  prisma.seedAddress(user.id, { label: "Work" });

  await service.deleteAddress(user.id, defaultAddress.id);

  const remaining = await service.listAddresses(user.id);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].isDefault, true);
});

test("a customer cannot delete another customer's saved address", async () => {
  const { prisma, service } = createService();
  const owner = prisma.seedUser();
  const intruder = prisma.seedUser();
  const address = prisma.seedAddress(owner.id, { isDefault: true });

  await assert.rejects(service.deleteAddress(intruder.id, address.id), hasCode("ADDRESS_NOT_FOUND"));
  assert.equal(prisma.addresses.length, 1);
});

test("a customer cannot update another customer's saved address", async () => {
  const { prisma, service } = createService();
  const owner = prisma.seedUser();
  const intruder = prisma.seedUser();
  const address = prisma.seedAddress(owner.id, { isDefault: true });

  await assert.rejects(
    service.updateAddress(intruder.id, address.id, { label: "Hacked" } as never),
    hasCode("ADDRESS_NOT_FOUND")
  );
  assert.equal(prisma.addresses[0].label, "Home");
});
