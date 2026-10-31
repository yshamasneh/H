import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiException } from "../common/api.exception";
import { UserRole } from "../generated/prisma/client";
import { AccountDeletionSweepService } from "./account-deletion-sweep.service";
import { deletionScheduleDate, driverDeletionBlockers } from "./account-deletion.rules";
import { UsersService } from "./users.service";
import { FakeUsersPrisma } from "./testing/fake-prisma";

// Store audit H1: in-app deletion for drivers and store staff, without breaking financial records.

function createService(scheduleDays?: number) {
  const prisma = new FakeUsersPrisma();
  const config = { get: (key: string) => (key === "ACCOUNT_DELETION_SCHEDULE_DAYS" ? scheduleDays : undefined) };
  const service = new UsersService(prisma as never, config as never);
  return { prisma, service };
}

function hasCode(code: string) {
  return (error: unknown) => error instanceof ApiException && (error.getResponse() as { code?: string }).code === code;
}

function payeeKey(userId: string) {
  return `DRIVER:${userId}`;
}

function seedDriver(prisma: FakeUsersPrisma) {
  const driver = prisma.seedUser({ role: UserRole.DRIVER, fullName: "Omar Driver", email: null });
  prisma.seedDriverProfile(driver.id);
  prisma.pushTokens.push({ id: `pt-${driver.id}`, userId: driver.id, token: `expo-${driver.id}`, isActive: true });
  prisma.refreshSessions.push({ id: `s-${driver.id}`, userId: driver.id, revokedAt: null });
  return driver;
}

function snapshotFinancials(prisma: FakeUsersPrisma) {
  return JSON.stringify([prisma.deliveries, prisma.cashCustodies, prisma.earnings, prisma.payouts]);
}

function daysUntil(iso: string) {
  return (new Date(iso).getTime() - Date.now()) / 86_400_000;
}

test("the rules name each outstanding obligation", () => {
  assert.deepEqual(driverDeletionBlockers({ activeDeliveries: 0, unsettledCashCustodies: 0, earningsBalanceMinor: 0 }), []);
  assert.deepEqual(driverDeletionBlockers({ activeDeliveries: 1, unsettledCashCustodies: 2, earningsBalanceMinor: 500 }), [
    "ACTIVE_DELIVERY",
    "OUTSTANDING_CASH",
    "UNSETTLED_EARNINGS"
  ]);
  // An overpayment is also a balance to settle with the person, not something to erase.
  assert.deepEqual(driverDeletionBlockers({ activeDeliveries: 0, unsettledCashCustodies: 0, earningsBalanceMinor: -100 }), [
    "UNSETTLED_EARNINGS"
  ]);
  const now = new Date("2026-11-01T10:00:00Z");
  assert.equal(deletionScheduleDate(now, 30).toISOString(), "2026-12-01T10:00:00.000Z");
  assert.equal(deletionScheduleDate(now, Number.NaN).toISOString(), "2026-12-01T10:00:00.000Z", "invalid config falls back to 30 days");
});

test("a driver with nothing outstanding is anonymised at once, position and shift state cleared", async () => {
  const { prisma, service } = createService();
  const driver = seedDriver(prisma);
  prisma.deliveries.push({ id: "d-old", driverId: driver.id, status: "DELIVERED" });
  prisma.cashCustodies.push({ id: "c-old", driverUserId: driver.id, status: "SETTLED" });
  prisma.earnings.push({ payeeKey: payeeKey(driver.id), amountMinor: 1200 });
  prisma.payouts.push({ payeeKey: payeeKey(driver.id), amountMinor: 1200 });
  const before = snapshotFinancials(prisma);

  const outcome = await service.deleteMyAccount(driver.id);

  assert.deepEqual(outcome, { status: "DELETED" });
  const stored = prisma.users[0];
  assert.equal(stored.fullName, "Deleted account");
  assert.equal(stored.phone, `deleted-${driver.id}`);
  assert.equal(stored.passwordHash, "DELETED");
  assert.equal(stored.isActive, false);
  assert.equal(stored.tokenVersion, 1, "every access token is invalidated");
  assert.equal(prisma.pushTokens.length, 0);
  assert.ok(prisma.refreshSessions.every((session) => session.revokedAt !== null));
  const profile = prisma.driverProfiles[0];
  assert.equal(profile.lastLatitude, null);
  assert.equal(profile.lastLongitude, null);
  assert.equal(profile.lastLocationAt, null);
  assert.equal(profile.isOnline, false);
  assert.equal(profile.appLeaseUntil, null);
  assert.equal(snapshotFinancials(prisma), before, "orders, cash and earnings records are untouched");
  assert.equal(prisma.auditLogs.at(-1)?.action, "ACCOUNT_DELETED");
  assert.ok(
    prisma.transactionOptions.some(
      (options) => (options as { isolationLevel?: string } | null)?.isolationLevel === "Serializable"
    ),
    "the obligation check and the erasure run in one serializable transaction"
  );
});

test("a driver in the middle of a delivery is scheduled, not erased, and keeps working", async () => {
  const { prisma, service } = createService();
  const driver = seedDriver(prisma);
  prisma.deliveries.push({ id: "d-live", driverId: driver.id, status: "ON_THE_WAY" });
  const before = snapshotFinancials(prisma);

  const outcome = await service.deleteMyAccount(driver.id);

  assert.equal(outcome.status, "SCHEDULED");
  if (outcome.status !== "SCHEDULED") return;
  assert.deepEqual(outcome.blockers, ["ACTIVE_DELIVERY"]);
  const days = daysUntil(outcome.scheduledFor);
  assert.ok(days > 29.9 && days <= 30, "scheduled 30 days out by default");
  // Nothing about the person changes yet: they must be able to finish the delivery.
  assert.equal(prisma.users[0].isActive, true);
  assert.equal(prisma.users[0].fullName, "Omar Driver");
  assert.equal(prisma.pushTokens.length, 1);
  assert.equal(prisma.driverProfiles[0].lastLatitude, 31.9);
  assert.equal(snapshotFinancials(prisma), before);
  assert.equal(prisma.deletionRequests.length, 1);
  assert.equal(prisma.auditLogs.at(-1)?.action, "ACCOUNT_DELETION_SCHEDULED");
  assert.deepEqual(await service.getDeletionRequest(driver.id), {
    status: "SCHEDULED",
    scheduledFor: outcome.scheduledFor,
    blockers: ["ACTIVE_DELIVERY"]
  });
});

test("unsettled cash custody and unpaid earnings each schedule the deletion; asking again keeps the date", async () => {
  const { prisma, service } = createService(7);
  const driver = seedDriver(prisma);
  prisma.cashCustodies.push({ id: "c1", driverUserId: driver.id, status: "PARTIALLY_SETTLED" });
  prisma.earnings.push({ payeeKey: payeeKey(driver.id), amountMinor: 900 });

  const first = await service.deleteMyAccount(driver.id);
  assert.equal(first.status, "SCHEDULED");
  if (first.status !== "SCHEDULED") return;
  assert.deepEqual(first.blockers, ["OUTSTANDING_CASH", "UNSETTLED_EARNINGS"]);
  const days = daysUntil(first.scheduledFor);
  assert.ok(days > 6.9 && days <= 7, "ACCOUNT_DELETION_SCHEDULE_DAYS is honoured");

  prisma.cashCustodies[0].status = "SETTLED";
  const second = await service.deleteMyAccount(driver.id);
  assert.equal(second.status, "SCHEDULED");
  if (second.status !== "SCHEDULED") return;
  assert.equal(second.scheduledFor, first.scheduledFor, "asking again never moves the date");
  assert.deepEqual(second.blockers, ["UNSETTLED_EARNINGS"]);
  assert.equal(prisma.users[0].isActive, true);
});

test("the sweep completes a due deletion once settled, and leaves a still-blocked one pending", async () => {
  const { prisma, service } = createService();
  const settled = seedDriver(prisma);
  const blocked = seedDriver(prisma);
  prisma.cashCustodies.push({ id: "c-a", driverUserId: settled.id, status: "OUTSTANDING" });
  prisma.deliveries.push({ id: "d-b", driverId: blocked.id, status: "PICKED_UP" });
  await service.deleteMyAccount(settled.id);
  await service.deleteMyAccount(blocked.id);

  const sweep = new AccountDeletionSweepService(prisma as never, service, { get: () => undefined } as never);
  assert.equal(await sweep.processDue(new Date()), 0, "nothing is processed before the scheduled date");

  prisma.cashCustodies[0].status = "SETTLED";
  const later = new Date(Date.now() + 31 * 86_400_000);
  assert.equal(await sweep.processDue(later), 1);

  const settledUser = prisma.users.find((user) => user.id === settled.id)!;
  const blockedUser = prisma.users.find((user) => user.id === blocked.id)!;
  assert.equal(settledUser.isActive, false);
  assert.equal(settledUser.fullName, "Deleted account");
  assert.equal(prisma.deletionRequests.find((entry) => entry.userId === settled.id)?.status, "COMPLETED");
  assert.equal(blockedUser.isActive, true, "a driver still holding a delivery is never erased");
  const pending = prisma.deletionRequests.find((entry) => entry.userId === blocked.id);
  assert.equal(pending?.status, "PENDING");
  assert.deepEqual(pending?.blockers, ["ACTIVE_DELIVERY"]);
  assert.equal(prisma.deliveries[0].status, "PICKED_UP", "the delivery itself is untouched");
});

test("store staff (not the owner) are anonymised at once and lose their business membership", async () => {
  const { prisma, service } = createService();
  const owner = prisma.seedUser({ role: UserRole.RESTAURANT, fullName: "Owner" });
  prisma.restaurants.push({ id: "store-1", ownerUserId: owner.id });
  const staff = prisma.seedUser({ role: UserRole.RESTAURANT, fullName: "Lina Staff" });
  prisma.businessMembers.push({ id: "m1", userId: staff.id, businessId: "store-1", isActive: true });
  prisma.refreshSessions.push({ id: "s-staff", userId: staff.id, revokedAt: null });

  const outcome = await service.deleteMyAccount(staff.id);

  assert.deepEqual(outcome, { status: "DELETED" });
  const stored = prisma.users.find((user) => user.id === staff.id)!;
  assert.equal(stored.fullName, "Deleted account");
  assert.equal(stored.isActive, false);
  assert.equal(prisma.businessMembers[0].isActive, false);
  assert.ok(prisma.refreshSessions.every((session) => session.revokedAt !== null));
  assert.equal(prisma.users.find((user) => user.id === owner.id)?.isActive, true, "the owner is untouched");
});

test("an administrator cannot delete their own account; another administrator closes it", async () => {
  const { prisma, service } = createService();
  const admin = prisma.seedUser({ role: UserRole.ADMIN, fullName: "Admin" });
  await assert.rejects(service.deleteMyAccount(admin.id), hasCode("ADMIN_DELETION_REQUIRES_SECOND_ADMIN"));
  assert.equal(prisma.users[0].isActive, true);
  assert.equal(prisma.auditLogs.length, 0);
});

test("customer deletion is unchanged: immediate, with the original audit action and no metadata", async () => {
  const { prisma, service } = createService();
  const customer = prisma.seedUser();
  assert.deepEqual(await service.deleteMyAccount(customer.id), { status: "DELETED" });
  assert.equal(prisma.auditLogs[0].action, "CUSTOMER_ACCOUNT_DEACTIVATED");
  assert.equal(prisma.auditLogs[0].metadataJson, null);
  assert.equal((await service.getDeletionRequest(customer.id)).status, "NONE");
});
