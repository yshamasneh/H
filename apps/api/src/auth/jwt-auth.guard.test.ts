import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { ExecutionContext } from "@nestjs/common";
import { ApiException } from "../common/api.exception";
import { UserRole } from "../generated/prisma/client";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { FakePrisma } from "./testing/fake-prisma";

const accessSecret = "access-test-secret-that-is-longer-than-thirty-two-characters";

function contextWithBearer(token: string | null): ExecutionContext {
  const request = {
    header: (name: string) =>
      name.toLowerCase() === "authorization" && token ? `Bearer ${token}` : undefined
  };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

async function setup() {
  const prisma = new FakePrisma();
  const config = new ConfigService({ JWT_ACCESS_SECRET: accessSecret });
  const jwt = new JwtService();
  const guard = new JwtAuthGuard(jwt, config, prisma as never);
  const user = await prisma.user.create({
    data: {
      fullName: "Guarded",
      phone: "+970590000001",
      passwordHash: "hash",
      role: UserRole.CUSTOMER,
      phoneVerifiedAt: new Date(),
      isActive: true,
      tokenVersion: 0
    }
  });
  const session = await prisma.refreshSession.create({
    data: { userId: user.id, tokenHash: "hash", expiresAt: new Date(Date.now() + 86_400_000) }
  });
  const sign = (ver: number) =>
    jwt.signAsync(
      { sub: user.id, role: user.role, sid: session.id, ver, typ: "access" },
      { secret: accessSecret, expiresIn: 900 }
    );
  return { prisma, guard, user, sign };
}

test("JwtAuthGuard accepts a current token then rejects it once tokenVersion is bumped (TC-017)", async () => {
  const { prisma, guard, user, sign } = await setup();
  const token = await sign(0);

  // Valid while the token's version matches the user's.
  assert.equal(await guard.canActivate(contextWithBearer(token)), true);

  // A password reset / account deletion bumps tokenVersion — the old token is now stale.
  user.tokenVersion = 1;
  await assert.rejects(guard.canActivate(contextWithBearer(token)), hasCode("UNAUTHORIZED"));
  void prisma;
});

test("JwtAuthGuard rejects a missing or malformed Authorization header (TC-017)", async () => {
  const { guard } = await setup();
  await assert.rejects(guard.canActivate(contextWithBearer(null)), hasCode("UNAUTHORIZED"));
  await assert.rejects(guard.canActivate(contextWithBearer("not-a-jwt")), hasCode("UNAUTHORIZED"));
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof ApiException && (error.getResponse() as { code?: string }).code === code;
}
