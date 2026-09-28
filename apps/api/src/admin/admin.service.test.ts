import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ApiException } from "../common/api.exception";
import { OrderStatus, RestaurantStatus, UserRole } from "../generated/prisma/client";
import { roundCashUpMinor } from "../common/cash-rounding";
import { calculateOrderFees, defaultDeliveryPricing } from "../orders/pricing";
import { chargedUnitPriceMinor, isOnSale } from "../restaurants/sale-price";
import { AdminService } from "./admin.service";
import { FakeAdminPrisma } from "./testing/fake-prisma";

function createService() {
  const prisma = new FakeAdminPrisma();
  const service = new AdminService(prisma as never);
  return { prisma, service };
}

test("dashboard counts today's orders and excludes cancelled/rejected orders from revenue", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  prisma.seedOrder(restaurant.id, { status: OrderStatus.PLACED, totalMinor: 1000 });
  prisma.seedOrder(restaurant.id, { status: OrderStatus.DELIVERED, totalMinor: 2000 });
  prisma.seedOrder(restaurant.id, { status: OrderStatus.CANCELLED, totalMinor: 5000 });
  // An order from yesterday should not count toward "today".
  prisma.seedOrder(restaurant.id, { status: OrderStatus.DELIVERED, totalMinor: 9000, createdAt: new Date(Date.now() - 86_400_000 * 2) });

  const dashboard = await service.getDashboard();
  assert.equal(dashboard.ordersToday, 3);
  assert.equal(dashboard.revenueTodayMinor, 3000);
});

test("dashboard revenue is 0 (not an error) when no order qualifies", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  // Only excluded/out-of-range orders exist → the SQL _sum returns null, reported as 0.
  prisma.seedOrder(restaurant.id, { status: OrderStatus.CANCELLED, totalMinor: 5000 });
  prisma.seedOrder(restaurant.id, { status: OrderStatus.DELIVERED, totalMinor: 9000, createdAt: new Date(Date.now() - 86_400_000 * 2) });

  const dashboard = await service.getDashboard();
  assert.equal(dashboard.revenueTodayMinor, 0);
});

test("dashboard counts active deliveries, pending restaurants, and online approved drivers", async () => {
  const { prisma, service } = createService();
  prisma.seedDelivery({ status: "ASSIGNED" as never });
  prisma.seedDelivery({ status: "DELIVERED" as never });
  prisma.seedRestaurant({ status: RestaurantStatus.PENDING });
  prisma.seedRestaurant({ status: RestaurantStatus.APPROVED });
  prisma.seedDriverProfile({ isOnline: true, status: "APPROVED" as never });
  prisma.seedDriverProfile({ isOnline: true, status: "PENDING" as never });
  prisma.seedDriverProfile({ isOnline: false, status: "APPROVED" as never });

  const dashboard = await service.getDashboard();
  assert.equal(dashboard.activeDeliveries, 1);
  assert.equal(dashboard.pendingRestaurantApprovals, 1);
  assert.equal(dashboard.onlineDriversCount, 1);
});

test("dashboard totals are all-time counts from the tables, independent of today", async () => {
  const { prisma, service } = createService();
  prisma.seedRestaurant({ status: RestaurantStatus.APPROVED });
  prisma.seedRestaurant({ status: RestaurantStatus.APPROVED });
  prisma.seedRestaurant({ status: RestaurantStatus.SUSPENDED });
  prisma.seedMenuItem(true);
  prisma.seedMenuItem(true);
  prisma.seedMenuItem(false);
  prisma.seedUser({ role: UserRole.CUSTOMER });
  prisma.seedUser({ role: UserRole.DRIVER });
  prisma.seedDriverProfile({ isOnline: false, status: "APPROVED" as never });
  const restaurant = prisma.seedRestaurant({ status: RestaurantStatus.APPROVED });
  // Created long before today: absent from every "today" figure, present in the totals.
  prisma.seedOrder(restaurant.id, { createdAt: new Date("2020-01-01T00:00:00Z") } as never);

  const { totals, ordersToday } = await service.getDashboard();
  assert.equal(ordersToday, 0);
  assert.deepEqual(totals, {
    businesses: 4,
    approvedBusinesses: 3,
    suspendedBusinesses: 1,
    products: 3,
    hiddenProducts: 1,
    customers: 1,
    orders: 1,
    approvedDrivers: 1
  });
});

test("dashboard activity feed surfaces recent order status history with restaurant names", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant({ name: "Test Kitchen" });
  const order = prisma.seedOrder(restaurant.id);
  prisma.seedOrderStatusHistory(order.id, { toStatus: OrderStatus.ACCEPTED });

  const dashboard = await service.getDashboard();
  assert.equal(dashboard.activityFeed.length, 1);
  assert.equal(dashboard.activityFeed[0].restaurantName, "Test Kitchen");
  assert.equal(dashboard.activityFeed[0].toStatus, "ACCEPTED");
});

test("listUsers filters by role and search, and never exposes a password hash", async () => {
  const { prisma, service } = createService();
  prisma.seedUser({ fullName: "Alice Customer", role: UserRole.CUSTOMER });
  prisma.seedUser({ fullName: "Bob Driver", role: UserRole.DRIVER });

  const drivers = await service.listUsers({ role: "DRIVER" } as never);
  assert.equal(drivers.total, 1);
  assert.equal(drivers.items[0].fullName, "Bob Driver");
  assert.ok(!("passwordHash" in drivers.items[0]));

  const searched = await service.listUsers({ search: "Alice" } as never);
  assert.equal(searched.total, 1);
});

test("listAuditLog filters by actor and action", async () => {
  const { prisma, service } = createService();
  const actorA = randomUUID();
  const actorB = randomUUID();
  prisma.users.push({
    id: actorA,
    fullName: "Admin One",
    phone: "+970590000099",
    passwordHash: "hash",
    role: UserRole.ADMIN,
    isActive: true,
    phoneVerifiedAt: new Date(),
    createdAt: new Date()
  });
  prisma.users.push({
    id: actorB,
    fullName: "Admin Two",
    phone: "+970590000098",
    passwordHash: "hash",
    role: UserRole.ADMIN,
    isActive: true,
    phoneVerifiedAt: new Date(),
    createdAt: new Date()
  });
  prisma.seedAuditLog({ actorUserId: actorA, action: "RESTAURANT_APPROVED" });
  prisma.seedAuditLog({ actorUserId: actorB, action: "DRIVER_SUSPENDED" });

  const byActor = await service.listAuditLog({ actorUserId: actorA } as never);
  assert.equal(byActor.total, 1);
  assert.equal(byActor.items[0].actorFullName, "Admin One");

  const byAction = await service.listAuditLog({ action: "DRIVER_SUSPENDED" } as never);
  assert.equal(byAction.total, 1);
});

test("creating an administrator stores the account, its platform role, and an audit entry", async () => {
  const { prisma, service } = createService();
  const actor = randomUUID();

  const created = await service.createAdminUser(actor, {
    fullName: "Nadia  Haddad",
    countryCode: "+970",
    phoneNumber: "0591112233",
    password: "Admin@12345",
    platformRoleKey: "SUPER_ADMIN"
  });

  assert.equal(created.role, UserRole.ADMIN);
  assert.equal(created.phone, "+970591112233");
  // Whitespace is collapsed the same way every other name entry point does it.
  assert.equal(created.fullName, "Nadia Haddad");
  const stored = prisma.users.find((user) => user.id === created.id)!;
  assert.equal((stored as unknown as { platformRoleId: string }).platformRoleId, prisma.roles[0].id);
  assert.ok(stored.phoneVerifiedAt, "there is no OTP step for an admin-created account");
  assert.equal(prisma.auditLogs.at(-1)?.action, "ADMIN_USER_CREATED");
});

test("an administrator can be created without any platform role", async () => {
  const { prisma, service } = createService();
  const created = await service.createAdminUser(randomUUID(), {
    fullName: "No Powers",
    countryCode: "+970",
    phoneNumber: "0591112244",
    password: "Admin@12345"
  });

  const stored = prisma.users.find((user) => user.id === created.id)!;
  assert.equal((stored as unknown as { platformRoleId: string | null }).platformRoleId, null);
});

test("a duplicate phone number is refused rather than creating a second account", async () => {
  const { prisma, service } = createService();
  const input = {
    fullName: "First",
    countryCode: "+970" as const,
    phoneNumber: "0591112255",
    password: "Admin@12345"
  };
  await service.createAdminUser(randomUUID(), input);

  await assert.rejects(
    service.createAdminUser(randomUUID(), { ...input, fullName: "Second" }),
    hasCode("PHONE_ALREADY_REGISTERED")
  );
  assert.equal(prisma.users.filter((user) => user.phone === "+970591112255").length, 1);
});

test("suspending an account ends its sessions and records the reason", async () => {
  const { prisma, service } = createService();
  const target = await service.createAdminUser(randomUUID(), {
    fullName: "Target",
    countryCode: "+970",
    phoneNumber: "0591112266",
    password: "Admin@12345"
  });
  prisma.refreshSessions.push({ userId: target.id, revokedAt: null });

  const suspended = await service.setUserActive(randomUUID(), target.id, {
    isActive: false,
    reason: "Left the company"
  });

  assert.equal(suspended.isActive, false);
  // A suspension has to bite on the next request, not whenever a token happens to expire.
  assert.equal(prisma.refreshSessions[0].revokedAt !== null, true);
  assert.equal(prisma.auditLogs.at(-1)?.action, "USER_SUSPENDED");
  assert.equal(prisma.auditLogs.at(-1)?.reason, "Left the company");
});

test("an administrator cannot suspend or re-role their own account", async () => {
  const { service } = createService();
  const actor = randomUUID();

  await assert.rejects(
    service.setUserActive(actor, actor, { isActive: false, reason: "Locking myself out" }),
    hasCode("ADMIN_SELF_CHANGE")
  );
  await assert.rejects(
    service.assignPlatformRole(actor, actor, { platformRoleKey: "SUPER_ADMIN" }),
    hasCode("ADMIN_SELF_CHANGE")
  );
});

test("suspending an already suspended account is refused rather than silently repeated", async () => {
  const { service } = createService();
  const target = await service.createAdminUser(randomUUID(), {
    fullName: "Target",
    countryCode: "+970",
    phoneNumber: "0591112277",
    password: "Admin@12345"
  });
  await service.setUserActive(randomUUID(), target.id, { isActive: false, reason: "First" });

  await assert.rejects(
    service.setUserActive(randomUUID(), target.id, { isActive: false, reason: "Again" }),
    hasCode("USER_STATUS_UNCHANGED")
  );
});

test("a platform role can only be given to an administrator account", async () => {
  const { prisma, service } = createService();
  const customer = prisma.seedUser({ role: UserRole.CUSTOMER });

  await assert.rejects(
    service.assignPlatformRole(randomUUID(), customer.id, { platformRoleKey: "SUPER_ADMIN" }),
    hasCode("PLATFORM_ROLE_NOT_APPLICABLE")
  );
});

test("a platform role can be removed again", async () => {
  const { prisma, service } = createService();
  const admin = await service.createAdminUser(randomUUID(), {
    fullName: "Temp Admin",
    countryCode: "+970",
    phoneNumber: "0591112288",
    password: "Admin@12345",
    platformRoleKey: "SUPER_ADMIN"
  });

  await service.assignPlatformRole(randomUUID(), admin.id, {});

  const stored = prisma.users.find((user) => user.id === admin.id)!;
  assert.equal((stored as unknown as { platformRoleId: string | null }).platformRoleId, null);
  assert.equal(prisma.auditLogs.at(-1)?.action, "PLATFORM_ROLE_ASSIGNED");
});

test("admin user search filters by role (TC-143)", async () => {
  const { prisma, service } = createService();
  prisma.seedUser({ fullName: "Alice Customer", role: UserRole.CUSTOMER });
  prisma.seedUser({ fullName: "Bob Driver", role: UserRole.DRIVER });
  prisma.seedUser({ fullName: "Carol Driver", role: UserRole.DRIVER });

  const drivers = await service.listUsers({ role: UserRole.DRIVER } as never);
  assert.equal(drivers.items.length, 2);
  assert.ok(drivers.items.every((user) => user.role === UserRole.DRIVER));
});

test("admin audit log lists entries and filters by action (TC-145)", async () => {
  const { prisma, service } = createService();
  const actor = prisma.seedUser({ fullName: "Platform Admin", role: UserRole.ADMIN });
  prisma.seedAuditLog({ actorUserId: actor.id, action: "RESTAURANT_APPROVED" });
  prisma.seedAuditLog({ actorUserId: actor.id, action: "DRIVER_SUSPENDED" });

  const all = await service.listAuditLog({} as never);
  assert.ok(all.total >= 2);

  const filtered = await service.listAuditLog({ action: "RESTAURANT_APPROVED" } as never);
  assert.ok(filtered.items.length >= 1);
  assert.ok(filtered.items.every((entry) => entry.action === "RESTAURANT_APPROVED"));
  assert.equal(filtered.items[0].actorFullName, "Platform Admin");
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof ApiException && (error.getResponse() as { code?: string }).code === code;
}

test("listUsers separates customers from staff, and a role outside the audience matches nothing", async () => {
  const { prisma, service } = createService();
  prisma.seedUser({ fullName: "Customer One", role: UserRole.CUSTOMER });
  prisma.seedUser({ fullName: "Customer Two", role: UserRole.CUSTOMER });
  prisma.seedUser({ fullName: "Store Owner", role: UserRole.RESTAURANT });
  prisma.seedUser({ fullName: "Driver", role: UserRole.DRIVER });
  prisma.seedUser({ fullName: "Admin", role: UserRole.ADMIN });

  const customers = await service.listUsers({ audience: "CUSTOMERS" } as never);
  assert.equal(customers.total, 2);
  assert.ok(customers.items.every((user) => user.role === UserRole.CUSTOMER));
  assert.ok(customers.items.every((user) => user.phone.startsWith("+970")), "each row carries the phone");

  const staff = await service.listUsers({ audience: "STAFF" } as never);
  assert.equal(staff.total, 3);
  assert.ok(staff.items.every((user) => user.role !== UserRole.CUSTOMER));

  const drivers = await service.listUsers({ audience: "STAFF", role: "DRIVER" } as never);
  assert.deepEqual(drivers.items.map((user) => user.fullName), ["Driver"]);

  const customerInStaff = await service.listUsers({ audience: "STAFF", role: "CUSTOMER" } as never);
  assert.equal(customerInStaff.total, 0);
});

/**
 * One customer's real-looking history, every amount worked out by hand in agorot.
 *
 *   A  DELIVERED  2 x labneh, regular 12.50 on sale at 9.99  = 2 x 999  = 1998
 *                 1 x bread 4.25 (no sale)                               =  425
 *                 subtotal 2423 + minimum delivery fee (within 3 km) 1000 = 3423
 *   B  DELIVERED  1 x olive oil 45.50                                    = 4550
 *                 4.448 km: 1448 m past the included 3 km -> 2 km x 1.50 + 10.00 = 1300
 *                 10% order offer on 4550                                = -455
 *                 4550 + 1300 - 455                                      = 5395
 *   C  DELIVERED  subtotal 1800 + minimum delivery fee 1000              = 2800
 *   D  CANCELLED 7777, E DELIVERY_FAILED 2501, F REJECTED 1234, G PLACED 999: not completed.
 *   Another customer's DELIVERED 100000: not this customer.
 *
 *   Completed orders: 3.  Amount spent: 3423 + 5395 + 2800 = 11618 (116.18 ILS).
 *   Cash collected would have been 3500 + 5400 + 2800 = 11700: deliberately NOT the figure used.
 */
function seedCustomerHistory() {
  const { prisma, service } = createService();
  const store = prisma.seedRestaurant({ name: "JOVO MARKET" });
  const customer = prisma.seedUser({ fullName: "Lina", role: UserRole.CUSTOMER, createdAt: new Date("2026-01-05T09:00:00Z") });
  const other = prisma.seedUser({ fullName: "Other", role: UserRole.CUSTOMER });
  const day = (date: string) => new Date(`${date}T12:00:00Z`);
  const mine = (status: OrderStatus, totalMinor: number, createdAt: Date, itemsCount = 1) =>
    prisma.seedOrder(store.id, { customerId: customer.id, status, totalMinor, createdAt, itemsCount });

  const a = mine(OrderStatus.DELIVERED, 3423, day("2026-01-10"), 2);
  const b = mine(OrderStatus.DELIVERED, 5395, day("2026-03-02"));
  const c = mine(OrderStatus.DELIVERED, 2800, day("2026-09-27"));
  mine(OrderStatus.CANCELLED, 7777, day("2026-02-01"));
  mine(OrderStatus.DELIVERY_FAILED, 2501, day("2026-04-01"));
  mine(OrderStatus.REJECTED, 1234, day("2026-05-01"));
  const open = mine(OrderStatus.PLACED, 999, day("2026-09-28"));
  prisma.seedOrder(store.id, { customerId: other.id, status: OrderStatus.DELIVERED, totalMinor: 100_000 });
  return { prisma, service, customer, other, orders: { a, b, c, open } };
}

test("the hand-computed order totals follow the platform's own pricing rules", () => {
  // Sale price is what is charged, and the delivery fee has a 10 ILS floor.
  const labneh = { priceMinor: 1250, salePriceMinor: 999 };
  assert.ok(isOnSale(labneh));
  const subtotalA = 2 * chargedUnitPriceMinor(labneh) + chargedUnitPriceMinor({ priceMinor: 425, salePriceMinor: null });
  assert.equal(subtotalA, 2423);
  const store = { latitude: 31.9, longitude: 35.2 };
  const nearby = calculateOrderFees(store, { latitude: 31.905, longitude: 35.2 }, defaultDeliveryPricing);
  assert.equal(nearby.deliveryFeeMinor, 1000, "within 3 km pays exactly the minimum fee");
  assert.equal(subtotalA + nearby.deliveryFeeMinor, 3423);

  const farther = calculateOrderFees(store, { latitude: 31.94, longitude: 35.2 }, defaultDeliveryPricing);
  assert.equal(farther.deliveryDistanceMeters, 4448);
  assert.equal(farther.deliveryFeeMinor, 1300);
  assert.equal(4550 + farther.deliveryFeeMinor - 455, 5395);

  // The cash figure differs: the reason it is not used as "amount spent".
  assert.equal(roundCashUpMinor(3423) + roundCashUpMinor(5395) + roundCashUpMinor(2800), 11700);
});

test("customer detail counts only DELIVERED orders and sums their exact totals to the agora", async () => {
  const { service, customer } = seedCustomerHistory();
  const detail = await service.getCustomerDetail(customer.id);

  assert.equal(detail.deliveredOrdersCount, 3);
  assert.equal(detail.deliveredSpentMinor, 11618);
  assert.notEqual(detail.deliveredSpentMinor, 11700, "never the shekel-rounded cash figure");
  assert.equal(detail.customer.phone, customer.phone);
  assert.ok(!("passwordHash" in detail.customer));
});

test("customer detail lists the full order history, newest first, back to the first order", async () => {
  const { service, customer, orders } = seedCustomerHistory();
  const detail = await service.getCustomerDetail(customer.id);

  assert.equal(detail.ordersCount, 7);
  assert.equal(detail.orders.length, 7);
  assert.equal(detail.orders[0].id, orders.open.id);
  assert.equal(detail.orders[6].id, orders.a.id);
  assert.deepEqual(detail.firstOrderAt, new Date("2026-01-10T12:00:00Z"));
  assert.equal(detail.orders[6].itemsCount, 2);
  assert.equal(detail.orders[6].storeName, "JOVO MARKET");
  for (let index = 1; index < detail.orders.length; index += 1) {
    assert.ok(detail.orders[index - 1].createdAt >= detail.orders[index].createdAt);
  }
  // The headline and the rows use the same field, so they reconcile exactly.
  const deliveredRows = detail.orders.filter((order) => order.status === OrderStatus.DELIVERED);
  assert.equal(deliveredRows.reduce((sum, order) => sum + order.totalMinor, 0), detail.deliveredSpentMinor);
  assert.deepEqual(
    deliveredRows.map((order) => order.id).sort(),
    [orders.a.id, orders.b.id, orders.c.id].sort()
  );
});

test("a customer with no orders has zero totals, not an error", async () => {
  const { prisma, service } = createService();
  const customer = prisma.seedUser({ role: UserRole.CUSTOMER });
  const detail = await service.getCustomerDetail(customer.id);
  assert.equal(detail.deliveredOrdersCount, 0);
  assert.equal(detail.deliveredSpentMinor, 0);
  assert.equal(detail.ordersCount, 0);
  assert.equal(detail.firstOrderAt, null);
  assert.deepEqual(detail.orders, []);
});

test("customer detail refuses staff accounts and unknown ids", async () => {
  const { prisma, service } = createService();
  const admin = prisma.seedUser({ role: UserRole.ADMIN });
  for (const id of [admin.id, randomUUID()]) {
    await assert.rejects(
      service.getCustomerDetail(id),
      (error: unknown) => error instanceof ApiException && error.getStatus() === 404
    );
  }
});

test("dashboard counts what needs attention: driver applications and orders not yet accepted", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  prisma.seedDriverProfile({ status: "PENDING" as never, isOnline: false });
  prisma.seedDriverProfile({ status: "PENDING" as never, isOnline: false });
  prisma.seedDriverProfile({ status: "APPROVED" as never });
  prisma.seedOrder(restaurant.id, { status: OrderStatus.PLACED });
  // Placed long ago and still not accepted: it still needs attention.
  prisma.seedOrder(restaurant.id, { status: OrderStatus.PLACED, createdAt: new Date("2020-01-01T00:00:00Z") });
  prisma.seedOrder(restaurant.id, { status: OrderStatus.ACCEPTED });

  const dashboard = await service.getDashboard();
  assert.equal(dashboard.pendingDriverApprovals, 2);
  assert.equal(dashboard.ordersAwaitingAcceptance, 2);
});
