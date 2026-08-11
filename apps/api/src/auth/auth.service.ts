import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import {
  OtpPurpose,
  Prisma,
  type PhoneVerificationChallenge,
  type User,
  UserRole
} from "../generated/prisma/client";
import { AuthorizationService } from "../common/authorization/authorization.service";
import { allPermissions } from "../common/authorization/permissions";
import { ApiException } from "../common/api.exception";
import { PrismaService } from "../prisma/prisma.service";
import {
  CustomerSignupRequestDto,
  LoginDto,
  PhoneDto,
  ResetPasswordDto,
  VerifyOtpDto
} from "./auth.dto";
import type { AccessContextView, AuthResult, AuthenticatedUser, JwtPayload, PublicUser } from "./auth.types";
import {
  hashOpaqueToken,
  hashOtp,
  hashPassword,
  safeEqualHex,
  verifyPassword
} from "./crypto.util";
import { normalizePhoneNumber } from "./phone.util";
import { OTP_PROVIDER, type OtpProvider } from "./otp.provider";

type OtpRequestResult = {
  phone: string;
  expiresInSeconds: number;
  resendAvailableInSeconds: number;
  message: string;
};

type IncorrectOtp = { incorrect: true; remainingAttempts: number };
type CorrectOtp<T> = { incorrect: false; value: T };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly authorization: AuthorizationService,
    @Inject(OTP_PROVIDER) private readonly otpProvider: OtpProvider
  ) {}

  async requestCustomerSignupCode(input: CustomerSignupRequestDto): Promise<OtpRequestResult> {
    this.assertPasswordsMatch(input.password, input.confirmPassword);
    const phone = normalizePhoneNumber(input.countryCode, input.phoneNumber);
    const fullName = input.fullName.trim().replace(/\s+/g, " ");
    if (fullName.length < 2) {
      throw new ApiException(400, "INVALID_FULL_NAME", "Please enter your full name.");
    }

    const existingUser = await this.prisma.user.findUnique({ where: { phone } });
    if (existingUser) {
      throw phoneAlreadyRegistered();
    }

    const passwordHash = await hashPassword(input.password);
    return this.issueOtp(phone, OtpPurpose.CUSTOMER_SIGNUP, async (transaction) => {
      const recheckedUser = await transaction.user.findUnique({ where: { phone } });
      if (recheckedUser) {
        throw phoneAlreadyRegistered();
      }
      await transaction.pendingCustomerRegistration.upsert({
        where: { phone },
        create: { fullName, phone, passwordHash },
        update: { fullName, passwordHash }
      });
    });
  }

  async verifyCustomerSignupCode(input: VerifyOtpDto): Promise<AuthResult> {
    const phone = normalizePhoneNumber(input.countryCode, input.phoneNumber);
    let result: IncorrectOtp | CorrectOtp<User>;

    try {
      result = await this.serializableTransaction(async (transaction) => {
        const challenge = await this.requireUsableChallenge(
          transaction,
          phone,
          OtpPurpose.CUSTOMER_SIGNUP
        );
        const incorrect = await this.recordIncorrectOtpIfNeeded(transaction, challenge, input.code);
        if (incorrect) {
          return incorrect;
        }

        const pending = await transaction.pendingCustomerRegistration.findUnique({ where: { phone } });
        if (!pending) {
          throw new ApiException(
            400,
            "SIGNUP_REQUEST_NOT_FOUND",
            "This signup request is no longer available. Please create the account again."
          );
        }

        if (await transaction.user.findUnique({ where: { phone } })) {
          throw phoneAlreadyRegistered();
        }

        const user = await transaction.user.create({
          data: {
            fullName: pending.fullName,
            phone,
            passwordHash: pending.passwordHash,
            role: UserRole.CUSTOMER,
            phoneVerifiedAt: new Date(),
            isActive: true
          }
        });
        await transaction.phoneVerificationChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: new Date() }
        });
        await transaction.pendingCustomerRegistration.delete({ where: { phone } });
        return { incorrect: false, value: user };
      });
    } catch (error) {
      if (isPrismaCode(error, "P2002")) {
        throw phoneAlreadyRegistered();
      }
      throw error;
    }

    if (result.incorrect) {
      throw incorrectOtp(result.remainingAttempts);
    }
    return this.createSession(result.value);
  }

  async login(input: LoginDto): Promise<AuthResult> {
    const phone = normalizePhoneNumber(input.countryCode, input.phoneNumber);
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
      throw new ApiException(401, "INVALID_CREDENTIALS", "Invalid phone number or password.");
    }
    if (!user.isActive) {
      throw new ApiException(403, "ACCOUNT_INACTIVE", "This account is inactive.");
    }
    if (!user.phoneVerifiedAt) {
      throw new ApiException(403, "PHONE_NOT_VERIFIED", "This phone number has not been verified.");
    }
    return this.createSession(user);
  }

  async refresh(rawRefreshToken: string): Promise<AuthResult> {
    const payload = await this.verifyRefreshToken(rawRefreshToken);
    const session = await this.prisma.refreshSession.findUnique({
      where: { id: payload.sid },
      include: { user: true }
    });
    const now = new Date();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.user.id !== payload.sub ||
      session.user.tokenVersion !== payload.ver ||
      !session.user.isActive ||
      !session.user.phoneVerifiedAt ||
      !safeEqualHex(session.tokenHash, hashOpaqueToken(rawRefreshToken))
    ) {
      throw invalidRefreshToken();
    }

    const nextSessionId = randomUUID();
    const tokenSet = await this.signTokens(session.user, nextSessionId);
    const rotation = await this.prisma.$transaction(async (transaction) => {
      const revoked = await transaction.refreshSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: now }
      });
      if (revoked.count !== 1) {
        return false;
      }
      await transaction.refreshSession.create({
        data: {
          id: nextSessionId,
          userId: session.user.id,
          tokenHash: hashOpaqueToken(tokenSet.refreshToken),
          expiresAt: tokenSet.refreshExpiresAt
        }
      });
      return true;
    });
    if (!rotation) {
      throw invalidRefreshToken();
    }
    return this.toAuthResult(session.user, tokenSet);
  }

  async logout(user: AuthenticatedUser): Promise<{ message: string }> {
    await this.prisma.refreshSession.updateMany({
      where: { id: user.sessionId, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    return { message: "You have been logged out." };
  }

  /**
   * Returns the caller plus the access context the interface needs to decide what to render.
   *
   * The permissions are advisory for the client only — every operation is still checked by
   * PermissionsGuard on the way in. Sending them avoids the interface guessing, and avoids it
   * offering a control that the API will then refuse.
   */
  async me(user: AuthenticatedUser): Promise<{ user: PublicUser; access: AccessContextView }> {
    const context = await this.authorization.resolve(user.id, user.role);
    const businessId = AuthorizationService.soleBusinessId(context);
    const business = businessId
      ? await this.prisma.restaurant.findUnique({
          where: { id: businessId },
          select: { id: true, name: true, businessType: true, status: true, isOpen: true }
        })
      : null;
    const grant = context.businessGrants.find((entry) => entry.businessId === businessId);

    return {
      user: toPublicUser(user),
      access: {
        isSuperAdmin: context.isSuperAdmin,
        permissions: context.isSuperAdmin
          ? [...allPermissions]
          : [...context.platformPermissions, ...(grant?.permissions ?? [])],
        roleKey: grant?.roleKey ?? null,
        business
      }
    };
  }

  async requestPasswordResetCode(input: PhoneDto): Promise<OtpRequestResult> {
    const phone = normalizePhoneNumber(input.countryCode, input.phoneNumber);
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      throw new ApiException(
        404,
        "ACCOUNT_NOT_FOUND",
        "No account was found with this phone number."
      );
    }
    return this.issueOtp(phone, OtpPurpose.PASSWORD_RESET);
  }

  async verifyPasswordResetCode(input: VerifyOtpDto): Promise<{
    resetToken: string;
    expiresInSeconds: number;
  }> {
    const phone = normalizePhoneNumber(input.countryCode, input.phoneNumber);
    const resetToken = randomBytes(32).toString("base64url");
    const resetTokenHash = hashOpaqueToken(resetToken);
    const expirationMinutes = this.numberConfig("PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES", 10);
    const expiresAt = new Date(Date.now() + expirationMinutes * 60_000);

    const result = await this.serializableTransaction(async (transaction) => {
      const challenge = await this.requireUsableChallenge(
        transaction,
        phone,
        OtpPurpose.PASSWORD_RESET
      );
      const incorrect = await this.recordIncorrectOtpIfNeeded(transaction, challenge, input.code);
      if (incorrect) {
        return incorrect;
      }
      const user = await transaction.user.findUnique({ where: { phone } });
      if (!user) {
        throw new ApiException(404, "ACCOUNT_NOT_FOUND", "No account was found with this phone number.");
      }

      const now = new Date();
      await transaction.phoneVerificationChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: now }
      });
      await transaction.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: now }
      });
      await transaction.passwordResetToken.create({
        data: { userId: user.id, tokenHash: resetTokenHash, expiresAt }
      });
      return { incorrect: false, value: user } as CorrectOtp<User>;
    });

    if (result.incorrect) {
      throw incorrectOtp(result.remainingAttempts);
    }
    return { resetToken, expiresInSeconds: expirationMinutes * 60 };
  }

  async resetPassword(input: ResetPasswordDto): Promise<{ message: string }> {
    this.assertPasswordsMatch(input.password, input.confirmPassword);
    const passwordHash = await hashPassword(input.password);
    const tokenHash = hashOpaqueToken(input.resetToken);
    const now = new Date();

    await this.serializableTransaction(async (transaction) => {
      const resetToken = await transaction.passwordResetToken.findUnique({
        where: { tokenHash },
        include: { user: true }
      });
      if (!resetToken) {
        throw invalidResetToken();
      }
      if (resetToken.consumedAt) {
        throw new ApiException(
          400,
          "RESET_TOKEN_ALREADY_USED",
          "This password-reset link has already been used."
        );
      }
      if (resetToken.expiresAt <= now) {
        throw new ApiException(400, "RESET_TOKEN_EXPIRED", "This password-reset link has expired.");
      }

      const consumed = await transaction.passwordResetToken.updateMany({
        where: { id: resetToken.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now }
      });
      if (consumed.count !== 1) {
        throw invalidResetToken();
      }
      await transaction.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash, tokenVersion: { increment: 1 } }
      });
      await transaction.refreshSession.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: now }
      });
    });

    return {
      message: "Your password has been reset successfully. You can now log in with your new password."
    };
  }

  private async issueOtp(
    phone: string,
    purpose: OtpPurpose,
    beforeCreate?: (transaction: Prisma.TransactionClient) => Promise<void>
  ): Promise<OtpRequestResult> {
    const expirationMinutes = this.numberConfig("OTP_EXPIRATION_MINUTES", 5);
    const resendSeconds = this.numberConfig("OTP_RESEND_COOLDOWN_SECONDS", 60);
    const maxAttempts = this.numberConfig("OTP_MAX_ATTEMPTS", 5);
    const challengeId = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expirationMinutes * 60_000);
    const resendAvailableAt = new Date(now.getTime() + resendSeconds * 1000);
    const codeHash = hashOtp(
      this.config.getOrThrow<string>("OTP_HASH_SECRET"),
      challengeId,
      phone,
      purpose,
      code
    );

    await this.serializableTransaction(async (transaction) => {
      const latest = await transaction.phoneVerificationChallenge.findFirst({
        where: { phone, purpose },
        orderBy: { createdAt: "desc" }
      });
      if (latest && latest.resendAvailableAt > now) {
        const waitSeconds = Math.max(1, Math.ceil((latest.resendAvailableAt.getTime() - now.getTime()) / 1000));
        throw new ApiException(
          429,
          "OTP_RESEND_COOLDOWN",
          `Please wait ${waitSeconds} seconds before requesting another code.`,
          { retryAfterSeconds: waitSeconds }
        );
      }
      if (beforeCreate) {
        await beforeCreate(transaction);
      }
      await transaction.phoneVerificationChallenge.updateMany({
        where: { phone, purpose, consumedAt: null },
        data: { consumedAt: now }
      });
      await transaction.phoneVerificationChallenge.create({
        data: {
          id: challengeId,
          phone,
          purpose,
          codeHash,
          expiresAt,
          maxAttempts,
          resendAvailableAt
        }
      });
    });

    await this.otpProvider.send({ phone, purpose, code });
    return {
      phone,
      expiresInSeconds: expirationMinutes * 60,
      resendAvailableInSeconds: resendSeconds,
      message: "A verification code was created. Check the backend terminal in development."
    };
  }

  private async requireUsableChallenge(
    transaction: Prisma.TransactionClient,
    phone: string,
    purpose: OtpPurpose
  ): Promise<PhoneVerificationChallenge> {
    const challenge = await transaction.phoneVerificationChallenge.findFirst({
      where: { phone, purpose },
      orderBy: { createdAt: "desc" }
    });
    if (!challenge) {
      throw new ApiException(400, "OTP_INVALID", "The verification code is invalid.");
    }
    if (challenge.consumedAt) {
      throw new ApiException(400, "OTP_ALREADY_USED", "This verification code has already been used.");
    }
    if (challenge.expiresAt <= new Date()) {
      throw new ApiException(400, "OTP_EXPIRED", "The verification code has expired.");
    }
    if (challenge.attemptCount >= challenge.maxAttempts) {
      throw new ApiException(
        429,
        "OTP_TOO_MANY_ATTEMPTS",
        "Too many incorrect verification attempts. Request a new code."
      );
    }
    return challenge;
  }

  private async recordIncorrectOtpIfNeeded(
    transaction: Prisma.TransactionClient,
    challenge: PhoneVerificationChallenge,
    code: string
  ): Promise<IncorrectOtp | null> {
    const suppliedHash = hashOtp(
      this.config.getOrThrow<string>("OTP_HASH_SECRET"),
      challenge.id,
      challenge.phone,
      challenge.purpose,
      code
    );
    if (safeEqualHex(challenge.codeHash, suppliedHash)) {
      return null;
    }
    const nextAttemptCount = challenge.attemptCount + 1;
    await transaction.phoneVerificationChallenge.update({
      where: { id: challenge.id },
      data: { attemptCount: nextAttemptCount }
    });
    return {
      incorrect: true,
      remainingAttempts: Math.max(0, challenge.maxAttempts - nextAttemptCount)
    };
  }

  private async createSession(user: User): Promise<AuthResult> {
    const sessionId = randomUUID();
    const tokenSet = await this.signTokens(user, sessionId);
    await this.prisma.refreshSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash: hashOpaqueToken(tokenSet.refreshToken),
        expiresAt: tokenSet.refreshExpiresAt
      }
    });
    return this.toAuthResult(user, tokenSet);
  }

  private async signTokens(user: User, sessionId: string) {
    const accessExpirationSeconds = this.numberConfig("JWT_ACCESS_EXPIRATION_SECONDS", 900);
    const refreshExpirationSeconds = this.numberConfig("JWT_REFRESH_EXPIRATION_DAYS", 30) * 86_400;
    const basePayload = {
      sub: user.id,
      role: user.role,
      sid: sessionId,
      ver: user.tokenVersion
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { ...basePayload, typ: "access" } satisfies JwtPayload,
        {
          secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
          expiresIn: accessExpirationSeconds
        }
      ),
      this.jwt.signAsync(
        { ...basePayload, typ: "refresh" } satisfies JwtPayload,
        {
          secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET"),
          expiresIn: refreshExpirationSeconds
        }
      )
    ]);
    return {
      accessToken,
      refreshToken,
      accessExpirationSeconds,
      refreshExpirationSeconds,
      refreshExpiresAt: new Date(Date.now() + refreshExpirationSeconds * 1000)
    };
  }

  private toAuthResult(
    user: User,
    tokenSet: Awaited<ReturnType<AuthService["signTokens"]>>
  ): AuthResult {
    return {
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      expiresInSeconds: tokenSet.accessExpirationSeconds,
      refreshExpiresInSeconds: tokenSet.refreshExpirationSeconds,
      user: toPublicUser(user)
    };
  }

  private async verifyRefreshToken(token: string): Promise<JwtPayload> {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET")
      });
      if (payload.typ !== "refresh") {
        throw new Error("Wrong token type");
      }
      return payload;
    } catch {
      throw invalidRefreshToken();
    }
  }

  private assertPasswordsMatch(password: string, confirmation: string): void {
    if (password !== confirmation) {
      throw new ApiException(400, "PASSWORDS_DO_NOT_MATCH", "The passwords do not match.");
    }
  }

  private numberConfig(key: string, fallback: number): number {
    return Number(this.config.get<number | string>(key) ?? fallback);
  }

  private async serializableTransaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        });
      } catch (error) {
        if (isPrismaCode(error, "P2034") && attempt < 2) {
          continue;
        }
        throw error;
      }
    }
    throw new ApiException(409, "TRANSACTION_CONFLICT", "Please retry the request.");
  }
}

function toPublicUser(user: Pick<User, "id" | "fullName" | "phone" | "role">): PublicUser {
  return { id: user.id, fullName: user.fullName, phone: user.phone, role: user.role };
}

function phoneAlreadyRegistered(): ApiException {
  return new ApiException(
    409,
    "PHONE_ALREADY_REGISTERED",
    "An account already exists with this phone number. Please log in or reset your password."
  );
}

function incorrectOtp(remainingAttempts: number): ApiException {
  if (remainingAttempts <= 0) {
    return new ApiException(
      429,
      "OTP_TOO_MANY_ATTEMPTS",
      "Too many incorrect verification attempts. Request a new code."
    );
  }
  return new ApiException(400, "OTP_INVALID", "The verification code is invalid.", {
    remainingAttempts
  });
}

function invalidRefreshToken(): ApiException {
  return new ApiException(401, "INVALID_REFRESH_TOKEN", "The refresh token is invalid or expired.");
}

function invalidResetToken(): ApiException {
  return new ApiException(400, "INVALID_RESET_TOKEN", "The password-reset token is invalid.");
}

function isPrismaCode(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
