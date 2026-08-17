import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ApiException } from "../common/api.exception";
import { BusinessType, RestaurantStatus, UserRole } from "../generated/prisma/client";
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

test("registering a supermarket preserves the store business type", async () => {
  const { prisma, service } = createService();
  await service.register({ ...registerInput, businessType: BusinessType.SUPERMARKET });

  assert.equal(prisma.restaurants[0].businessType, BusinessType.SUPERMARKET);
});

test("registering a business makes its owner a BUSINESS_ADMIN member of it", async () => {
  const { prisma, service } = createService();
  await service.register(registerInput);

  // Without this the business exists but its owner holds no permissions inside it, and the portal
  // rejects them from their own store.
  const businessAdminRoleId = prisma.roles.find((role) => role.key === "BUSINESS_ADMIN")!.id;
  assert.equal(prisma.businessMembers.length, 1);
  assert.deepEqual(prisma.businessMembers[0], {
    businessId: prisma.restaurants[0].id,
    userId: prisma.users[0].id,
    roleId: businessAdminRoleId,
    isActive: true
  });
});

test("registering a supermarket also grants its owner a membership", async () => {
  const { prisma, service } = createService();
  await service.register({ ...registerInput, businessType: BusinessType.SUPERMARKET });

  assert.equal(prisma.businessMembers.length, 1);
  assert.equal(prisma.businessMembers[0].businessId, prisma.restaurants[0].id);
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

test("restaurant and supermarket public listings stay separated", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedApprovedOpenRestaurant({ name: "Kitchen" });
  const supermarket = prisma.seedApprovedOpenRestaurant({ name: "Market", businessType: BusinessType.SUPERMARKET });

  const restaurants = await service.listPublicRestaurants(1, 20);
  const supermarkets = await service.listPublicSupermarkets(1, 20);

  assert.deepEqual(restaurants.items.map((item) => item.id), [restaurant.id]);
  assert.deepEqual(supermarkets.items.map((item) => item.id), [supermarket.id]);
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

test("working hours round-trip and are validated as a pair", async () => {
  const { prisma, service } = createService();
  await service.register(registerInput);
  const ownerId = prisma.users[0].id;

  const withHours = await service.updateOwnProfile(ownerId, { opensAt: "09:00", closesAt: "22:00" });
  assert.equal(withHours.opensAt, "09:00");
  assert.equal(withHours.closesAt, "22:00");

  // Only one bound set (the other cleared) is refused.
  await assert.rejects(
    service.updateOwnProfile(ownerId, { closesAt: "" }),
    hasCode("RESTAURANT_HOURS_INCOMPLETE")
  );

  // A zero-length window is refused.
  await assert.rejects(
    service.updateOwnProfile(ownerId, { opensAt: "10:00", closesAt: "10:00" }),
    hasCode("RESTAURANT_HOURS_INVALID")
  );

  // Clearing both bounds removes the schedule.
  const cleared = await service.updateOwnProfile(ownerId, { opensAt: "", closesAt: "" });
  assert.equal(cleared.opensAt, null);
  assert.equal(cleared.closesAt, null);
});

test("owner stats sum delivered revenue and count every order in each period", async () => {
  const { prisma, service } = createService();
  await service.register(registerInput);
  const ownerId = prisma.users[0].id;
  const restaurantId = prisma.restaurants[0].id;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 1, 0);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12, 0);

  prisma.seedOrder(restaurantId, { status: "DELIVERED", totalMinor: 2000, createdAt: today });
  prisma.seedOrder(restaurantId, { status: "DELIVERED", totalMinor: 3000, createdAt: today });
  // Placed-but-not-delivered counts toward volume, not revenue.
  prisma.seedOrder(restaurantId, { status: "PLACED", totalMinor: 1500, createdAt: today });
  // Last month is excluded from both today and this month.
  prisma.seedOrder(restaurantId, { status: "DELIVERED", totalMinor: 9999, createdAt: lastMonth });

  const stats = await service.getOwnStats(ownerId);
  assert.equal(stats.today.salesMinor, 5000);
  assert.equal(stats.today.ordersCount, 3);
  assert.equal(stats.month.salesMinor, 5000);
  assert.equal(stats.month.ordersCount, 3);
  // All-time also folds in the delivered order from last month.
  assert.equal(stats.total.salesMinor, 14999);
  assert.equal(stats.total.ordersCount, 4);
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof ApiException && (error.getResponse() as { code?: string }).code === code;
}
