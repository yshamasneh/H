import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { io as connectSocket, type Socket } from "socket.io-client";
import request from "supertest";
import { AppModule } from "../app.module";
import { hashPassword } from "../auth/crypto.util";
import { UserRole } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Security audit S5 against a real PostgreSQL database and a real listening Socket.IO server:
 * suspension, self-service deletion and sign-out end the affected live sockets after the commit,
 * and a reconnect with the old token is refused. Sign-out ends only that device's socket.
 */
const runDatabaseE2e = process.env.RUN_DATABASE_E2E === "true";
if (runDatabaseE2e && process.env.NODE_ENV === "production") {
  throw new Error("This E2E refuses to run with NODE_ENV=production.");
}

const password = "Realtime@12345";
const local = { admin: "0594620001", suspended: "0594620002", deleted: "0594620003", twoDevices: "0594620004" };
const phones = Object.fromEntries(Object.entries(local).map(([key, value]) => [key, `+970${value.slice(1)}`])) as typeof local;
const createdIds: string[] = [];

type Http = ReturnType<typeof request>;

test("live sockets end when an account is suspended, deleted or signed out", { skip: !runDatabaseE2e, timeout: 120_000 }, async (context) => {
  const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  await app.init();
  await app.listen(0, "127.0.0.1");
  const baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const prisma = app.get(PrismaService);
  const http = request(app.getHttpServer());
  const sockets: Socket[] = [];

  const databaseName = new URL(app.get(ConfigService).getOrThrow<string>("DATABASE_URL")).pathname.toLowerCase();
  if (!databaseName.includes("test")) {
    await app.close();
    throw new Error("This E2E requires a database whose name contains 'test'.");
  }
  context.after(async () => {
    for (const socket of sockets) socket.disconnect();
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
  const create = async (phone: string, role: UserRole, extra: Record<string, unknown> = {}) => {
    const user = await prisma.user.create({
      data: { fullName: `Realtime ${role}`, phone, passwordHash, role, phoneVerifiedAt: new Date(), isActive: true, ...extra }
    });
    createdIds.push(user.id);
    return user;
  };
  await create(phones.admin, UserRole.ADMIN, { platformRoleId: superAdminRole.id });
  const suspended = await create(phones.suspended, UserRole.CUSTOMER);
  await create(phones.deleted, UserRole.CUSTOMER);
  await create(phones.twoDevices, UserRole.CUSTOMER);
  const adminToken = await login(http, local.admin);

  await context.test("an admin suspension disconnects the user's socket and a reconnect is refused", async () => {
    const token = await login(http, local.suspended);
    const socket = await openSocket(baseUrl, token, sockets);
    const reason = disconnectReason(socket);
    await http
      .patch(`/api/v1/admin/users/${suspended.id}/active`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isActive: false, reason: "Realtime disconnect test" })
      .expect(200);
    assert.equal(await reason, "io server disconnect");
    await assertRefused(baseUrl, token, sockets);
  });

  await context.test("self-service deletion disconnects the user's socket", async () => {
    const token = await login(http, local.deleted);
    const socket = await openSocket(baseUrl, token, sockets);
    const reason = disconnectReason(socket);
    await http.delete("/api/v1/users/me").set("Authorization", `Bearer ${token}`).expect(204);
    assert.equal(await reason, "io server disconnect");
    await assertRefused(baseUrl, token, sockets);
  });

  await context.test("signing out ends only that device's socket", async () => {
    const phoneA = await login(http, local.twoDevices);
    const phoneB = await login(http, local.twoDevices);
    const socketA = await openSocket(baseUrl, phoneA, sockets);
    const socketB = await openSocket(baseUrl, phoneB, sockets);
    const reasonA = disconnectReason(socketA);
    await http.post("/api/v1/auth/logout").set("Authorization", `Bearer ${phoneA}`).expect(201);
    assert.equal(await reasonA, "io server disconnect");
    await sleep(300);
    assert.equal(socketB.connected, true, "the other device must stay connected");
    await assertRefused(baseUrl, phoneA, sockets);
  });
});

async function login(http: Http, phoneNumber: string): Promise<string> {
  const response = await http.post("/api/v1/auth/login").send({ countryCode: "+970", phoneNumber, password }).expect(201);
  return response.body.accessToken as string;
}

function disconnectReason(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.once("disconnect", (reason) => resolve(reason));
    setTimeout(() => reject(new Error("socket was not disconnected")), 5_000);
  });
}

async function openSocket(baseUrl: string, token: string, registry: Socket[]): Promise<Socket> {
  const socket = connectSocket(baseUrl, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
  registry.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
    setTimeout(() => reject(new Error("socket did not connect")), 5_000);
  });
  await sleep(150);
  return socket;
}

/** The gateway accepts the transport, then emits UNAUTHORIZED and disconnects an unauthenticated socket. */
async function assertRefused(baseUrl: string, token: string, registry: Socket[]): Promise<void> {
  const socket = connectSocket(baseUrl, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
  registry.push(socket);
  const code = await new Promise<string>((resolve, reject) => {
    socket.once("error", (payload: { code?: string }) => resolve(payload?.code ?? "unknown"));
    socket.once("disconnect", () => resolve("disconnected"));
    setTimeout(() => reject(new Error("a revoked token was still accepted")), 5_000);
  });
  assert.ok(code === "UNAUTHORIZED" || code === "disconnected", `unexpected refusal: ${code}`);
  await sleep(100);
  assert.equal(socket.connected, false);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
