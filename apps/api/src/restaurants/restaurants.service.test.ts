import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
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
  // This file exercises restaurant registration/moderation/listing logic itself, not the
  // RESTAURANT_ORDERING_ENABLED launch gate (see restaurants.public-gate.test.ts for that), so
  // the flag is turned on explicitly here rather than relying on its real (off) default.
  const config = new ConfigService({ RESTAURANT_ORDERING_ENABLED: true });
  const service = new RestaurantsService(prisma as never, realtime as never, config);
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

test("a newly registered store hides its location from customers by default", async () => {
  const { prisma, service } = createService();
  await service.register(registerInput);
  assert.equal(prisma.restaurants[0].showLocationToCustomer, false);
});

test("public views withhold a store's coordinates while its location is hidden, but reveal them once shown", async () => {
  const { prisma, service } = createService();
  const store = prisma.seedApprovedOpenRestaurant({
    businessType: BusinessType.SUPERMARKET,
    latitude: 31.9,
    longitude: 35.2,
    showLocationToCustomer: false
  });

  const hidden = await service.listPublicSupermarkets(1, 20);
  assert.equal(hidden.items[0].latitude, null);
  assert.equal(hidden.items[0].longitude, null);

  store.showLocationToCustomer = true;
  const shown = await service.listPublicSupermarkets(1, 20);
  assert.equal(shown.items[0].latitude, 31.9);
  assert.equal(shown.items[0].longitude, 35.2);
});

test("admin can set a store's location and flip the customer-visibility flag, recording an audit entry", async () => {
  const { prisma, service } = createService();
  const store = prisma.seedApprovedOpenRestaurant({ latitude: null, longitude: null, showLocationToCustomer: false });
  const adminId = randomUUID();

  const updated = await service.adminUpdateStoreLocation(adminId, store.id, {
    addressLine: "New Plaza, Ramallah",
    latitude: 32.1,
    longitude: 35.3,
    showLocationToCustomer: true
  });

  // The owner/admin profile view always carries the real coordinates plus the flag itself.
  assert.equal(updated.latitude, 32.1);
  assert.equal(updated.longitude, 35.3);
  assert.equal(updated.showLocationToCustomer, true);
  assert.equal(prisma.restaurants[0].addressLine, "New Plaza, Ramallah");

  const auditEntry = prisma.auditLogs.find((entry) => entry.action === "RESTAURANT_LOCATION_UPDATED");
  assert.ok(auditEntry);
  assert.equal(auditEntry!.actorUserId, adminId);
});

test("admin location update rejects a half-set coordinate pair", async () => {
  const { prisma, service } = createService();
  const store = prisma.seedApprovedOpenRestaurant();
  await assert.rejects(
    service.adminUpdateStoreLocation(randomUUID(), store.id, { latitude: 32.1, showLocationToCustomer: true }),
    hasCode("RESTAURANT_COORDINATES_INCOMPLETE")
  );
});

test("hiding a store's location leaves its stored coordinates intact for delivery, only masking the customer view", async () => {
  const { prisma, service } = createService();
  const store = prisma.seedApprovedOpenRestaurant({
    businessType: BusinessType.SUPERMARKET,
    latitude: 31.5,
    longitude: 35.1,
    showLocationToCustomer: true
  });

  await service.adminUpdateStoreLocation(randomUUID(), store.id, { showLocationToCustomer: false });

  // Delivery pricing reads the coordinates straight off the row (orders.service.ts), never the
  // customer view, so they must survive the flag being turned off.
  assert.equal(prisma.restaurants[0].latitude, 31.5);
  assert.equal(prisma.restaurants[0].longitude, 35.1);
  const publicView = await service.listPublicSupermarkets(1, 20, true);
  assert.equal(publicView.items[0].latitude, null);
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
  await assert.rejects(service.reject(adminId, restaurant.id, "already decided"), hasCode("RESTAURANT_NOT_PENDING"));
});

test("admin can reject a pending restaurant, recording the reason in the audit log and owner notification", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedApprovedOpenRestaurant({ status: RestaurantStatus.PENDING, isOpen: false });
  const adminId = randomUUID();

  const rejected = await service.reject(adminId, restaurant.id, "Incomplete licensing documents");
  assert.equal(rejected.status, RestaurantStatus.REJECTED);

  const auditEntry = prisma.auditLogs.find((entry) => entry.entityId === restaurant.id && entry.action === "RESTAURANT_REJECTED");
  assert.ok(auditEntry);
  assert.equal(auditEntry!.reason, "Incomplete licensing documents");

  const notification = prisma.notifications.find((entry) => entry.userId === restaurant.ownerUserId);
  assert.ok(notification);
  assert.equal(notification!.type, "RESTAURANT_REJECTED");
  assert.match(notification!.body, /Incomplete licensing documents/);
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

test("owner stats report 0 revenue (not an error) when nothing has been delivered", async () => {
  const { prisma, service } = createService();
  await service.register(registerInput);
  const ownerId = prisma.users[0].id;
  const restaurantId = prisma.restaurants[0].id;

  // Volume exists but nothing is DELIVERED → aggregate _sum is null, surfaced as 0.
  prisma.seedOrder(restaurantId, { status: "PLACED", totalMinor: 1500, createdAt: new Date() });

  const stats = await service.getOwnStats(ownerId);
  assert.equal(stats.today.salesMinor, 0);
  assert.equal(stats.today.ordersCount, 1);
  assert.equal(stats.total.salesMinor, 0);
});

test("adminGetRestaurant reports 0 revenue when there are no delivered orders", async () => {
  const { prisma, service } = createService();
  const ownerUserId = randomUUID();
  prisma.users.push({
    id: ownerUserId,
    fullName: "Owner Name",
    phone: "+970593334444",
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
  prisma.seedOrder(restaurant.id, { status: "PLACED", totalMinor: 4200 });

  const view = await service.adminGetRestaurant(restaurant.id);
  assert.equal(view.revenueMinor, 0);
  assert.equal(view.totalOrdersCount, 1);
});

test("a store cannot open for orders until it is approved (TC-125)", async () => {
  const { prisma, service } = createService();
  await service.register(registerInput); // creates a PENDING restaurant + owner + membership
  const ownerId = prisma.users[0].id;
  await assert.rejects(service.setOwnOpenStatus(ownerId, true), hasCode("RESTAURANT_NOT_APPROVED"));
});

test("admin restaurant list filters by status and business type (TC-137)", async () => {
  const { prisma, service } = createService();
  prisma.seedApprovedOpenRestaurant({ name: "Approved Kitchen" });
  prisma.seedApprovedOpenRestaurant({ name: "Approved Market", businessType: BusinessType.SUPERMARKET });
  await service.register(registerInput); // a PENDING restaurant

  const approved = await service.adminList({ status: RestaurantStatus.APPROVED } as never);
  assert.equal(approved.items.length, 2);
  assert.ok(approved.items.every((restaurant) => restaurant.status === RestaurantStatus.APPROVED));

  const markets = await service.adminList({ businessType: BusinessType.SUPERMARKET } as never);
  assert.ok(markets.items.length >= 1);
  assert.ok(markets.items.every((restaurant) => restaurant.businessType === BusinessType.SUPERMARKET));
});

test("admin creates a business with an owner, a membership, and immediate approval (TC-141)", async () => {
  const { prisma, service } = createService();
  const view = await service.adminCreateBusiness(randomUUID(), {
    countryCode: "+970",
    phoneNumber: "0599990000",
    ownerFullName: "New Owner",
    password: "Owner@1234",
    businessName: "New Market",
    addressLine: "Ramallah",
    businessType: BusinessType.SUPERMARKET,
    approveImmediately: true
  } as never);

  assert.equal(view.status, RestaurantStatus.APPROVED);
  assert.equal(prisma.restaurants.length, 1);
  assert.ok(prisma.users.some((user) => user.role === UserRole.RESTAURANT), "an owner user is created");
  assert.ok(
    prisma.businessMembers.some((member) => member.businessId === prisma.restaurants[0].id),
    "the owner is granted a membership"
  );
  assert.ok(prisma.auditLogs.some((entry) => entry.action === "BUSINESS_CREATED_BY_ADMIN"));
});

test("catalog rejects an unknown supermarket department (TC-046)", async () => {
  const { prisma, service } = createService();
  const market = prisma.seedApprovedOpenRestaurant({ businessType: BusinessType.SUPERMARKET });
  await assert.rejects(
    service.getSupermarketCatalog(market.id, { categoryId: randomUUID() } as never),
    hasCode("SUPERMARKET_DEPARTMENT_NOT_FOUND")
  );
});

test("product detail rejects an unknown product (TC-052)", async () => {
  const { prisma, service } = createService();
  const market = prisma.seedApprovedOpenRestaurant({ businessType: BusinessType.SUPERMARKET });
  await assert.rejects(
    service.getSupermarketProduct(market.id, randomUUID()),
    hasCode("SUPERMARKET_PRODUCT_NOT_FOUND")
  );
});

// --- gap closures: TC-047/048/049 (catalog search, featured, pagination) ----------

async function seedCatalog(prisma: FakeRestaurantPrisma) {
  const market = prisma.seedApprovedOpenRestaurant({ businessType: BusinessType.SUPERMARKET });
  const department = await prisma.menuCategory.create({
    data: { restaurantId: market.id, name: "Groceries", sortOrder: 0, isActive: true }
  });
  const addProduct = (overrides: Record<string, unknown>) =>
    prisma.menuItem.create({
      data: {
        restaurantId: market.id,
        categoryId: department.id,
        name: "Product",
        priceMinor: 500,
        costPriceMinor: 300,
        isAvailable: true,
        stockQuantity: 10,
        isFeatured: false,
        ...overrides
      }
    });
  return { market, department, addProduct };
}

test("catalog search matches name/brand/sku case-insensitively (TC-047)", async () => {
  const { prisma, service } = createService();
  const { market, addProduct } = await seedCatalog(prisma);
  await addProduct({ name: "Fresh Milk", brand: "Alpha", sku: "MILK-1" });
  await addProduct({ name: "Bread Loaf", brand: "Beta", sku: "BREAD-1" });
  await addProduct({ name: "Yogurt", brand: "Alpha", sku: "YOG-1" });

  const byName = await service.getSupermarketCatalog(market.id, { search: "milk" } as never);
  assert.equal(byName.products.length, 1);
  assert.equal(byName.products[0].name, "Fresh Milk");

  const byBrand = await service.getSupermarketCatalog(market.id, { search: "ALPHA" } as never);
  assert.equal(byBrand.products.length, 2, "brand match is case-insensitive");
});

test("the featured filter returns only featured products (TC-048)", async () => {
  const { prisma, service } = createService();
  const { market, addProduct } = await seedCatalog(prisma);
  await addProduct({ name: "Regular" });
  await addProduct({ name: "Star", isFeatured: true });

  const featured = await service.getSupermarketCatalog(market.id, { featured: true } as never);
  assert.equal(featured.products.length, 1);
  assert.equal(featured.products[0].name, "Star");
});

test("catalog pagination respects page size, reports the true total, and tolerates a page past the end (TC-049)", async () => {
  const { prisma, service } = createService();
  const { market, addProduct } = await seedCatalog(prisma);
  for (const suffix of ["A", "B", "C", "D", "E"]) await addProduct({ name: `Item ${suffix}` });

  const page1 = await service.getSupermarketCatalog(market.id, { page: 1, pageSize: 2 } as never);
  assert.equal(page1.total, 5);
  assert.equal(page1.products.length, 2);

  const lastPage = await service.getSupermarketCatalog(market.id, { page: 3, pageSize: 2 } as never);
  assert.equal(lastPage.products.length, 1, "the tail page holds the remainder");

  const beyond = await service.getSupermarketCatalog(market.id, { page: 4, pageSize: 2 } as never);
  assert.equal(beyond.products.length, 0, "a page beyond the last is empty, not an error");
  assert.equal(beyond.total, 5);
});

test("catalog and detail hide a supermarket product with no cost price, matching the cart-add guard (TC-050)", async () => {
  const { prisma, service } = createService();
  const { market, addProduct } = await seedCatalog(prisma);
  await addProduct({ name: "Priced Product", costPriceMinor: 300 });
  const orphan = await addProduct({ name: "No Cost Product", costPriceMinor: null });

  // calculateOrderQuote fail-closes on a supermarket item with no cost price, so browse must
  // not present it as orderable. It is in stock (10) — this is a cost-price gap, not a stock-out.
  const catalog = await service.getSupermarketCatalog(market.id, {} as never);
  assert.equal(catalog.total, 1, "the no-cost product is excluded from the catalog total");
  assert.deepEqual(catalog.products.map((product) => product.name), ["Priced Product"]);
  assert.equal(catalog.departments[0].productCount, 1, "and from the per-department count");

  await assert.rejects(
    service.getSupermarketProduct(market.id, orphan.id),
    hasCode("SUPERMARKET_PRODUCT_NOT_FOUND"),
    "its detail page 404s instead of offering an un-cartable product"
  );
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof ApiException && (error.getResponse() as { code?: string }).code === code;
}
