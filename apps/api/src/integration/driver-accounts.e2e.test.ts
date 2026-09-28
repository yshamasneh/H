import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { AppModule } from "../app.module";
import { hashPassword } from "../auth/crypto.util";
import { UserRole } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Driver accounts, end to end over HTTP: only an administrator holding MANAGE_DRIVERS can create
 * or manage one (there is no public registration), the driver then signs in with exactly the
 * normal login and holds driver access only, and an administrator's password reset or suspension
 * takes effect on the driver's very next request.
 */
const runDatabaseE2e = process.env.RUN_DATABASE_E2E === "true";
if (runDatabaseE2e && process.env.NODE_ENV === "production") {
  throw new Error("This E2E refuses to run with NODE_ENV=production.");
}

const password = "Accounts@12345";
const local = { admin: "0594600001", powerless: "0594600002", customer: "0594600003", driver: "0594600004", renamed: "0594600005" };
const phones = Object.fromEntries(Object.entries(local).map(([key, value]) => [key, `+970${value.slice(1)}`])) as typeof local;

type Http = ReturnType<typeof request>;

test(
  "driver accounts are created and managed only through the admin system",
  { skip: !runDatabaseE2e, timeout: 120_000 },
  async (context) => {
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
    const superAdminRole = await prisma.role.findUnique({ where: { key: "SUPER_ADMIN" } });
    assert.ok(superAdminRole, "System roles must be migrated before running this suite.");
    const admin = await prisma.user.create({
      data: { platformRoleId: superAdminRole.id, fullName: "Accounts Admin", phone: phones.admin, passwordHash, role: UserRole.ADMIN, phoneVerifiedAt: new Date(), isActive: true }
    });
    // An administrator with no platform role holds no permissions at all.
    await prisma.user.create({
      data: { fullName: "Accounts Powerless Admin", phone: phones.powerless, passwordHash, role: UserRole.ADMIN, phoneVerifiedAt: new Date(), isActive: true }
    });
    await prisma.user.create({
      data: { fullName: "Accounts Customer", phone: phones.customer, passwordHash, role: UserRole.CUSTOMER, phoneVerifiedAt: new Date(), isActive: true }
    });
    const adminToken = await login(http, local.admin);
    const powerlessToken = await login(http, local.powerless);
    const customerToken = await login(http, local.customer);
    const newDriver = { fullName: "Accounts Driver", countryCode: "+970", phoneNumber: local.driver, password };

    await context.test("there is no public driver registration", async () => {
      await http
        .post("/api/v1/drivers/register")
        .send({ ...newDriver, confirmPassword: password })
        .expect(404);
      assert.equal(await prisma.user.count({ where: { phone: phones.driver } }), 0);
    });

    await context.test("only an administrator with MANAGE_DRIVERS can create a driver", async () => {
      await http.post("/api/v1/admin/drivers").send(newDriver).expect(401);
      await http.post("/api/v1/admin/drivers").set("Authorization", `Bearer ${customerToken}`).send(newDriver).expect(403);
      await http.post("/api/v1/admin/drivers").set("Authorization", `Bearer ${powerlessToken}`).send(newDriver).expect(403);
      assert.equal(await prisma.user.count({ where: { phone: phones.driver } }), 0);
      // A weak password is refused by validation.
      await http.post("/api/v1/admin/drivers").set("Authorization", `Bearer ${adminToken}`).send({ ...newDriver, password: "weak" }).expect(400);
    });

    const created = await http.post("/api/v1/admin/drivers").set("Authorization", `Bearer ${adminToken}`).send(newDriver).expect(201);
    const driverId = created.body.userId as string;

    await context.test("the created driver is approved, audited, and a duplicate phone is refused", async () => {
      assert.equal(created.body.status, "APPROVED");
      assert.equal(created.body.phone, phones.driver);
      const audit = await prisma.auditLog.findFirst({ where: { action: "DRIVER_CREATED", entityId: driverId } });
      assert.equal(audit?.actorUserId, admin.id);
      await http.post("/api/v1/admin/drivers").set("Authorization", `Bearer ${adminToken}`).send(newDriver).expect(409);
      await http
        .post("/api/v1/admin/drivers")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ ...newDriver, phoneNumber: local.customer })
        .expect(409);
    });

    let driverToken = "";
    await context.test("the driver signs in with the normal login and holds driver access only", async () => {
      driverToken = await login(http, local.driver);
      const me = await http.get("/api/v1/auth/me").set("Authorization", `Bearer ${driverToken}`).expect(200);
      assert.equal(me.body.user.role, "DRIVER");
      assert.equal(me.body.access.isSuperAdmin, false);
      assert.deepEqual(me.body.access.permissions, []);
      await http.patch("/api/v1/driver/me/status").set("Authorization", `Bearer ${driverToken}`).send({ isOnline: true }).expect(200);
      // No admin surface is reachable with a driver's token.
      for (const path of ["/api/v1/admin/drivers", `/api/v1/admin/drivers/${driverId}`, "/api/v1/admin/dashboard", "/api/v1/admin/users"]) {
        await http.get(path).set("Authorization", `Bearer ${driverToken}`).expect(403);
      }
      await http.post("/api/v1/admin/drivers").set("Authorization", `Bearer ${driverToken}`).send({ ...newDriver, phoneNumber: local.renamed }).expect(403);
    });

    await context.test("the admin sees the driver with delivery totals and history", async () => {
      const detail = await http.get(`/api/v1/admin/drivers/${driverId}`).set("Authorization", `Bearer ${adminToken}`).expect(200);
      assert.equal(detail.body.fullName, "Accounts Driver");
      assert.equal(detail.body.isOnline, true);
      assert.equal(detail.body.completedDeliveriesCount, 0);
      assert.equal(detail.body.failedDeliveriesCount, 0);
      assert.deepEqual(detail.body.recentDeliveries, []);
      await http.get(`/api/v1/admin/drivers/${admin.id}`).set("Authorization", `Bearer ${adminToken}`).expect(404);
      await http.get(`/api/v1/admin/drivers/${driverId}`).set("Authorization", `Bearer ${powerlessToken}`).expect(403);
    });

    await context.test("an admin corrects the name and phone; the driver then signs in with the new phone", async () => {
      await http.patch(`/api/v1/admin/drivers/${driverId}`).set("Authorization", `Bearer ${customerToken}`).send({ fullName: "Hijack" }).expect(403);
      const updated = await http
        .patch(`/api/v1/admin/drivers/${driverId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ fullName: "Accounts Driver Renamed", countryCode: "+970", phoneNumber: local.renamed })
        .expect(200);
      assert.equal(updated.body.fullName, "Accounts Driver Renamed");
      assert.equal(updated.body.phone, phones.renamed);
      driverToken = await login(http, local.renamed);
      await http.post("/api/v1/auth/login").send({ countryCode: "+970", phoneNumber: local.driver, password }).expect(401);
    });

    await context.test("a password set by the admin ends the driver's sessions; the new one works", async () => {
      const newPassword = "Replaced@12345";
      await http.post(`/api/v1/admin/drivers/${driverId}/password`).set("Authorization", `Bearer ${powerlessToken}`).send({ password: newPassword }).expect(403);
      await http.post(`/api/v1/admin/drivers/${driverId}/password`).set("Authorization", `Bearer ${adminToken}`).send({ password: newPassword }).expect(201);
      await http.get("/api/v1/driver/me").set("Authorization", `Bearer ${driverToken}`).expect(401);
      await http.post("/api/v1/auth/login").send({ countryCode: "+970", phoneNumber: local.renamed, password }).expect(401);
      const relogin = await http.post("/api/v1/auth/login").send({ countryCode: "+970", phoneNumber: local.renamed, password: newPassword }).expect(201);
      driverToken = relogin.body.accessToken as string;
      const profile = await http.get("/api/v1/driver/me").set("Authorization", `Bearer ${driverToken}`).expect(200);
      assert.equal(profile.body.isOnline, false, "a password reset also takes the driver off shift");
    });

    await context.test("a suspended driver cannot go on shift; reactivating restores it", async () => {
      await http.post(`/api/v1/admin/drivers/${driverId}/suspend`).set("Authorization", `Bearer ${adminToken}`).send({ reason: "Test suspension" }).expect(201);
      await http.patch("/api/v1/driver/me/status").set("Authorization", `Bearer ${driverToken}`).send({ isOnline: true }).expect(403);
      await http.post(`/api/v1/admin/drivers/${driverId}/reactivate`).set("Authorization", `Bearer ${adminToken}`).expect(201);
      await http.patch("/api/v1/driver/me/status").set("Authorization", `Bearer ${driverToken}`).send({ isOnline: true }).expect(200);
    });
  }
);

async function login(http: Http, phoneNumber: string): Promise<string> {
  const response = await http.post("/api/v1/auth/login").send({ countryCode: "+970", phoneNumber, password }).expect(201);
  return response.body.accessToken as string;
}

async function cleanup(prisma: PrismaService): Promise<void> {
  const users = await prisma.user.findMany({ where: { phone: { in: Object.values(phones) } }, select: { id: true } });
  if (users.length === 0) return;
  const userIds = users.map((user) => user.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: userIds } }, { entityId: { in: userIds } }] } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
