import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { ApiException } from "../common/api.exception";
import { OtpPurpose, UserRole } from "../generated/prisma/client";
import { AuthorizationService } from "../common/authorization/authorization.service";
import { AuthService } from "./auth.service";
import { hashPassword } from "./crypto.util";
import type { OtpDelivery, OtpProvider } from "./otp.provider";
import { FakePrisma } from "./testing/fake-prisma";

const signupInput = {
  fullName: "New Customer",
  countryCode: "+970" as const,
  phoneNumber: "0591234567",
  password: "Signup@123",
  confirmPassword: "Signup@123"
};

class CapturingOtpProvider implements OtpProvider {
  readonly deliveries: OtpDelivery[] = [];
  async send(delivery: OtpDelivery): Promise<void> {
    this.deliveries.push(delivery);
  }

  latest(purpose?: OtpPurpose): OtpDelivery {
    const deliveries = purpose
      ? this.deliveries.filter((item) => item.purpose === purpose)
      : this.deliveries;
    const delivery = deliveries.at(-1);
    if (!delivery) throw new Error("No OTP was delivered");
    return delivery;
  }
}

function createContext() {
  const prisma = new FakePrisma();
  const otp = new CapturingOtpProvider();
  const config = new ConfigService({
    OTP_HASH_SECRET: "otp-test-secret-that-is-longer-than-thirty-two-characters",
    JWT_ACCESS_SECRET: "access-test-secret-that-is-longer-than-thirty-two-characters",
    JWT_REFRESH_SECRET: "refresh-test-secret-that-is-longer-than-thirty-two-characters",
    JWT_ACCESS_EXPIRATION_SECONDS: 900,
    JWT_REFRESH_EXPIRATION_DAYS: 30,
    OTP_EXPIRATION_MINUTES: 5,
    OTP_RESEND_COOLDOWN_SECONDS: 60,
    OTP_MAX_ATTEMPTS: 5,
    PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES: 10
  });
  const authorization = new AuthorizationService(prisma as never);
  const auth = new AuthService(prisma as never, config, new JwtService(), authorization, otp);
  return { prisma, otp, auth };
}

async function seedCustomer(prisma: FakePrisma, password = "Test@12345", phone = "+970590000000") {
  return prisma.createVerifiedCustomer({ phone, passwordHash: await hashPassword(password) });
}

async function requestSignup(context: ReturnType<typeof createContext>) {
  await context.auth.requestCustomerSignupCode(signupInput);
  return context.otp.latest(OtpPurpose.CUSTOMER_SIGNUP).code;
}

test("refuses signup for an existing normalized phone and sends no OTP", async () => {
  const context = createContext();
  await seedCustomer(context.prisma, "Test@12345", "+970591234567");
  await assert.rejects(
    context.auth.requestCustomerSignupCode(signupInput),
    hasCode("PHONE_ALREADY_REGISTERED")
  );
  assert.equal(context.otp.deliveries.length, 0);
  assert.equal(context.prisma.users.length, 1);
});

test("does not create a user before signup OTP verification", async () => {
  const context = createContext();
  await requestSignup(context);
  assert.equal(context.prisma.users.length, 0);
  assert.equal(context.prisma.pendingRegistrations.length, 1);
});

test("rejects an incorrect signup OTP and records the attempt", async () => {
  const context = createContext();
  await requestSignup(context);
  await assert.rejects(
    context.auth.verifyCustomerSignupCode({
      countryCode: "+970",
      phoneNumber: "0591234567",
      code: "000000"
    }),
    hasCode("OTP_INVALID")
  );
  assert.equal(context.prisma.challenges[0].attemptCount, 1);
  assert.equal(context.prisma.users.length, 0);
});

test("rejects an expired signup OTP", async () => {
  const context = createContext();
  const code = await requestSignup(context);
  context.prisma.challenges[0].expiresAt = new Date(Date.now() - 1);
  await assert.rejects(
    context.auth.verifyCustomerSignupCode({
      countryCode: "+970",
      phoneNumber: "0591234567",
      code
    }),
    hasCode("OTP_EXPIRED")
  );
});

test("rejects a consumed OTP", async () => {
  const context = createContext();
  const code = await requestSignup(context);
  await context.auth.verifyCustomerSignupCode({
    countryCode: "+970",
    phoneNumber: "0591234567",
    code
  });
  await assert.rejects(
    context.auth.verifyCustomerSignupCode({
      countryCode: "+970",
      phoneNumber: "0591234567",
      code
    }),
    hasCode("OTP_ALREADY_USED")
  );
});

test("enforces the maximum OTP attempt limit", async () => {
  const context = createContext();
  await requestSignup(context);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(
      context.auth.verifyCustomerSignupCode({
        countryCode: "+970",
        phoneNumber: "0591234567",
        code: "000000"
      }),
      hasCode("OTP_INVALID")
    );
  }
  await assert.rejects(
    context.auth.verifyCustomerSignupCode({
      countryCode: "+970",
      phoneNumber: "0591234567",
      code: "000000"
    }),
    hasCode("OTP_TOO_MANY_ATTEMPTS")
  );
  assert.equal(context.prisma.challenges[0].attemptCount, 5);
});

test("enforces the OTP resend cooldown", async () => {
  const context = createContext();
  await requestSignup(context);
  await assert.rejects(
    context.auth.requestCustomerSignupCode(signupInput),
    hasCode("OTP_RESEND_COOLDOWN")
  );
  assert.equal(context.otp.deliveries.length, 1);
});

test("resending invalidates the older OTP", async () => {
  const context = createContext();
  const olderCode = await requestSignup(context);
  context.prisma.challenges[0].resendAvailableAt = new Date(Date.now() - 1);
  await context.auth.requestCustomerSignupCode(signupInput);
  assert.equal(context.prisma.challenges.length, 2);
  assert.ok(context.prisma.challenges[0].consumedAt);
  await assert.rejects(
    context.auth.verifyCustomerSignupCode({
      countryCode: "+970",
      phoneNumber: "0591234567",
      code: olderCode
    }),
    hasCode("OTP_INVALID")
  );
});

test("successful signup creates only a verified active CUSTOMER", async () => {
  const context = createContext();
  const code = await requestSignup(context);
  const result = await context.auth.verifyCustomerSignupCode({
    countryCode: "+970",
    phoneNumber: "0591234567",
    code
  });
  assert.equal(context.prisma.users.length, 1);
  assert.equal(result.user.role, UserRole.CUSTOMER);
  assert.equal(result.user.phone, "+970591234567");
  assert.ok(context.prisma.users[0].phoneVerifiedAt);
  assert.equal(context.prisma.users[0].isActive, true);
  assert.equal(context.prisma.pendingRegistrations.length, 0);
  assert.ok(result.accessToken);
  assert.ok(result.refreshToken);
});

test("concurrent signup verification creates exactly one customer", async () => {
  const context = createContext();
  const code = await requestSignup(context);
  const input = { countryCode: "+970" as const, phoneNumber: "0591234567", code };
  const results = await Promise.allSettled([
    context.auth.verifyCustomerSignupCode(input),
    context.auth.verifyCustomerSignupCode(input)
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(context.prisma.users.length, 1);
});

test("logs in with the seeded test customer", async () => {
  const context = createContext();
  await seedCustomer(context.prisma);
  const result = await context.auth.login({
    countryCode: "+970",
    phoneNumber: "0590000000",
    password: "Test@12345"
  });
  assert.equal(result.user.phone, "+970590000000");
  assert.equal(result.user.role, UserRole.CUSTOMER);
});

test("rejects an incorrect login password with a generic error", async () => {
  const context = createContext();
  await seedCustomer(context.prisma);
  await assert.rejects(
    context.auth.login({ countryCode: "+970", phoneNumber: "0590000000", password: "Wrong@123" }),
    hasCode("INVALID_CREDENTIALS")
  );
});

test("starts password reset only for an existing account", async () => {
  const context = createContext();
  await seedCustomer(context.prisma);
  await context.auth.requestPasswordResetCode({ countryCode: "+970", phoneNumber: "0590000000" });
  assert.equal(context.otp.latest().purpose, OtpPurpose.PASSWORD_RESET);
});

test("unregistered forgot-password returns ACCOUNT_NOT_FOUND and creates no user", async () => {
  const context = createContext();
  await assert.rejects(
    context.auth.requestPasswordResetCode({ countryCode: "+970", phoneNumber: "0597777777" }),
    hasCode("ACCOUNT_NOT_FOUND")
  );
  assert.equal(context.prisma.users.length, 0);
  assert.equal(context.otp.deliveries.length, 0);
});

test("verifies a password-reset OTP and issues a scoped reset token", async () => {
  const context = createContext();
  await seedCustomer(context.prisma);
  await context.auth.requestPasswordResetCode({ countryCode: "+970", phoneNumber: "0590000000" });
  const code = context.otp.latest(OtpPurpose.PASSWORD_RESET).code;
  const result = await context.auth.verifyPasswordResetCode({
    countryCode: "+970",
    phoneNumber: "0590000000",
    code
  });
  assert.ok(result.resetToken.length > 20);
  assert.equal(context.prisma.resetTokens.length, 1);
  assert.notEqual(context.prisma.resetTokens[0].tokenHash, result.resetToken);
});

test("does not accept a signup OTP for password reset", async () => {
  const context = createContext();
  const signupCode = await requestSignup(context);
  await seedCustomer(context.prisma, "Test@12345", "+970590000000");
  await assert.rejects(
    context.auth.verifyPasswordResetCode({
      countryCode: "+970",
      phoneNumber: "0590000000",
      code: signupCode
    }),
    hasCode("OTP_INVALID")
  );
});

test("resets a password once, rejects token reuse, accepts new password, and rejects old password", async () => {
  const context = createContext();
  await seedCustomer(context.prisma);
  await context.auth.requestPasswordResetCode({ countryCode: "+970", phoneNumber: "0590000000" });
  const code = context.otp.latest(OtpPurpose.PASSWORD_RESET).code;
  const verification = await context.auth.verifyPasswordResetCode({
    countryCode: "+970",
    phoneNumber: "0590000000",
    code
  });
  const resetInput = {
    resetToken: verification.resetToken,
    password: "Changed@123",
    confirmPassword: "Changed@123"
  };
  await context.auth.resetPassword(resetInput);
  await assert.rejects(context.auth.resetPassword(resetInput), hasCode("RESET_TOKEN_ALREADY_USED"));
  const login = await context.auth.login({
    countryCode: "+970",
    phoneNumber: "0590000000",
    password: "Changed@123"
  });
  assert.equal(login.user.phone, "+970590000000");
  await assert.rejects(
    context.auth.login({ countryCode: "+970", phoneNumber: "0590000000", password: "Test@12345" }),
    hasCode("INVALID_CREDENTIALS")
  );
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) =>
    error instanceof ApiException &&
    (error.getResponse() as { code?: string }).code === code;
}
