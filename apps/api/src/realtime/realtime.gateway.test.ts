import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { UserRole } from "../generated/prisma/client";
import { RealtimeGateway } from "./realtime.gateway";

function createGateway(options: {
  verify?: (token: string) => Promise<{ sub: string; typ: string; sid: string; ver: number }>;
  session?: {
    id: string;
    revokedAt: Date | null;
    expiresAt: Date;
    user: { id: string; tokenVersion: number; isActive: boolean; phoneVerifiedAt: Date | null; role: UserRole };
  } | null;
}) {
  const jwt = {
    verifyAsync: options.verify ?? (async () => {
      throw new Error("invalid token");
    })
  };
  const config = { getOrThrow: () => "test-secret" };
  const prisma = {
    refreshSession: { findUnique: async () => options.session ?? null },
    restaurant: { findUnique: async () => null }
  };
  const pushSender = { sendToUser: async () => {} };
  return new RealtimeGateway(jwt as never, config as never, prisma as never, pushSender as never);
}

function mockSocket(auth: Record<string, unknown> = {}) {
  const joined: string[] = [];
  let disconnected = false;
  const emitted: { event: string; payload: unknown }[] = [];
  return {
    handshake: { auth, headers: {} },
    data: {} as Record<string, unknown>,
    join: async (room: string) => {
      joined.push(room);
    },
    disconnect: (_close: boolean) => {
      disconnected = true;
    },
    emit: (event: string, payload: unknown) => {
      emitted.push({ event, payload });
    },
    _joined: joined,
    _isDisconnected: () => disconnected,
    _emitted: emitted
  };
}

test("a connection with no token is rejected and disconnected", async () => {
  const gateway = createGateway({});
  const socket = mockSocket();

  await gateway.handleConnection(socket as never);

  assert.equal(socket._isDisconnected(), true);
  assert.equal(socket._joined.length, 0);
  assert.ok(socket._emitted.some((event) => event.event === "error"));
});

test("a connection with an invalid/expired token is rejected and disconnected", async () => {
  const gateway = createGateway({
    verify: async () => {
      throw new Error("jwt expired");
    }
  });
  const socket = mockSocket({ token: "garbage" });

  await gateway.handleConnection(socket as never);

  assert.equal(socket._isDisconnected(), true);
});

test("a connection with a valid token but no matching session is rejected", async () => {
  const gateway = createGateway({
    verify: async () => ({ sub: randomUUID(), typ: "access", sid: randomUUID(), ver: 0 }),
    session: null
  });
  const socket = mockSocket({ token: "valid-looking-token" });

  await gateway.handleConnection(socket as never);

  assert.equal(socket._isDisconnected(), true);
});

test("a connection with a valid token and active session is accepted and joins its user room", async () => {
  const userId = randomUUID();
  const sessionId = randomUUID();
  const gateway = createGateway({
    verify: async () => ({ sub: userId, typ: "access", sid: sessionId, ver: 0 }),
    session: {
      id: sessionId,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: userId, tokenVersion: 0, isActive: true, phoneVerifiedAt: new Date(), role: UserRole.CUSTOMER }
    }
  });
  const socket = mockSocket({ token: "valid-token" });

  await gateway.handleConnection(socket as never);

  assert.equal(socket._isDisconnected(), false);
  assert.ok(socket._joined.includes(`user:${userId}`));
});

test("a revoked session is rejected even with a structurally valid token", async () => {
  const userId = randomUUID();
  const sessionId = randomUUID();
  const gateway = createGateway({
    verify: async () => ({ sub: userId, typ: "access", sid: sessionId, ver: 0 }),
    session: {
      id: sessionId,
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: userId, tokenVersion: 0, isActive: true, phoneVerifiedAt: new Date(), role: UserRole.CUSTOMER }
    }
  });
  const socket = mockSocket({ token: "valid-token" });

  await gateway.handleConnection(socket as never);

  assert.equal(socket._isDisconnected(), true);
});

test("sendPush delegates to the push sender without awaiting it", () => {
  const calls: { userId: string; message: unknown }[] = [];
  const pushSender = {
    sendToUser: async (userId: string, message: unknown) => {
      calls.push({ userId, message });
    }
  };
  const gateway = new RealtimeGateway({} as never, {} as never, {} as never, pushSender as never);

  gateway.sendPush("user-1", { title: "New order", body: "You have a new order." });

  assert.deepEqual(calls, [{ userId: "user-1", message: { title: "New order", body: "You have a new order." } }]);
});
