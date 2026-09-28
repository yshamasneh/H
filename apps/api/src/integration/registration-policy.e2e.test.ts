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
 * Business registration policy, end to end over HTTP.
 *
 * There is exactly one supermarket on this platform (JOVO MARKET) and it is created by a Super
 * Admin. Anyone may still apply for a restaurant; that application waits, closed and invisible, for
 * a Super Admin, cannot take an order while restaurant ordering is gated off, and cannot reach the
 * supermarket's data.
 */
const runDatabaseE2e = process.env.RUN_DATABASE_E2E === "true";
if (runDatabaseE2e && process.env.NODE_ENV === "production") {
  throw new Error("This E2E refuses to run with NODE_ENV=production.");
}

const password = "Policy@12345";
const local = {
  admin: "0594700001",
  customer: "0594700002",
  market: "0594700003",
  applicant: "0594700004",
  applicantWithType: "0594700005",
  attacker: "0594700006",
  tampered: "0594700007",
  staffAttempt: "0594700008"
};
const phones = Object.fromEntries(Object.entries(local).map(([key, value]) => [key, `+970${value.slice(1)}`])) as typeof local;

type Http = ReturnType<typeof request>;

const applicationBody = (phoneNumber: string, restaurantName: string) => ({
  ownerFullName: "Policy Applicant",
  countryCode: "+970",
  phoneNumber,
  password,
  confirmPassword: password,
  restaurantName,
  addressLine: "Policy Street, Ramallah",
  description: "Created by the registration-policy end-to-end test."
});

test(
  "public registration can create a restaurant but never a supermarket",
  { skip: !runDatabaseE2e, timeout: 180_000 },
  async (context) => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    const prisma = app.get(PrismaService);
    const config = app.get(ConfigService);
    const http = request(app.getHttpServer());

    const databaseName = new URL(config.getOrThrow<string>("DATABASE_URL")).pathname.toLowerCase();
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
    const superAdminRole = await prisma.role.findUnique({ where: { key: "SUPER_ADMIN" } });
    assert.ok(superAdminRole, "System roles must be migrated before running this suite.");
    await prisma.user.create({
      data: { platformRoleId: superAdminRole.id, fullName: "Policy Admin", phone: phones.admin, passwordHash, role: UserRole.ADMIN, phoneVerifiedAt: new Date(), isActive: true }
    });
    await prisma.user.create({
      data: { fullName: "Policy Customer", phone: phones.customer, passwordHash, role: UserRole.CUSTOMER, phoneVerifiedAt: new Date(), isActive: true }
    });
    const adminToken = await login(http, local.admin);
    const customerToken = await login(http, local.customer);

    // JOVO MARKET: the one supermarket, created the only way a supermarket can be.
    const marketCreated = await http
      .post("/api/v1/admin/restaurants")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        ownerFullName: "Policy Market Owner",
        countryCode: "+970",
        phoneNumber: local.market,
        password,
        businessName: "Policy JOVO MARKET",
        businessType: "SUPERMARKET",
        addressLine: "Market Street, Ramallah",
        approveImmediately: true
      })
      .expect(201);
    const marketId = marketCreated.body.id as string;
    const marketToken = await login(http, local.market);
    await http
      .patch("/api/v1/restaurant/me")
      .set("Authorization", `Bearer ${marketToken}`)
      .send({ addressLine: "Market Street", latitude: 31.9025, longitude: 35.205 })
      .expect(200);
    await http.patch("/api/v1/restaurant/me/open-status").set("Authorization", `Bearer ${marketToken}`).send({ isOpen: true }).expect(200);
    const marketCategory = await http
      .post("/api/v1/restaurant/me/menu/categories")
      .set("Authorization", `Bearer ${marketToken}`)
      .send({ name: "Policy Dairy", sortOrder: 1 })
      .expect(201);
    const marketItem = await http
      .post("/api/v1/restaurant/me/menu/items")
      .set("Authorization", `Bearer ${marketToken}`)
      .send({ categoryId: marketCategory.body.id, name: "Policy Milk", priceMinor: 700, costPriceMinor: 500 })
      .expect(201);
    const marketItemId = marketItem.body.id as string;

    const testSupermarkets = () =>
      prisma.restaurant.findMany({
        where: { businessType: BusinessType.SUPERMARKET, owner: { phone: { in: Object.values(phones) } } },
        select: { id: true }
      });

    await context.test("a public caller cannot create a supermarket, however the request is shaped", async () => {
      // Registration is throttled (5 a minute), so this sends the two shapes that matter most; the
      // full range of tampered bodies (case, padding, arrays, operators, extra fields) is covered
      // against the DTO itself in restaurants.dto.test.ts.
      const attempts: Array<[string, Record<string, unknown>]> = [
        ["plain SUPERMARKET", { businessType: "SUPERMARKET" }],
        ["SUPERMARKET with an elevated role and a status", { businessType: "SUPERMARKET", role: "ADMIN", status: "APPROVED" }]
      ];
      for (const [label, extra] of attempts) {
        const response = await http
          .post("/api/v1/restaurants/register")
          .send({ ...applicationBody(local.tampered, "Tampered Market"), ...extra });
        assert.equal(response.status, 400, `${label} must be rejected, got ${response.status}`);
      }
      assert.equal(await prisma.user.count({ where: { phone: phones.tampered } }), 0, "a rejected application creates no account");
      assert.equal((await testSupermarkets()).length, 1, "JOVO MARKET is still the only supermarket");
    });

    await context.test("only a Super Admin can create a supermarket through the admin path", async () => {
      const body = {
        ownerFullName: "Second Market Owner",
        countryCode: "+970",
        phoneNumber: local.staffAttempt,
        password,
        businessName: "Second Market",
        businessType: "SUPERMARKET",
        addressLine: "Somewhere"
      };
      await http.post("/api/v1/admin/restaurants").send(body).expect(401);
      await http.post("/api/v1/admin/restaurants").set("Authorization", `Bearer ${customerToken}`).send(body).expect(403);
      await http.post("/api/v1/admin/restaurants").set("Authorization", `Bearer ${marketToken}`).send(body).expect(403);
      assert.equal(await prisma.user.count({ where: { phone: phones.staffAttempt } }), 0);
      assert.equal((await testSupermarkets()).length, 1);
    });

    let applicantId = "";
    let applicantToken = "";
    await context.test("restaurant registration still works and lands pending, closed and owned by a restaurant account", async () => {
      const registered = await http
        .post("/api/v1/restaurants/register")
        .send(applicationBody(local.applicant, "Policy Kitchen"))
        .expect(201);
      assert.equal(registered.body.status, "PENDING");
      applicantId = registered.body.restaurantId as string;

      const business = await prisma.restaurant.findUniqueOrThrow({ where: { id: applicantId }, include: { owner: true } });
      assert.equal(business.businessType, BusinessType.RESTAURANT);
      assert.equal(business.status, RestaurantStatus.PENDING);
      assert.equal(business.isOpen, false);
      assert.equal(business.owner.role, UserRole.RESTAURANT);
      assert.equal(
        await prisma.businessMember.count({ where: { businessId: applicantId, userId: business.ownerUserId } }),
        1,
        "the owner is a member of their own business only"
      );
    });

    await context.test("an application that names RESTAURANT explicitly (older app builds) works the same way", async () => {
      const registered = await http
        .post("/api/v1/restaurants/register")
        .send({ ...applicationBody(local.applicantWithType, "Policy Grill"), businessType: "RESTAURANT" })
        .expect(201);
      assert.equal(registered.body.status, "PENDING");
      const business = await prisma.restaurant.findUniqueOrThrow({ where: { id: registered.body.restaurantId as string } });
      assert.equal(business.businessType, BusinessType.RESTAURANT);
      assert.equal(business.status, RestaurantStatus.PENDING);
    });

    await context.test("a pending restaurant is invisible to customers and cannot approve or open itself", async () => {
      applicantToken = await login(http, local.applicant);
      const me = await http.get("/api/v1/restaurant/me").set("Authorization", `Bearer ${applicantToken}`).expect(200);
      assert.equal(me.body.id, applicantId);
      assert.equal(me.body.status, "PENDING");

      // Not listed, not fetchable, no menu, not among supermarkets.
      const listed = await http.get("/api/v1/restaurants").expect(200);
      assert.ok(!JSON.stringify(listed.body).includes(applicantId));
      await http.get(`/api/v1/restaurants/${applicantId}`).expect(404);
      await http.get(`/api/v1/restaurants/${applicantId}/menu`).expect(404);
      const supermarkets = await http.get("/api/v1/supermarkets").expect(200);
      assert.ok(!JSON.stringify(supermarkets.body).includes(applicantId));

      // No self-approval: neither the admin route nor a status field on the profile edit.
      await http.post(`/api/v1/admin/restaurants/${applicantId}/approve`).set("Authorization", `Bearer ${applicantToken}`).expect(403);
      await http.patch("/api/v1/restaurant/me").set("Authorization", `Bearer ${applicantToken}`).send({ status: "APPROVED" }).expect(400);
      await http.patch("/api/v1/restaurant/me").set("Authorization", `Bearer ${applicantToken}`).send({ businessType: "SUPERMARKET" }).expect(400);
      const stillPending = await prisma.restaurant.findUniqueOrThrow({ where: { id: applicantId } });
      assert.equal(stillPending.status, RestaurantStatus.PENDING);
      assert.equal(stillPending.businessType, BusinessType.RESTAURANT);
      assert.equal(stillPending.isOpen, false);
    });

    let applicantItemId = "";
    await context.test("a pending restaurant cannot receive an order", async () => {
      const category = await http
        .post("/api/v1/restaurant/me/menu/categories")
        .set("Authorization", `Bearer ${applicantToken}`)
        .send({ name: "Policy Mains", sortOrder: 1 })
        .expect(201);
      const item = await http
        .post("/api/v1/restaurant/me/menu/items")
        .set("Authorization", `Bearer ${applicantToken}`)
        .send({ categoryId: category.body.id, name: "Policy Plate", priceMinor: 2500 })
        .expect(201);
      applicantItemId = item.body.id as string;

      const attempt = await http
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${customerToken}`)
        .send(orderFor(applicantId, applicantItemId));
      assert.ok(attempt.status >= 400 && attempt.status < 500, `a pending restaurant must refuse orders, got ${attempt.status}`);
      assert.equal(await prisma.order.count({ where: { restaurantId: applicantId } }), 0);
    });

    await context.test("a Super Admin approves it, and it still cannot take orders while restaurant ordering is gated off", async () => {
      await http.post(`/api/v1/admin/restaurants/${applicantId}/approve`).set("Authorization", `Bearer ${adminToken}`).expect(201);
      await http
        .patch("/api/v1/restaurant/me")
        .set("Authorization", `Bearer ${applicantToken}`)
        .send({ latitude: 31.9038, longitude: 35.2034 })
        .expect(200);
      await http.patch("/api/v1/restaurant/me/open-status").set("Authorization", `Bearer ${applicantToken}`).send({ isOpen: true }).expect(200);

      // The e2e runner turns the launch gate on for the other suites; switch it off for this check
      // only, exactly as a production deployment has it.
      const realGet = config.get.bind(config);
      (config as { get: unknown }).get = (key: string, ...rest: unknown[]) =>
        key === "RESTAURANT_ORDERING_ENABLED" ? false : (realGet as (...args: unknown[]) => unknown)(key, ...rest);
      try {
        const gated = await http.post("/api/v1/orders").set("Authorization", `Bearer ${customerToken}`).send(orderFor(applicantId, applicantItemId));
        assert.equal(gated.status, 409);
        assert.equal(gated.body.error?.code ?? gated.body.code, "RESTAURANT_ORDERING_DISABLED");
        assert.equal(await prisma.order.count({ where: { restaurantId: applicantId } }), 0);
        await http.get(`/api/v1/restaurants/${applicantId}`).expect(404);
      } finally {
        (config as { get: unknown }).get = realGet;
      }
    });

    await context.test("a restaurant owner cannot reach JOVO MARKET's data", async () => {
      const before = await prisma.menuItem.findUniqueOrThrow({ where: { id: marketItemId } });

      const own = await http.get("/api/v1/restaurant/me").set("Authorization", `Bearer ${applicantToken}`).expect(200);
      assert.equal(own.body.id, applicantId);
      assert.notEqual(own.body.id, marketId);

      const ownItems = await http.get("/api/v1/restaurant/me/menu/items").set("Authorization", `Bearer ${applicantToken}`).expect(200);
      assert.ok(!JSON.stringify(ownItems.body).includes(marketItemId), "the market's product is not in the restaurant's menu");

      await http
        .patch(`/api/v1/restaurant/me/menu/items/${marketItemId}`)
        .set("Authorization", `Bearer ${applicantToken}`)
        .send({ name: "Hijacked", priceMinor: 1 })
        .expect(404);
      await http.delete(`/api/v1/restaurant/me/menu/items/${marketItemId}`).set("Authorization", `Bearer ${applicantToken}`).expect(404);
      await http
        .patch(`/api/v1/restaurant/me/menu/items/${marketItemId}/availability`)
        .set("Authorization", `Bearer ${applicantToken}`)
        .send({ isAvailable: false })
        .expect(404);
      for (const path of [`/api/v1/admin/restaurants`, `/api/v1/admin/users`, `/api/v1/admin/dashboard`]) {
        await http.get(path).set("Authorization", `Bearer ${applicantToken}`).expect(403);
      }

      const after = await prisma.menuItem.findUniqueOrThrow({ where: { id: marketItemId } });
      assert.equal(after.name, before.name);
      assert.equal(after.priceMinor, before.priceMinor);
      assert.equal(after.isAvailable, before.isAvailable);
      const market = await prisma.restaurant.findUniqueOrThrow({ where: { id: marketId } });
      assert.equal(market.businessType, BusinessType.SUPERMARKET);
      assert.equal(market.status, RestaurantStatus.APPROVED);
      assert.equal((await testSupermarkets()).length, 1);
    });
  }
);

function orderFor(restaurantId: string, menuItemId: string) {
  return {
    restaurantId,
    items: [{ menuItemId, quantity: 1 }],
    deliveryLabel: "Home",
    deliveryAddressLine: "Policy Customer Address",
    deliveryLatitude: 31.9038,
    deliveryLongitude: 35.2184,
    paymentMethod: "CASH"
  };
}

async function login(http: Http, phoneNumber: string): Promise<string> {
  const response = await http.post("/api/v1/auth/login").send({ countryCode: "+970", phoneNumber, password }).expect(201);
  return response.body.accessToken as string;
}

async function cleanup(prisma: PrismaService): Promise<void> {
  const users = await prisma.user.findMany({ where: { phone: { in: Object.values(phones) } }, select: { id: true } });
  if (users.length === 0) return;
  const userIds = users.map((user) => user.id);
  const businessIds = (await prisma.restaurant.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } })).map((business) => business.id);
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorUserId: { in: userIds } }, { entityId: { in: [...userIds, ...businessIds] } }, { businessId: { in: businessIds } }] }
  });
  await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { businessId: { in: businessIds } }] } });
  await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
  // Deleting the owner cascades to the business, its menu and its memberships.
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
