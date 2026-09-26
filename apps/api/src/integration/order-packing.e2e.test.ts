import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import assert from "node:assert/strict";
import { test } from "node:test";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { AppModule } from "../app.module";
import { hashPassword } from "../auth/crypto.util";
import { BusinessType, RestaurantStatus, UserRole } from "../generated/prisma/client";
import { OrdersService } from "../orders/orders.service";
import { PrismaService } from "../prisma/prisma.service";

const runDatabaseE2e = process.env.RUN_DATABASE_E2E === "true";
const password = "Pack@12345";
const phones = {
  owner: "+970594910001",
  staff: "+970594910002",
  rivalOwner: "+970594910003",
  customer: "+970594910004"
};
const local = (phone: string) => `0${phone.slice(4)}`;

type PackingEvent = { orderId: string; orderItemId: string; isPicked: boolean };

/** Collects `order.packing.changed` for one connected user; resolves waiters as events arrive. */
function listen(socket: Socket) {
  const received: PackingEvent[] = [];
  const waiters: Array<() => void> = [];
  socket.on("order.packing.changed", (event: PackingEvent) => {
    received.push(event);
    waiters.splice(0).forEach((wake) => wake());
  });
  return {
    received,
    /** Resolves once `count` events have arrived, or rejects after `ms`. */
    async next(count: number, ms = 4_000): Promise<PackingEvent[]> {
      const deadline = Date.now() + ms;
      while (received.length < count) {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`timed out waiting for ${count} packing event(s); got ${received.length}`);
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, left);
        });
      }
      return received.slice();
    }
  };
}

function connect(url: string, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(url, { auth: { token }, transports: ["websocket"], reconnection: false });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
    socket.once("error", (error: unknown) => reject(new Error(`socket rejected: ${JSON.stringify(error)}`)));
  });
}

test(
  "shared packing state: HTTP is authenticated and tenant-scoped, and a tick reaches other devices over a real socket",
  { skip: !runDatabaseE2e, timeout: 120_000 },
  async (context) => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    // A real listening server: the socket.io gateway needs one, and real clients connect to it.
    await app.listen(0, "127.0.0.1");
    const baseUrl = (await app.getUrl()).replace("[::1]", "127.0.0.1");
    const prisma = app.get(PrismaService);
    const orders = app.get(OrdersService);
    const http = request(app.getHttpServer());

    if (!new URL(app.get(ConfigService).getOrThrow<string>("DATABASE_URL")).pathname.toLowerCase().includes("test")) {
      await app.close();
      throw new Error("This E2E requires a database whose name contains 'test'.");
    }

    const sockets: Socket[] = [];
    const cleanup = async () => {
      const users = await prisma.user.findMany({ where: { phone: { in: Object.values(phones) } }, select: { id: true } });
      const userIds = users.map((user) => user.id);
      if (userIds.length === 0) return;
      const restaurants = await prisma.restaurant.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } });
      const restaurantIds = restaurants.map((restaurant) => restaurant.id);
      await prisma.order.deleteMany({ where: { customerId: { in: userIds } } });
      if (restaurantIds.length > 0) {
        await prisma.inventoryMovement.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
        await prisma.menuItem.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
        await prisma.menuCategory.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
      }
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.businessMember.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.restaurant.deleteMany({ where: { id: { in: restaurantIds } } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
      await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    };
    context.after(async () => {
      sockets.forEach((socket) => socket.close());
      try {
        await cleanup();
      } finally {
        await app.close();
      }
    });
    await cleanup();

    // --- actors: two businesses; the first has an owner and a staff member ------------------
    const passwordHash = await hashPassword(password);
    const makeUser = (fullName: string, phone: string, role: UserRole) =>
      prisma.user.create({ data: { fullName, phone, passwordHash, role, phoneVerifiedAt: new Date(), isActive: true } });
    const [owner, staff, rivalOwner, customer] = await Promise.all([
      makeUser("Pack Owner", phones.owner, UserRole.RESTAURANT),
      makeUser("Pack Staff", phones.staff, UserRole.RESTAURANT),
      makeUser("Rival Owner", phones.rivalOwner, UserRole.RESTAURANT),
      makeUser("Pack Customer", phones.customer, UserRole.CUSTOMER)
    ]);
    const adminRole = await prisma.role.findUnique({ where: { key: "BUSINESS_ADMIN" } });
    const staffRole = await prisma.role.findUnique({ where: { key: "BUSINESS_STAFF" } });
    assert.ok(adminRole && staffRole, "System roles must be migrated before running the E2E suite.");

    const makeBusiness = (ownerUserId: string, name: string, phone: string) =>
      prisma.restaurant.create({
        data: {
          ownerUserId, name, businessType: BusinessType.SUPERMARKET, status: RestaurantStatus.APPROVED,
          isOpen: true, phone, addressLine: "Al-Manara Square, Ramallah", latitude: 31.9038, longitude: 35.2034
        }
      });
    const business = await makeBusiness(owner.id, "Pack Market", phones.owner);
    const rival = await makeBusiness(rivalOwner.id, "Rival Market", phones.rivalOwner);
    await prisma.businessMember.createMany({
      data: [
        { businessId: business.id, userId: owner.id, roleId: adminRole.id },
        { businessId: business.id, userId: staff.id, roleId: staffRole.id },
        { businessId: rival.id, userId: rivalOwner.id, roleId: adminRole.id }
      ]
    });
    const category = await prisma.menuCategory.create({ data: { restaurantId: business.id, name: "Groceries", sortOrder: 0, isActive: true } });
    const products = await Promise.all(["Milk", "Bread"].map((name) =>
      prisma.menuItem.create({
        data: { restaurantId: business.id, categoryId: category.id, name, priceMinor: 500, costPriceMinor: 300, unitLabel: "item", isAvailable: true, stockQuantity: 50 }
      })
    ));

    const login = async (phone: string) => {
      const response = await http.post("/api/v1/auth/login").send({ countryCode: "+970", phoneNumber: local(phone), password }).expect(201);
      return (response.body.accessToken ?? response.body.tokens?.accessToken) as string;
    };
    const [ownerToken, staffToken, rivalToken, customerToken] = await Promise.all([
      login(phones.owner), login(phones.staff), login(phones.rivalOwner), login(phones.customer)
    ]);
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

    const order = await orders.createOrder(customer.id, {
      restaurantId: business.id,
      items: products.map((product) => ({ menuItemId: product.id, quantity: 1 })),
      deliveryLabel: "Home",
      deliveryAddressLine: "Al-Manara Square, Ramallah",
      deliveryLatitude: 31.9038,
      deliveryLongitude: 35.2034,
      paymentMethod: "CASH"
    } as never);
    const [milk, bread] = order.items;
    const pickedUrl = (itemId: string) => `/api/v1/restaurant/me/orders/${order.id}/items/${itemId}/picked`;

    // --- authentication, permission and tenancy over real HTTP -------------------------------
    await http.put(pickedUrl(milk.id)).send({ isPicked: true }).expect(401);
    await http.put(pickedUrl(milk.id)).set(auth(customerToken)).send({ isPicked: true }).expect(403);
    await http.put(pickedUrl(milk.id)).set(auth(rivalToken)).send({ isPicked: true }).expect(404);
    await http.put(pickedUrl(milk.id)).set(auth(ownerToken)).send({ isPicked: "yes" }).expect(400);
    await http.put(pickedUrl(milk.id)).set(auth(ownerToken)).send({ isPicked: true }).expect(409); // still PLACED

    for (const status of ["ACCEPTED", "PREPARING"]) {
      await http.patch(`/api/v1/restaurant/me/orders/${order.id}/status`).set(auth(ownerToken)).send({ status }).expect(200);
    }

    // --- real sockets: owner, staff on another device, a rival business, and the customer -------
    const ownerSocket = await connect(baseUrl, ownerToken);
    const staffSocket = await connect(baseUrl, staffToken);
    const rivalSocket = await connect(baseUrl, rivalToken);
    const customerSocket = await connect(baseUrl, customerToken);
    sockets.push(ownerSocket, staffSocket, rivalSocket, customerSocket);
    const onOwner = listen(ownerSocket);
    const onStaff = listen(staffSocket);
    const onRival = listen(rivalSocket);
    const onCustomer = listen(customerSocket);
    // Room joins happen server-side after connect; give them a moment to complete.
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Staff ticks the milk on their device.
    const ticked = await http.put(pickedUrl(milk.id)).set(auth(staffToken)).send({ isPicked: true }).expect(200);
    assert.equal(ticked.body.items.find((item: { id: string }) => item.id === milk.id).isPicked, true);
    assert.equal(ticked.body.items.find((item: { id: string }) => item.id === bread.id).isPicked, false);

    // The owner's device hears about it live — nobody refetched.
    const seenByOwner = await onOwner.next(1);
    assert.deepEqual(seenByOwner[0], { orderId: order.id, orderItemId: milk.id, isPicked: true });
    // ... and so does the staff member's own device (a second tab of theirs would).
    assert.deepEqual((await onStaff.next(1))[0], seenByOwner[0]);

    // Owner unticks it; the staff device follows.
    await http.put(pickedUrl(milk.id)).set(auth(ownerToken)).send({ isPicked: false }).expect(200);
    const seenByStaff = await onStaff.next(2);
    assert.deepEqual(seenByStaff[1], { orderId: order.id, orderItemId: milk.id, isPicked: false });

    // A device that opens the order later reads the same server truth.
    await http.put(pickedUrl(bread.id)).set(auth(ownerToken)).send({ isPicked: true }).expect(200);
    const reread = await http.get(`/api/v1/restaurant/me/orders/${order.id}`).set(auth(staffToken)).expect(200);
    assert.deepEqual(
      reread.body.items.map((item: { id: string; isPicked: boolean }) => [item.id === milk.id ? "milk" : "bread", item.isPicked]),
      [["milk", false], ["bread", true]]
    );
    const persisted = await prisma.orderItem.findUnique({ where: { id: bread.id } });
    assert.equal(persisted?.isPicked, true);
    assert.ok(persisted?.pickedAt);

    // Nobody outside the business hears any of it.
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(onRival.received.length, 0, "another business must not receive this order's packing events");
    assert.equal(onCustomer.received.length, 0, "the customer must not receive packing events");
    assert.equal(onOwner.received.length, 3);

    // Ticks are cleared when the order is cancelled, and that is visible to everyone as well.
    await orders.adminCancelOrder(owner.id, order.id, "Test cancellation");
    const after = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    assert.deepEqual(after.map((item) => item.isPicked), [false, false]);
    await http.put(pickedUrl(milk.id)).set(auth(ownerToken)).send({ isPicked: true }).expect(409);
  }
);
