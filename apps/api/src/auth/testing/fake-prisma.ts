import { randomUUID } from "node:crypto";
import { OtpPurpose, UserRole } from "../../generated/prisma/client";

type UserRecord = {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  passwordHash: string;
  role: UserRole;
  phoneVerifiedAt: Date | null;
  isActive: boolean;
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

type ChallengeRecord = {
  id: string;
  phone: string;
  purpose: OtpPurpose;
  codeHash: string;
  expiresAt: Date;
  attemptCount: number;
  maxAttempts: number;
  resendAvailableAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type PendingRecord = {
  id: string;
  fullName: string;
  phone: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
};

type SessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ResetRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
};

export class FakePrisma {
  readonly users: UserRecord[] = [];
  readonly challenges: ChallengeRecord[] = [];
  readonly pendingRegistrations: PendingRecord[] = [];
  readonly sessions: SessionRecord[] = [];
  readonly resetTokens: ResetRecord[] = [];
  private transactionTail: Promise<void> = Promise.resolve();

  readonly user = {} as any;

  readonly phoneVerificationChallenge = {} as any;
  readonly pendingCustomerRegistration = {} as any;
  readonly refreshSession = {} as any;
  readonly passwordResetToken = {} as any;

  constructor() {
    this.user.findUnique = async ({ where }: any) =>
      this.users.find((user) => (where.phone ? user.phone === where.phone : user.id === where.id)) ?? null;
    this.user.create = async ({ data }: any) => {
      if (this.users.some((user) => user.phone === data.phone)) {
        throw new Error("duplicate user phone");
      }
      const now = new Date();
      const user: UserRecord = {
        id: data.id ?? randomUUID(),
        fullName: data.fullName,
        phone: data.phone,
        email: data.email ?? null,
        passwordHash: data.passwordHash,
        role: data.role,
        phoneVerifiedAt: data.phoneVerifiedAt ?? null,
        isActive: data.isActive ?? true,
        tokenVersion: data.tokenVersion ?? 0,
        createdAt: now,
        updatedAt: now
      };
      this.users.push(user);
      return user;
    };
    this.user.update = async ({ where, data }: any) => {
      const user = this.users.find((candidate) => candidate.id === where.id);
      if (!user) throw new Error("missing user");
      if (data.passwordHash) user.passwordHash = data.passwordHash;
      if (data.tokenVersion?.increment) user.tokenVersion += data.tokenVersion.increment;
      user.updatedAt = new Date();
      return user;
    };

    this.phoneVerificationChallenge.findFirst = async ({ where }: any) =>
      [...this.challenges]
        .filter((item) => item.phone === where.phone && item.purpose === where.purpose)
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
    this.phoneVerificationChallenge.create = async ({ data }: any) => {
      const now = new Date();
      const challenge: ChallengeRecord = {
        id: data.id ?? randomUUID(),
        phone: data.phone,
        purpose: data.purpose,
        codeHash: data.codeHash,
        expiresAt: data.expiresAt,
        attemptCount: data.attemptCount ?? 0,
        maxAttempts: data.maxAttempts,
        resendAvailableAt: data.resendAvailableAt,
        consumedAt: data.consumedAt ?? null,
        createdAt: new Date(now.getTime() + this.challenges.length),
        updatedAt: now
      };
      this.challenges.push(challenge);
      return challenge;
    };
    this.phoneVerificationChallenge.update = async ({ where, data }: any) => {
      const challenge = this.challenges.find((item) => item.id === where.id);
      if (!challenge) throw new Error("missing challenge");
      if (data.attemptCount !== undefined) challenge.attemptCount = data.attemptCount;
      if (data.consumedAt !== undefined) challenge.consumedAt = data.consumedAt;
      challenge.updatedAt = new Date();
      return challenge;
    };
    this.phoneVerificationChallenge.updateMany = async ({ where, data }: any) => {
      const matches = this.challenges.filter((item) =>
        item.phone === where.phone &&
        item.purpose === where.purpose &&
        (where.consumedAt !== null || item.consumedAt === null)
      );
      for (const item of matches) item.consumedAt = data.consumedAt;
      return { count: matches.length };
    };

    this.pendingCustomerRegistration.findUnique = async ({ where }: any) =>
      this.pendingRegistrations.find((item) => item.phone === where.phone) ?? null;
    this.pendingCustomerRegistration.upsert = async ({ where, create, update }: any) => {
      const existing = this.pendingRegistrations.find((item) => item.phone === where.phone);
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date() });
        return existing;
      }
      const now = new Date();
      const pending = { id: randomUUID(), ...create, createdAt: now, updatedAt: now };
      this.pendingRegistrations.push(pending);
      return pending;
    };
    this.pendingCustomerRegistration.delete = async ({ where }: any) => {
      const index = this.pendingRegistrations.findIndex((item) => item.phone === where.phone);
      if (index < 0) throw new Error("missing pending signup");
      return this.pendingRegistrations.splice(index, 1)[0];
    };

    this.refreshSession.create = async ({ data }: any) => {
      const now = new Date();
      const session: SessionRecord = {
        id: data.id ?? randomUUID(),
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        revokedAt: data.revokedAt ?? null,
        createdAt: now,
        updatedAt: now
      };
      this.sessions.push(session);
      return session;
    };
    this.refreshSession.findUnique = async ({ where, include }: any) => {
      const session = this.sessions.find((item) => item.id === where.id) ?? null;
      if (!session || !include?.user) return session;
      return { ...session, user: this.users.find((user) => user.id === session.userId)! };
    };
    this.refreshSession.updateMany = async ({ where, data }: any) => {
      const matches = this.sessions.filter((session) =>
        (!where.id || session.id === where.id) &&
        (!where.userId || session.userId === where.userId) &&
        (where.revokedAt !== null || session.revokedAt === null)
      );
      for (const session of matches) session.revokedAt = data.revokedAt;
      return { count: matches.length };
    };

    this.passwordResetToken.create = async ({ data }: any) => {
      const reset: ResetRecord = {
        id: randomUUID(),
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        consumedAt: data.consumedAt ?? null,
        createdAt: new Date()
      };
      this.resetTokens.push(reset);
      return reset;
    };
    this.passwordResetToken.findUnique = async ({ where, include }: any) => {
      const reset = this.resetTokens.find((item) => item.tokenHash === where.tokenHash) ?? null;
      if (!reset || !include?.user) return reset;
      return { ...reset, user: this.users.find((user) => user.id === reset.userId)! };
    };
    this.passwordResetToken.updateMany = async ({ where, data }: any) => {
      const matches = this.resetTokens.filter((item) =>
        (!where.id || item.id === where.id) &&
        (!where.userId || item.userId === where.userId) &&
        (where.consumedAt !== null || item.consumedAt === null) &&
        (!where.expiresAt?.gt || item.expiresAt > where.expiresAt.gt)
      );
      for (const item of matches) item.consumedAt = data.consumedAt;
      return { count: matches.length };
    };
  }

  async $transaction<T>(operation: (transaction: this) => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation(this);
    } finally {
      release();
    }
  }

  async createVerifiedCustomer(input: {
    fullName?: string;
    phone?: string;
    passwordHash: string;
  }): Promise<UserRecord> {
    return this.user.create({
      data: {
        fullName: input.fullName ?? "test",
        phone: input.phone ?? "+970590000000",
        passwordHash: input.passwordHash,
        role: UserRole.CUSTOMER,
        phoneVerifiedAt: new Date(),
        isActive: true
      }
    });
  }
}
