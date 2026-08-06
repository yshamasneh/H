import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
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
