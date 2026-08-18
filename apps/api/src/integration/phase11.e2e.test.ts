import "reflect-metadata";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { AppModule } from "../app.module";
import { hashPassword } from "../auth/crypto.util";
import { UserRole } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { withFinancialTriggersDisabled } from "./financial-triggers.util";

const runDatabaseE2e = process.env.RUN_DATABASE_E2E === "true";
if (runDatabaseE2e && process.env.NODE_ENV === "production") {
  throw new Error("Phase 13 E2E refuses to run with NODE_ENV=production.");
}
// This suite exercises the restaurant vertical's full order lifecycle end-to-end (menu, offers,
// delivery, driver assignment) against the real AppModule config, not the "coming soon" launch
// gate (see orders/coming-soon-restaurant-gap.test.ts for that) — so it opts into the flag
// explicitly rather than relying on RESTAURANT_ORDERING_ENABLED's real (off) default.
// Belt and braces. The value that actually takes effect is set by scripts/run-api-e2e.mjs before
// this process starts, because imports are hoisted above this statement and ConfigModule reads the
// environment as AppModule is imported. This line only helps a run started some other way.
if (runDatabaseE2e && process.env.RESTAURANT_ORDERING_ENABLED === undefined) {
  process.env.RESTAURANT_ORDERING_ENABLED = "true";
}
const password = "Phase11@12345";
const phones = {
  admin: "+970594000001",
  customer: "+970594000002",
  restaurant: "+970594000003",
  driver: "+970594000004",
  supermarket: "+970594000005"
};

test(
  "Phase 13 connects delivery, grocery fulfillment, cash totals, and inventory procurement in one lifecycle",
  { skip: !runDatabaseE2e, timeout: 120_000 },
  async (context) => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    configureTestApp(app);
    await app.init();
    const prisma = app.get(PrismaService);
    const http = request(app.getHttpServer());
    try {
      assertSafeE2eDatabase(app.get(ConfigService).getOrThrow<string>("DATABASE_URL"));
    } catch (error) {
      await app.close();
      throw error;
    }

    context.after(async () => {
      try {
        await cleanupTestActors(prisma);
      } finally {
        await app.close();
      }
    });

    await cleanupTestActors(prisma);
    const passwordHash = await hashPassword(password);
    // This actor is inserted straight into the database rather than created through the API, so it
    // needs the platform role that administrator creation assigns.
    const superAdminRole = await prisma.role.findUnique({ where: { key: "SUPER_ADMIN" } });
    assert.ok(superAdminRole, "System roles must be migrated before running the E2E suite.");
    await prisma.user.createMany({
      data: [
        {
          platformRoleId: superAdminRole.id,
          fullName: "Phase 11 Admin",
          phone: phones.admin,
          passwordHash,
          role: UserRole.ADMIN,
          phoneVerifiedAt: new Date(),
          isActive: true
        },
        {
          fullName: "Phase 11 Customer",
          phone: phones.customer,
          passwordHash,
          role: UserRole.CUSTOMER,
          phoneVerifiedAt: new Date(),
          isActive: true
        }
      ]
    });

    const registration = await http
      .post("/api/v1/restaurants/register")
      .send({
        ownerFullName: "Phase 11 Restaurant Owner",
        countryCode: "+970",
        phoneNumber: "0594000003",
        password,
        confirmPassword: password,
        restaurantName: "Phase 11 Kitchen",
        addressLine: "Integration Street, Ramallah",
        description: "Created by the Phase 11 end-to-end test."
      })
      .expect(201);
    assert.equal(registration.body.status, "PENDING");
    const restaurantId = registration.body.restaurantId as string;

    const restaurantToken = await login(http, "0594000003");
    await http
      .patch("/api/v1/restaurant/me")
      .set("Authorization", `Bearer ${restaurantToken}`)
      .send({
        description: "A connected restaurant profile.",
        addressLine: "Updated Integration Street",
        latitude: 31.9038,
        longitude: 35.2034
      })
      .expect(200);

    const categoryResponse = await http
      .post("/api/v1/restaurant/me/menu/categories")
      .set("Authorization", `Bearer ${restaurantToken}`)
      .send({ name: "Phase 11 Mains", sortOrder: 1 })
      .expect(201);
    const categoryId = categoryResponse.body.id as string;

    const itemResponse = await http
      .post("/api/v1/restaurant/me/menu/items")
      .set("Authorization", `Bearer ${restaurantToken}`)
      .send({ categoryId, name: "Connected Meal", description: "E2E menu item", priceMinor: 2500 })
      .expect(201);
    const menuItemId = itemResponse.body.id as string;

    const adminToken = await login(http, "0594000001");
    await http
      .post(`/api/v1/admin/restaurants/${restaurantId}/approve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);
    await http
      .patch("/api/v1/restaurant/me/open-status")
      .set("Authorization", `Bearer ${restaurantToken}`)
      .send({ isOpen: true })
      .expect(200);

    const customerToken = await login(http, "0594000002");
    await http
      .post("/api/v1/admin/offers")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ type: "FREE_DELIVERY", title: "Unauthorized offer" })
      .expect(403);

    await http
      .post("/api/v1/admin/offers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        type: "PRODUCT_PERCENTAGE",
        restaurantId,
        menuItemId,
        title: "20% off Connected Meal",
        discountPercent: 20,
        minimumSubtotalMinor: 0
      })
      .expect(201);
    await http
      .post("/api/v1/admin/offers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        type: "FREE_DELIVERY",
        title: "Free delivery launch",
        minimumSubtotalMinor: 0
      })
      .expect(201);

    const publicMenu = await http.get(`/api/v1/restaurants/${restaurantId}/menu`).expect(200);
    assert.equal(publicMenu.body.categories[0].items[0].id, menuItemId);
    assert.equal(publicMenu.body.categories[0].items[0].effectivePriceMinor, 2000);

    const orderInput = {
      restaurantId,
      items: [{ menuItemId, quantity: 2 }],
      deliveryLabel: "Home",
      deliveryAddressLine: "Customer Integration Address",
      deliveryLatitude: 31.9038,
      deliveryLongitude: 35.2184,
      paymentMethod: "CASH"
    };
    const quoteResponse = await http
      .post("/api/v1/orders/quote")
      .set("Authorization", `Bearer ${customerToken}`)
      .send(orderInput)
      .expect(201);
    // 1000 from the 20% product offer plus the whole 1000 delivery fee waived by FREE_DELIVERY.
    assert.equal(quoteResponse.body.discountMinor, 2000);
    assert.equal(quoteResponse.body.totalMinor, 4000);

    const orderResponse = await http
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send(orderInput)
      .expect(201);
    const orderId = orderResponse.body.id as string;
    assert.equal(orderResponse.body.subtotalMinor, 5000);
    assert.ok(orderResponse.body.deliveryDistanceMeters > 0);
    assert.equal(orderResponse.body.discountMinor, 2000);
    assert.equal(orderResponse.body.totalMinor, 4000);
    assert.deepEqual(
      orderResponse.body.appliedPromotions.map((promotion: { type: string }) => promotion.type).sort(),
      ["FREE_DELIVERY", "PRODUCT_PERCENTAGE"]
    );

    for (const status of ["ACCEPTED", "PREPARING", "READY_FOR_PICKUP"] as const) {
      await http
        .patch(`/api/v1/restaurant/me/orders/${orderId}/status`)
        .set("Authorization", `Bearer ${restaurantToken}`)
        .send({ status })
        .expect(200);
    }

    const driverRegistration = await http
      .post("/api/v1/drivers/register")
      .send({
        fullName: "Phase 11 Driver",
        countryCode: "+970",
        phoneNumber: "0594000004",
        password,
        confirmPassword: password
      })
      .expect(201);
    const driverUserId = driverRegistration.body.userId as string;

    await http
      .post(`/api/v1/admin/drivers/${driverUserId}/approve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);
    const driverToken = await login(http, "0594000004");
    await http
      .patch("/api/v1/driver/me/status")
      .set("Authorization", `Bearer ${driverToken}`)
      .send({ isOnline: true })
      .expect(200);

    const available = await http
      .get("/api/v1/driver/me/deliveries/available")
      .set("Authorization", `Bearer ${driverToken}`)
      .expect(200);
    const delivery = available.body.find((candidate: { order: { id: string } }) => candidate.order.id === orderId);
    assert.ok(delivery, "the ready order should be available to the approved online driver");

    await http
      .post(`/api/v1/driver/me/deliveries/${delivery.id}/accept`)
      .set("Authorization", `Bearer ${driverToken}`)
      .expect(201);
    for (const status of ["PICKED_UP", "ON_THE_WAY", "DELIVERED"] as const) {
      await http
        .patch(`/api/v1/driver/me/deliveries/${delivery.id}/status`)
        .set("Authorization", `Bearer ${driverToken}`)
        .send({ status })
        .expect(200);
    }

    const delivered = await http
      .get(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${customerToken}`)
      .expect(200);
    assert.equal(delivered.body.status, "DELIVERED");
    assert.equal(delivered.body.delivery.status, "DELIVERED");

    const supermarketRegistration = await http
      .post("/api/v1/restaurants/register")
      .send({
        ownerFullName: "Phase 11 Supermarket Owner",
        countryCode: "+970",
        phoneNumber: "0594000005",
        password,
        confirmPassword: password,
        restaurantName: "Phase 11 Fresh Market",
        businessType: "SUPERMARKET",
        addressLine: "Market Integration Street, Ramallah",
        description: "Groceries created by the Phase 11 end-to-end test."
      })
      .expect(201);
    const supermarketId = supermarketRegistration.body.restaurantId as string;
    const supermarketToken = await login(http, "0594000005");

    await http
      .patch("/api/v1/restaurant/me")
      .set("Authorization", `Bearer ${supermarketToken}`)
      .send({ latitude: 31.9025, longitude: 35.2050 })
      .expect(200);
    const departmentResponse = await http
      .post("/api/v1/restaurant/me/menu/categories")
      .set("Authorization", `Bearer ${supermarketToken}`)
      .send({ name: "Dairy", sortOrder: 1 })
      .expect(201);
    const supermarketProductResponse = await http
      .post("/api/v1/restaurant/me/menu/items")
      .set("Authorization", `Bearer ${supermarketToken}`)
      .send({
        categoryId: departmentResponse.body.id,
        name: "Phase 11 Fresh Milk",
        description: "Tracked grocery product",
        priceMinor: 800,
        brand: "E2E Dairy",
        sku: "E2E-MILK-1L",
        barcode: "7290000000013",
        unitLabel: "1 L bottle",
        stockQuantity: 7,
        reorderLevel: 7,
        isFeatured: true
      })
      .expect(201);
    const supermarketProductId = supermarketProductResponse.body.id as string;
    const replacementProductResponse = await http
      .post("/api/v1/restaurant/me/menu/items")
      .set("Authorization", `Bearer ${supermarketToken}`)
      .send({
        categoryId: departmentResponse.body.id,
        name: "Phase 13 Alternative Milk",
        priceMinor: 900,
        brand: "E2E Dairy",
        sku: "E2E-MILK-ALT",
        barcode: "7290000000020",
        unitLabel: "1 L bottle",
        stockQuantity: 9,
        reorderLevel: 3
      })
      .expect(201);
    const replacementProductId = replacementProductResponse.body.id as string;

    await http
      .post(`/api/v1/admin/restaurants/${supermarketId}/approve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);
    await http
      .patch("/api/v1/restaurant/me/open-status")
      .set("Authorization", `Bearer ${supermarketToken}`)
      .send({ isOpen: true })
      .expect(200);

    const supermarkets = await http.get("/api/v1/supermarkets?page=1&pageSize=20").expect(200);
    assert.ok(supermarkets.body.items.some((store: { id: string; businessType: string }) =>
      store.id === supermarketId && store.businessType === "SUPERMARKET"
    ));
    const restaurants = await http.get("/api/v1/restaurants?page=1&pageSize=50").expect(200);
    assert.ok(!restaurants.body.items.some((store: { id: string }) => store.id === supermarketId));

    const catalog = await http
      .get(`/api/v1/supermarkets/${supermarketId}/catalog?search=milk&featured=true&page=1&pageSize=20`)
      .expect(200);
    assert.equal(catalog.body.products.length, 1);
    const catalogMilk = catalog.body.products.find((product: { id: string }) => product.id === supermarketProductId);
    assert.equal(catalogMilk.brand, "E2E Dairy");
    assert.equal(catalogMilk.stockQuantity, 7);
    assert.equal(catalog.body.departments[0].productCount, 2);

    const productDetail = await http
      .get(`/api/v1/supermarkets/${supermarketId}/products/${supermarketProductId}`)
      .expect(200);
    assert.equal(productDetail.body.product.sku, "E2E-MILK-1L");
    assert.equal(productDetail.body.product.unitLabel, "1 L bottle");

    const supermarketOrderResponse = await http
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        restaurantId: supermarketId,
        items: [{ menuItemId: supermarketProductId, quantity: 2, allowSubstitution: true }],
        deliveryLabel: "Home",
        deliveryAddressLine: "Customer Grocery Address",
        deliveryLatitude: 31.9038,
        deliveryLongitude: 35.2184,
        paymentMethod: "CASH"
      })
      .expect(201);
    const supermarketOrderId = supermarketOrderResponse.body.id as string;
    const supermarketOrderItemId = supermarketOrderResponse.body.items[0].id as string;
    assert.equal(supermarketOrderResponse.body.paymentMethod, "CASH");
    assert.equal(supermarketOrderResponse.body.items[0].unitLabelSnapshot, "1 L bottle");
    assert.equal(supermarketOrderResponse.body.items[0].allowSubstitution, true);
    assert.equal((await prisma.menuItem.findUniqueOrThrow({ where: { id: supermarketProductId } })).stockQuantity, 5);

    const proposal = await http
      .post(`/api/v1/restaurant/me/orders/${supermarketOrderId}/items/${supermarketOrderItemId}/fulfillment`)
      .set("Authorization", `Bearer ${supermarketToken}`)
      .send({ replacementMenuItemId: replacementProductId, note: "Closest available bottle" })
      .expect(201);
    const adjustmentId = proposal.body.items[0].fulfillmentAdjustment.id as string;
    assert.equal(proposal.body.requiresCustomerReview, true);
    assert.equal(proposal.body.items[0].fulfillmentAdjustment.status, "PENDING");
    assert.equal((await prisma.menuItem.findUniqueOrThrow({ where: { id: replacementProductId } })).stockQuantity, 7);

    await http
      .patch(`/api/v1/restaurant/me/orders/${supermarketOrderId}/status`)
      .set("Authorization", `Bearer ${supermarketToken}`)
      .send({ status: "ACCEPTED" })
      .expect(409);

    const approvedProposal = await http
      .post(`/api/v1/orders/${supermarketOrderId}/fulfillments/${adjustmentId}/approve`)
      .set("Authorization", `Bearer ${customerToken}`)
      .expect(201);
    assert.equal(approvedProposal.body.requiresCustomerReview, false);
    assert.equal(approvedProposal.body.items[0].lineTotalMinor, 1800);
    assert.equal((await prisma.menuItem.findUniqueOrThrow({ where: { id: supermarketProductId } })).stockQuantity, 7);

    const lowStock = await http
      .get("/api/v1/restaurant/me/inventory?lowStock=true")
      .set("Authorization", `Bearer ${supermarketToken}`)
      .expect(200);
    assert.ok(lowStock.body.items.some((item: { id: string }) => item.id === supermarketProductId));
    const barcodeLookup = await http
      .get("/api/v1/restaurant/me/inventory/barcode/7290000000013")
      .set("Authorization", `Bearer ${supermarketToken}`)
      .expect(200);
    assert.equal(barcodeLookup.body.id, supermarketProductId);

    await http
      .post(`/api/v1/orders/${supermarketOrderId}/cancel`)
      .set("Authorization", `Bearer ${customerToken}`)
      .expect(201);
    assert.equal((await prisma.menuItem.findUniqueOrThrow({ where: { id: supermarketProductId } })).stockQuantity, 7);
    assert.equal((await prisma.menuItem.findUniqueOrThrow({ where: { id: replacementProductId } })).stockQuantity, 9);

    await http
      .post(`/api/v1/restaurant/me/inventory/items/${supermarketProductId}/adjust`)
      .set("Authorization", `Bearer ${supermarketToken}`)
      .send({ quantityDelta: 3, reason: "Opening shelf count" })
      .expect(201);
    const supplier = await http
      .post("/api/v1/restaurant/me/inventory/suppliers")
      .set("Authorization", `Bearer ${supermarketToken}`)
      .send({ name: "Phase 13 Dairy Supplier", phone: "+970599000000" })
      .expect(201);
    const purchaseOrder = await http
      .post("/api/v1/restaurant/me/inventory/purchase-orders")
      .set("Authorization", `Bearer ${supermarketToken}`)
      .send({
        supplierId: supplier.body.id,
        reference: "PHASE13-PO-1",
        items: [{ menuItemId: supermarketProductId, quantity: 5, unitCostMinor: 500 }]
      })
      .expect(201);
    const receivedPurchase = await http
      .post(`/api/v1/restaurant/me/inventory/purchase-orders/${purchaseOrder.body.id}/receive`)
      .set("Authorization", `Bearer ${supermarketToken}`)
      .expect(201);
    assert.equal(receivedPurchase.body.status, "RECEIVED");
    assert.equal((await prisma.menuItem.findUniqueOrThrow({ where: { id: supermarketProductId } })).stockQuantity, 15);

    const movementLedger = await http
      .get("/api/v1/restaurant/me/inventory/movements?pageSize=50")
      .set("Authorization", `Bearer ${supermarketToken}`)
      .expect(200);
    const movementTypes = new Set(movementLedger.body.items.map((movement: { type: string }) => movement.type));
    for (const expectedType of ["ORDER_RESERVATION", "FULFILLMENT_RESERVATION", "FULFILLMENT_RELEASE", "ORDER_RESTORE", "MANUAL_ADJUSTMENT", "PURCHASE_RECEIPT"]) {
      assert.ok(movementTypes.has(expectedType), `movement ledger should contain ${expectedType}`);
    }

    const notifications = await http
      .get("/api/v1/notifications/me?page=1&pageSize=20")
      .set("Authorization", `Bearer ${customerToken}`)
      .expect(200);
    assert.ok(notifications.body.items.length >= 4);
  }
);

function configureTestApp(app: INestApplication): void {
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true
    })
  );
}

async function login(http: ReturnType<typeof request>, phoneNumber: string): Promise<string> {
  const response = await http
    .post("/api/v1/auth/login")
    .send({ countryCode: "+970", phoneNumber, password })
    .expect(201);
  return response.body.accessToken as string;
}

async function cleanupTestActors(prisma: PrismaService): Promise<void> {
  const users = await prisma.user.findMany({
    where: { phone: { in: Object.values(phones) } },
    select: { id: true, restaurant: { select: { id: true } } }
  });
  if (users.length === 0) return;
  const userIds = users.map((user) => user.id);
  const restaurantIds = users.flatMap((user) => user.restaurant ? [user.restaurant.id] : []);

  const orderFilter = {
    OR: [
      { customerId: { in: userIds } },
      ...(restaurantIds.length > 0 ? [{ restaurantId: { in: restaurantIds } }] : [])
    ]
  };
  // A delivered order now owns a financial record, and that record references the order with
  // RESTRICT — deliberately, so history cannot be erased by deleting an order. The suite's own
  // fixtures therefore have to be unwound in order, with the ledger's append-only triggers lifted
  // for the duration and put straight back.
  await withFinancialTriggersDisabled(prisma, async () => {
    const recordIds = (
      await prisma.orderFinancialRecord.findMany({ where: { order: orderFilter }, select: { id: true } })
    ).map((record) => record.id);
    if (recordIds.length > 0) {
      await prisma.cashSettlementAllocation.deleteMany({
        where: { custody: { orderFinancialRecordId: { in: recordIds } } }
      });
      await prisma.driverCashCustody.deleteMany({ where: { orderFinancialRecordId: { in: recordIds } } });
      await prisma.partnerSettlementAllocation.deleteMany({
        where: { earning: { orderFinancialRecordId: { in: recordIds } } }
      });
      await prisma.partnerEarning.deleteMany({ where: { orderFinancialRecordId: { in: recordIds } } });
      await prisma.financialAdjustment.deleteMany({ where: { orderFinancialRecordId: { in: recordIds } } });
      await prisma.orderFinancialRecord.deleteMany({ where: { id: { in: recordIds } } });
    }
    await prisma.cashSettlement.deleteMany({ where: { driverUserId: { in: userIds } } });
    if (restaurantIds.length > 0) {
      const costIds = (
        await prisma.operatingCostEntry.findMany({ where: { businessId: { in: restaurantIds } }, select: { id: true } })
      ).map((entry) => entry.id);
      const subscriptionIds = (
        await prisma.subscriptionCharge.findMany({ where: { businessId: { in: restaurantIds } }, select: { id: true } })
      ).map((charge) => charge.id);
      await prisma.partnerEarning.deleteMany({
        where: { OR: [{ operatingCostEntryId: { in: costIds } }, { subscriptionChargeId: { in: subscriptionIds } }] }
      });
      await prisma.operatingCostEntry.deleteMany({ where: { id: { in: costIds } } });
      await prisma.subscriptionCharge.deleteMany({ where: { id: { in: subscriptionIds } } });
      await prisma.partnerSettlement.deleteMany({ where: { businessId: { in: restaurantIds } } });
    }
    await prisma.partnerSettlement.deleteMany({ where: { driverUserId: { in: userIds } } });
  });
  await prisma.order.deleteMany({ where: orderFilter });
  await prisma.delivery.updateMany({ where: { driverId: { in: userIds } }, data: { driverId: null } });
  await prisma.orderStatusHistory.deleteMany({ where: { changedByUserId: { in: userIds } } });
  await prisma.offer.deleteMany({
    where: {
      OR: [
        { createdByUserId: { in: userIds } },
        ...(restaurantIds.length > 0 ? [{ restaurantId: { in: restaurantIds } }] : [])
      ]
    }
  });
  await prisma.purchaseOrder.deleteMany({
    where: {
      OR: [
        { createdByUserId: { in: userIds } },
        ...(restaurantIds.length > 0 ? [{ restaurantId: { in: restaurantIds } }] : [])
      ]
    }
  });
  await prisma.supplier.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

function assertSafeE2eDatabase(databaseUrl: string): void {
  const parsed = new URL(databaseUrl);
  const databaseName = parsed.pathname.replace(/^\//, "").toLowerCase();
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(parsed.hostname) && !databaseName.includes("test")) {
    throw new Error("Phase 13 E2E requires a local database or a database whose name contains 'test'.");
  }
}
