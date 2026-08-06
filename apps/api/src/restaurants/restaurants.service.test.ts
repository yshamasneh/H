import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ApiException } from "../common/api.exception";
import { RestaurantStatus, UserRole } from "../generated/prisma/client";
import { FakeRealtimeGateway } from "../realtime/testing/fake-realtime-gateway";
import { FakeRestaurantPrisma } from "./testing/fake-prisma";
import { RestaurantsService } from "./restaurants.service";

const registerInput = {
  countryCode: "+970" as const,
  phoneNumber: "0591234567",
  ownerFullName: "Restaurant Owner",
  password: "Owner@123",
  confirmPassword: "Owner@123",
  restaurantName: "Falafel House",
  addressLine: "Al-Manara Square, Ramallah"
};

function createService() {
  const prisma = new FakeRestaurantPrisma();
  const realtime = new FakeRealtimeGateway();
  const service = new RestaurantsService(prisma as never, realtime as never);
  return { prisma, realtime, service };
}

test("registering a restaurant creates a RESTAURANT-role user and a PENDING restaurant", async () => {
  const { prisma, service } = createService();
  const result = await service.register(registerInput);

  assert.equal(prisma.users.length, 1);
  assert.equal(prisma.users[0].role, UserRole.RESTAURANT);
  assert.ok(prisma.users[0].phoneVerifiedAt);
  assert.equal(prisma.restaurants.length, 1);
  assert.equal(prisma.restaurants[0].status, RestaurantStatus.PENDING);
  assert.equal(prisma.restaurants[0].isOpen, false);
  assert.equal(prisma.restaurants[0].ownerUserId, prisma.users[0].id);
  assert.equal(result.status, RestaurantStatus.PENDING);
});

test("registering with a phone that already has an account is rejected", async () => {
  const { prisma, service } = createService();
  await service.register(registerInput);
  await assert.rejects(service.register(registerInput), hasCode("PHONE_ALREADY_REGISTERED"));
  assert.equal(prisma.users.length, 1);
  assert.equal(prisma.restaurants.length, 1);
});

test("registering with mismatched passwords is rejected before touching the database", async () => {
  const { prisma, service } = createService();
  await assert.rejects(
    service.register({ ...registerInput, confirmPassword: "Different@123" }),
    hasCode("PASSWORDS_DO_NOT_MATCH")
  );
  assert.equal(prisma.users.length, 0);
});

test("public listing only returns approved and open restaurants", async () => {
  const { prisma, service } = createService();
  const approvedOpen = prisma.seedApprovedOpenRestaurant({ name: "Approved Open" });
  prisma.seedApprovedOpenRestaurant({ name: "Approved Closed", isOpen: false });
  prisma.seedApprovedOpenRestaurant({ name: "Still Pending", status: RestaurantStatus.PENDING, isOpen: true });
  prisma.seedApprovedOpenRestaurant({ name: "Rejected", status: RestaurantStatus.REJECTED, isOpen: true });

  const page = await service.listPublicRestaurants(1, 20);
  assert.equal(page.total, 1);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, approvedOpen.id);
});

test("public restaurant detail and menu are hidden for a non-approved restaurant", async () => {
  const { prisma, service } = createService();
  const pending = prisma.seedApprovedOpenRestaurant({ status: RestaurantStatus.PENDING });

  await assert.rejects(service.getPublicRestaurant(pending.id), hasCode("RESTAURANT_NOT_FOUND"));
  await assert.rejects(service.getPublicMenu(pending.id), hasCode("RESTAURANT_NOT_FOUND"));
});

test("an approved-but-closed restaurant's menu is still viewable by id, just not listed", async () => {
  const { prisma, service } = createService();
  const closed = prisma.seedApprovedOpenRestaurant({ isOpen: false });

  const menu = await service.getPublicMenu(closed.id);
  assert.equal(menu.restaurant.id, closed.id);

  const page = await service.listPublicRestaurants(1, 20);
  assert.equal(page.total, 0);
});

test("admin can approve a pending restaurant exactly once", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedApprovedOpenRestaurant({ status: RestaurantStatus.PENDING, isOpen: false });
  const adminId = randomUUID();

  const approved = await service.approve(adminId, restaurant.id);
  assert.equal(approved.status, RestaurantStatus.APPROVED);

  await assert.rejects(service.approve(adminId, restaurant.id), hasCode("RESTAURANT_NOT_PENDING"));
  await assert.rejects(service.reject(adminId, restaurant.id), hasCode("RESTAURANT_NOT_PENDING"));
});

test("admin can reject a pending restaurant", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedApprovedOpenRestaurant({ status: RestaurantStatus.PENDING, isOpen: false });

  const rejected = await service.reject(randomUUID(), restaurant.id);
  assert.equal(rejected.status, RestaurantStatus.REJECTED);
});

test("approving a restaurant writes an AuditLog entry and notifies the owner", async () => {
  const { prisma, realtime, service } = createService();
  const restaurant = prisma.seedApprovedOpenRestaurant({ status: RestaurantStatus.PENDING, isOpen: false });
  const adminId = randomUUID();

  await service.approve(adminId, restaurant.id);

  const auditEntry = prisma.auditLogs.find((entry) => entry.entityId === restaurant.id);
  assert.ok(auditEntry);
  assert.equal(auditEntry!.action, "RESTAURANT_APPROVED");
  assert.equal(auditEntry!.actorUserId, adminId);

  const notification = prisma.notifications.find((entry) => entry.userId === restaurant.ownerUserId);
  assert.ok(notification);
  assert.equal(notification!.type, "RESTAURANT_APPROVED");
  assert.ok(realtime.emitted.some((event) => event.event === "notification.created"));
});

test("admin suspends an approved restaurant, closing it, then reactivates it", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedApprovedOpenRestaurant();
  const adminId = randomUUID();

  const suspended = await service.adminSuspend(adminId, restaurant.id, "Health code violation");
  assert.equal(suspended.status, RestaurantStatus.SUSPENDED);
  assert.equal(suspended.isOpen, false);

  const auditEntry = prisma.auditLogs.find((entry) => entry.entityId === restaurant.id && entry.action === "RESTAURANT_SUSPENDED");
  assert.equal(auditEntry!.reason, "Health code violation");

  const reactivated = await service.adminReactivate(adminId, restaurant.id);
  assert.equal(reactivated.status, RestaurantStatus.APPROVED);
});

test("admin cannot suspend a restaurant that is not currently approved", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedApprovedOpenRestaurant({ status: RestaurantStatus.PENDING });

  await assert.rejects(
    service.adminSuspend(randomUUID(), restaurant.id, "reason"),
    hasCode("RESTAURANT_INVALID_TRANSITION")
  );
});

test("adminGetRestaurant reports total order count and revenue from delivered orders only", async () => {
  const { prisma, service } = createService();
  const ownerUserId = randomUUID();
  prisma.users.push({
    id: ownerUserId,
    fullName: "Owner Name",
    phone: "+970591112222",
    email: null,
    passwordHash: "hash",
    role: UserRole.RESTAURANT,
    phoneVerifiedAt: new Date(),
    isActive: true,
    tokenVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  const restaurant = prisma.seedApprovedOpenRestaurant({ ownerUserId });
  prisma.seedOrder(restaurant.id, { status: "DELIVERED", totalMinor: 1000 });
  prisma.seedOrder(restaurant.id, { status: "DELIVERED", totalMinor: 1500 });
  prisma.seedOrder(restaurant.id, { status: "CANCELLED", totalMinor: 5000 });

  const view = await service.adminGetRestaurant(restaurant.id);
  assert.equal(view.totalOrdersCount, 3);
  assert.equal(view.revenueMinor, 2500);
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof ApiException && (error.getResponse() as { code?: string }).code === code;
}
