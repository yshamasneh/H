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
 * Run 3, task 1 on PostgreSQL with synthetic data: a PENDING_REVIEW product is not visible, not
 * searchable, not offered and not orderable for customers, while staff and admins still see and
 * edit it; once approved it behaves like any other product.
 */
const runDatabaseE2e = process.env.RUN_DATABASE_E2E === "true";
if (runDatabaseE2e && process.env.NODE_ENV === "production") {
  throw new Error("This E2E refuses to run with NODE_ENV=production.");
}

const password = "ReviewFlow@12345";
const local = { owner: "0594670001", customer: "0594670002", admin: "0594670003" };
const phones = Object.fromEntries(Object.entries(local).map(([key, value]) => [key, `+970${value.slice(1)}`])) as typeof local;
type Http = ReturnType<typeof request>;

test("pending-review products are hidden from customers and kept for staff", { skip: !runDatabaseE2e, timeout: 120_000 }, async (context) => {
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
  const superAdminRole = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "BUSINESS_ADMIN" } });
  const create = (phone: string, role: UserRole, extra: Record<string, unknown> = {}) =>
    prisma.user.create({ data: { fullName: `Review ${role}`, phone, passwordHash, role, phoneVerifiedAt: new Date(), isActive: true, ...extra } });
  const owner = await create(phones.owner, UserRole.RESTAURANT);
  await create(phones.customer, UserRole.CUSTOMER);
  await create(phones.admin, UserRole.ADMIN, { platformRoleId: superAdminRole.id });
  const store = await prisma.restaurant.create({
    data: {
      ownerUserId: owner.id, name: "Review Market", businessType: BusinessType.SUPERMARKET, status: RestaurantStatus.APPROVED,
      isOpen: true, phone: phones.owner, addressLine: "Al-Manara Square, Ramallah", latitude: 31.9038, longitude: 35.2034
    }
  });
  await prisma.businessMember.create({ data: { businessId: store.id, userId: owner.id, roleId: adminRole.id } });
  const category = await prisma.menuCategory.create({ data: { restaurantId: store.id, name: "Groceries", sortOrder: 0, isActive: true } });
  const product = (name: string, extra: Record<string, unknown> = {}) =>
    prisma.menuItem.create({
      data: { restaurantId: store.id, categoryId: category.id, name, priceMinor: 500, costPriceMinor: 300, unitLabel: "item", isAvailable: true, stockQuantity: 10, ...extra }
    });
  const approved = await product("Review approved bread");
  const pending = await product("Review pending zaatar", { reviewStatus: "PENDING_REVIEW", barcode: "0072940001234" });
  assert.equal(approved.reviewStatus, "APPROVED", "the column default keeps existing-style rows approved");
  const pendingOffer = await prisma.offer.create({
    data: { title: "Pending offer", type: "PRODUCT_PERCENTAGE", discountPercent: 10, restaurantId: store.id, menuItemId: pending.id, isActive: true, startsAt: new Date(Date.now() - 60_000) }
  });

  const [ownerToken, customerToken, adminToken] = await Promise.all([local.owner, local.customer, local.admin].map((phone) => login(http, phone)));
  const orderInput = (menuItemId: string) => ({
    restaurantId: store.id,
    items: [{ menuItemId, quantity: 1 }],
    deliveryLabel: "Home",
    deliveryAddressLine: "Al-Manara Square, Ramallah",
    deliveryLatitude: 31.9038,
    deliveryLongitude: 35.2034,
    paymentMethod: "CASH"
  });

  await context.test("customers cannot see, search, open or order a pending product", async () => {
    const catalog = await http.get(`/api/v1/supermarkets/${store.id}/catalog`).expect(200);
    const ids = catalog.body.products.map((item: { id: string }) => item.id);
    assert.ok(ids.includes(approved.id));
    assert.ok(!ids.includes(pending.id));
    const search = await http.get(`/api/v1/supermarkets/${store.id}/catalog`).query({ search: "zaatar" }).expect(200);
    assert.equal(search.body.products.length, 0);
    const byBarcode = await http.get(`/api/v1/supermarkets/${store.id}/catalog`).query({ search: "0072940001234" }).expect(200);
    assert.equal(byBarcode.body.products.length, 0);
    await http.get(`/api/v1/supermarkets/${store.id}/products/${pending.id}`).expect(404);
    const offers = await http.get("/api/v1/restaurants/offers/active").expect(200);
    assert.ok(!offers.body.some((offer: { id: string }) => offer.id === pendingOffer.id), "an offer on a pending product is hidden");
    const quote = await http.post("/api/v1/orders/quote").set("Authorization", `Bearer ${customerToken}`).send(orderInput(pending.id));
    assert.equal(quote.status, 409);
    const order = await http.post("/api/v1/orders").set("Authorization", `Bearer ${customerToken}`).send(orderInput(pending.id));
    assert.equal(order.status, 409);
    assert.equal(await prisma.order.count({ where: { restaurantId: store.id } }), 0);
  });

  await context.test("store staff and admins still see and edit the pending product", async () => {
    const staffList = await http.get("/api/v1/restaurant/me/menu/items").set("Authorization", `Bearer ${ownerToken}`).expect(200);
    const staffItem = (staffList.body.items ?? staffList.body).find((item: { id: string }) => item.id === pending.id);
    assert.equal(staffItem?.reviewStatus, "PENDING_REVIEW");
    await http.patch(`/api/v1/restaurant/me/menu/items/${pending.id}`).set("Authorization", `Bearer ${ownerToken}`).send({ description: "Edited while pending" }).expect(200);
    const adminList = await http.get(`/api/v1/admin/restaurants/${store.id}/menu/items`).set("Authorization", `Bearer ${adminToken}`).expect(200);
    assert.ok(JSON.stringify(adminList.body).includes(pending.id));
    assert.equal((await prisma.menuItem.findUniqueOrThrow({ where: { id: pending.id } })).reviewStatus, "PENDING_REVIEW", "editing does not approve");
  });

  await context.test("once approved the product is visible and orderable", async () => {
    await prisma.menuItem.update({ where: { id: pending.id }, data: { reviewStatus: "APPROVED", reviewedAt: new Date() } });
    const catalog = await http.get(`/api/v1/supermarkets/${store.id}/catalog`).expect(200);
    assert.ok(catalog.body.products.some((item: { id: string }) => item.id === pending.id));
    await http.post("/api/v1/orders/quote").set("Authorization", `Bearer ${customerToken}`).send(orderInput(pending.id)).expect(201);
    const offers = await http.get("/api/v1/restaurants/offers/active").expect(200);
    assert.ok(offers.body.some((offer: { id: string }) => offer.id === pendingOffer.id), "the offer reappears once approved");
  });
});

async function login(http: Http, phoneNumber: string): Promise<string> {
  const response = await http.post("/api/v1/auth/login").send({ countryCode: "+970", phoneNumber, password }).expect(201);
  return response.body.accessToken as string;
}

async function cleanup(prisma: PrismaService): Promise<void> {
  const users = await prisma.user.findMany({ where: { phone: { in: Object.values(phones) } }, select: { id: true } });
  if (users.length === 0) return;
  const userIds = users.map((user) => user.id);
  const stores = await prisma.restaurant.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } });
  const storeIds = stores.map((store) => store.id);
  await prisma.offer.deleteMany({ where: { restaurantId: { in: storeIds } } });
  await prisma.inventoryMovement.deleteMany({ where: { menuItem: { restaurantId: { in: storeIds } } } }).catch(() => undefined);
  await prisma.menuItem.deleteMany({ where: { restaurantId: { in: storeIds } } });
  await prisma.menuCategory.deleteMany({ where: { restaurantId: { in: storeIds } } });
  await prisma.businessMember.deleteMany({ where: { businessId: { in: storeIds } } });
  await prisma.restaurant.deleteMany({ where: { id: { in: storeIds } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: userIds } }, { entityId: { in: userIds } }] } });
  await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
