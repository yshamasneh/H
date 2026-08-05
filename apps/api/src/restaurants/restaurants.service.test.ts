import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiException } from "../common/api.exception";
import { RestaurantStatus, UserRole } from "../generated/prisma/client";
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
  const service = new RestaurantsService(prisma as never);
  return { prisma, service };
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

  const approved = await service.approve(restaurant.id);
  assert.equal(approved.status, RestaurantStatus.APPROVED);

  await assert.rejects(service.approve(restaurant.id), hasCode("RESTAURANT_NOT_PENDING"));
  await assert.rejects(service.reject(restaurant.id), hasCode("RESTAURANT_NOT_PENDING"));
});

test("admin can reject a pending restaurant", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedApprovedOpenRestaurant({ status: RestaurantStatus.PENDING, isOpen: false });

  const rejected = await service.reject(restaurant.id);
  assert.equal(rejected.status, RestaurantStatus.REJECTED);
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof ApiException && (error.getResponse() as { code?: string }).code === code;
}
