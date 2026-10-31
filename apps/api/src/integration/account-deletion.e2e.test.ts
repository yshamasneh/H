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
import { AccountDeletionSweepService } from "../users/account-deletion-sweep.service";

/**
 * Store audit H1 against a real PostgreSQL database: the obligation queries (active deliveries,
 * unsettled cash custody, the DRIVER:<id> earnings balance), the serializable transaction, the
 * AccountDeletionRequest table and the sweep all run as written, over HTTP where the app calls them.
 */
const runDatabaseE2e = process.env.RUN_DATABASE_E2E === "true";
if (runDatabaseE2e && process.env.NODE_ENV === "production") {
  throw new Error("This E2E refuses to run with NODE_ENV=production.");
}

const password = "Deletion@12345";
const local = { driver: "0594610001", scheduled: "0594610002", staff: "0594610003", admin: "0594610004", customer: "0594610005" };
const phones = Object.fromEntries(Object.entries(local).map(([key, value]) => [key, `+970${value.slice(1)}`])) as typeof local;

type Http = ReturnType<typeof request>;
/** Ids created by this suite: anonymisation rewrites the phone, so cleanup cannot find them by phone. */
const createdIds: string[] = [];

test("drivers, store staff and admins get the right deletion outcome", { skip: !runDatabaseE2e, timeout: 120_000 }, async (context) => {
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
  const create = async (phone: string, role: UserRole, fullName: string) => {
    const user = await prisma.user.create({ data: { fullName, phone, passwordHash, role, phoneVerifiedAt: new Date(), isActive: true } });
    createdIds.push(user.id);
    return user;
  };
  const driver = await create(phones.driver, UserRole.DRIVER, "Deletion Driver");
  await prisma.driverProfile.create({
    data: { userId: driver.id, status: "APPROVED", isOnline: true, lastLatitude: 31.9, lastLongitude: 35.2, lastLocationAt: new Date() }
  });
  const scheduled = await create(phones.scheduled, UserRole.DRIVER, "Scheduled Driver");
  await prisma.driverProfile.create({ data: { userId: scheduled.id, status: "APPROVED" } });
  const staff = await create(phones.staff, UserRole.RESTAURANT, "Deletion Staff");
  await create(phones.admin, UserRole.ADMIN, "Deletion Admin");
  const customer = await create(phones.customer, UserRole.CUSTOMER, "Deletion Customer");

  await context.test("a customer is deleted at once: the anonymised phone passes the database check", async () => {
    // Regression for the User_phone_e164_check constraint that made every deletion fail with 500.
    const token = await login(http, local.customer);
    await http.delete("/api/v1/users/me").set("Authorization", `Bearer ${token}`).expect(204);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(stored.phone, `deleted-${customer.id}`);
    assert.equal(stored.isActive, false);
  });

  await context.test("the database still refuses a fake phone on a live account", async () => {
    await assert.rejects(prisma.user.update({ where: { id: staff.id }, data: { phone: `deleted-${staff.id}` } }));
    await assert.rejects(prisma.user.update({ where: { id: staff.id }, data: { phone: "deleted-someone-else", isActive: false } }));
  });

  await context.test("a driver with nothing outstanding is deleted at once (204) and cannot sign in again", async () => {
    const token = await login(http, local.driver);
    await http.get("/api/v1/users/me/deletion").set("Authorization", `Bearer ${token}`).expect(200, { status: "NONE" });
    await http.delete("/api/v1/users/me").set("Authorization", `Bearer ${token}`).expect(204);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: driver.id }, include: { driverProfile: true } });
    assert.equal(stored.isActive, false);
    assert.equal(stored.fullName, "Deleted account");
    assert.equal(stored.phone, `deleted-${driver.id}`);
    assert.equal(stored.driverProfile?.lastLatitude, null);
    assert.equal(stored.driverProfile?.isOnline, false);
    await http.post("/api/v1/auth/login").send({ countryCode: "+970", phoneNumber: local.driver, password }).expect(401);
    await http.get("/api/v1/users/me").set("Authorization", `Bearer ${token}`).expect(401);
  });

  await context.test("a scheduled deletion is completed by the sweep once it is due and nothing is outstanding", async () => {
    await prisma.accountDeletionRequest.create({
      data: { userId: scheduled.id, scheduledFor: new Date(Date.now() - 60_000), blockers: ["OUTSTANDING_CASH"] }
    });
    const completed = await app.get(AccountDeletionSweepService).processDue(new Date());
    assert.ok(completed >= 1);
    const request = await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { userId: scheduled.id } });
    assert.equal(request.status, "COMPLETED");
    assert.deepEqual(request.blockers, []);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: scheduled.id } })).isActive, false);
  });

  await context.test("store staff who do not own the store are deleted at once", async () => {
    const token = await login(http, local.staff);
    await http.delete("/api/v1/users/me").set("Authorization", `Bearer ${token}`).expect(204);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: staff.id } });
    assert.equal(stored.isActive, false);
    assert.equal(stored.fullName, "Deleted account");
  });

  await context.test("an administrator is refused and keeps the account", async () => {
    const token = await login(http, local.admin);
    const response = await http.delete("/api/v1/users/me").set("Authorization", `Bearer ${token}`).expect(409);
    assert.equal(response.body.code, "ADMIN_DELETION_REQUIRES_SECOND_ADMIN");
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { phone: phones.admin } })).isActive, true);
  });
});

async function login(http: Http, phoneNumber: string): Promise<string> {
  const response = await http.post("/api/v1/auth/login").send({ countryCode: "+970", phoneNumber, password }).expect(201);
  return response.body.accessToken as string;
}

async function cleanup(prisma: PrismaService): Promise<void> {
  const users = await prisma.user.findMany({
    where: { OR: [{ phone: { in: Object.values(phones) } }, { id: { in: createdIds } }] },
    select: { id: true }
  });
  if (users.length === 0) return;
  const userIds = users.map((user) => user.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: userIds } }, { entityId: { in: userIds } }] } });
  await prisma.accountDeletionRequest.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
