import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ApiException } from "../common/api.exception";
import { OrderStatus, RestaurantStatus, UserRole } from "../generated/prisma/client";
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
