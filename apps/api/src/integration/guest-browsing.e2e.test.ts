import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { AppModule } from "../app.module";
import { hashPassword } from "../auth/crypto.util";
import { BusinessType, RestaurantStatus, UserRole } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Store audit H2 (guest browsing) on PostgreSQL: the single store's catalogue, product detail,
 * status, public offers and delivery area answer without a token and expose no private field
 * (cost price, owner, customers); every account endpoint still answers 401 without a token.
 */
const runDatabaseE2e = process.env.RUN_DATABASE_E2E === "true";
if (runDatabaseE2e && process.env.NODE_ENV === "production") {
  throw new Error("This E2E refuses to run with NODE_ENV=production.");
}

const password = "GuestBrowse@12345";
const local = { owner: "0594640001", customer: "0594640002" };
const phones = Object.fromEntries(Object.entries(local).map(([key, value]) => [key, `+970${value.slice(1)}`])) as typeof local;

test("guests browse the catalogue; account endpoints stay protected", { skip: !runDatabaseE2e, timeout: 120_000 }, async (context) => {
  const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  await app.init();
  const prisma = app.get(PrismaService);
  const http = request(app.getHttpServer());

  const databaseName = new URL(app.get(ConfigService).getOrThrow<string>("DATABASE_URL")).pathname.toLowerCase();
  if (!databaseName.includes("test")) {
    await app.close();
    throw new Error("This E2E requires a database whose name contains 'test'.");
  }
  context.after(async () => {
    try {
      await cleanup(prisma);
    } finally {
      await app.close();
    }
  });
  await cleanup(prisma);

  const passwordHash = await hashPassword(password);
  const owner = await prisma.user.create({
    data: { fullName: "Guest Store Owner", phone: phones.owner, passwordHash, role: UserRole.RESTAURANT, phoneVerifiedAt: new Date(), isActive: true }
  });
  await prisma.user.create({
    data: { fullName: "Guest Customer", phone: phones.customer, passwordHash, role: UserRole.CUSTOMER, phoneVerifiedAt: new Date(), isActive: true }
  });
  const store = await prisma.restaurant.create({
    data: {
      ownerUserId: owner.id,
      name: "Guest Market",
      businessType: BusinessType.SUPERMARKET,
      status: RestaurantStatus.APPROVED,
      isOpen: true,
      phone: phones.owner,
      addressLine: "Guest street",
      latitude: 31.9038,
      longitude: 35.2034
    }
  });
  const category = await prisma.menuCategory.create({ data: { restaurantId: store.id, name: "Groceries", sortOrder: 0, isActive: true } });
  const item = await prisma.menuItem.create({
    data: { restaurantId: store.id, categoryId: category.id, name: "Guest bread", priceMinor: 500, costPriceMinor: 300, unitLabel: "item", isAvailable: true, stockQuantity: 10 }
  });

  await context.test("the public catalogue answers without a token and hides private fields", async () => {
    const catalog = await http.get(`/api/v1/supermarkets/${store.id}/catalog`).expect(200);
    const serialized = JSON.stringify(catalog.body);
    assert.ok(catalog.body.products.some((product: { id: string }) => product.id === item.id));
    for (const forbidden of ["costPriceMinor", "ownerUserId", "passwordHash", "customerId", phones.customer]) {
      assert.ok(!serialized.includes(forbidden), `catalogue leaks ${forbidden}`);
    }
    const product = await http.get(`/api/v1/supermarkets/${store.id}/products/${item.id}`).expect(200);
    assert.ok(!JSON.stringify(product.body).includes("costPriceMinor"));
    await http.get(`/api/v1/supermarkets/${store.id}/status`).expect(200);
    await http.get("/api/v1/supermarkets").expect(200);
    await http.get("/api/v1/restaurants/offers/active").expect(200);
    const area = await http.get(`/api/v1/supermarkets/${store.id}/delivery-area`).expect(200);
    assert.equal(typeof area.body.maximumDistanceMeters, "number");
    assert.ok(area.body.maximumDistanceMeters > 0);
    assert.deepEqual(Object.keys(area.body).sort(), ["addressLine", "maximumDistanceMeters"]);
  });

  await context.test("account endpoints refuse a guest (no token)", async () => {
    const protectedRoutes: Array<[string, string]> = [
      ["get", "/api/v1/users/me"],
      ["get", "/api/v1/users/me/addresses"],
      ["get", "/api/v1/orders/me"],
      ["post", "/api/v1/orders"],
      ["post", "/api/v1/orders/quote"],
      ["get", "/api/v1/notifications/me"],
      ["get", "/api/v1/settings"],
      ["get", "/api/v1/landmarks"],
      ["delete", "/api/v1/users/me"]
    ];
    for (const [method, path] of protectedRoutes) {
      const response = await (http as unknown as Record<string, (path: string) => request.Test>)[method](path).send({});
      assert.equal(response.status, 401, `${method.toUpperCase()} ${path} answered ${response.status}`);
    }
  });

  await context.test("a signed-in customer sees the same catalogue and keeps account access", async () => {
    const login = await http.post("/api/v1/auth/login").send({ countryCode: "+970", phoneNumber: local.customer, password }).expect(201);
    const token = login.body.accessToken as string;
    await http.get(`/api/v1/supermarkets/${store.id}/catalog`).set("Authorization", `Bearer ${token}`).expect(200);
    await http.get("/api/v1/users/me").set("Authorization", `Bearer ${token}`).expect(200);
  });

  await context.test("an unapproved or unknown store has no public delivery area", async () => {
    await http.get("/api/v1/supermarkets/00000000-0000-4000-8000-000000000000/delivery-area").expect(404);
  });
});

async function cleanup(prisma: PrismaService): Promise<void> {
  const users = await prisma.user.findMany({ where: { phone: { in: Object.values(phones) } }, select: { id: true } });
  if (users.length === 0) return;
  const userIds = users.map((user) => user.id);
  const stores = await prisma.restaurant.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } });
  const storeIds = stores.map((store) => store.id);
  await prisma.menuItem.deleteMany({ where: { restaurantId: { in: storeIds } } });
  await prisma.menuCategory.deleteMany({ where: { restaurantId: { in: storeIds } } });
  await prisma.restaurant.deleteMany({ where: { id: { in: storeIds } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
