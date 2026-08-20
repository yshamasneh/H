import { randomUUID } from "node:crypto";
import { UserRole } from "../../generated/prisma/client";

/**
 * A hand-rolled, in-memory Prisma double for UsersService, matching the style of the
 * other `testing/fake-prisma.ts` doubles in this codebase. It implements only the client
 * surface UsersService actually touches (user, address, pushToken, refreshSession,
 * auditLog and $transaction) with faithful semantics for the parts the tests assert on:
 * the "first address is default" / "unset the previous default" rules and the increment
 * form of `tokenVersion`.
 */

type UserRecord = {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  phoneVerifiedAt: Date | null;
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

type AddressRecord = {
  id: string;
  userId: string;
  label: string;
  addressLine: string;
  latitude: number;
  longitude: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type PushTokenRecord = { id: string; userId: string; token: string; isActive: boolean };
type RefreshSessionRecord = { id: string; userId: string; revokedAt: Date | null };
type AuditLogRecord = {
  id: string;
  actorUserId: string;
  businessId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  metadataJson: unknown;
  createdAt: Date;
};

export class FakeUsersPrisma {
  readonly users: UserRecord[] = [];
  readonly addresses: AddressRecord[] = [];
  readonly pushTokens: PushTokenRecord[] = [];
  readonly refreshSessions: RefreshSessionRecord[] = [];
  readonly auditLogs: AuditLogRecord[] = [];
  private sequence = 0;

  readonly user = {} as any;
  readonly address = {} as any;
  readonly pushToken = {} as any;
  readonly refreshSession = {} as any;
  readonly auditLog = {} as any;

  constructor() {
    this.user.findUnique = async ({ where }: any) =>
      this.users.find((user) => (where.phone ? user.phone === where.phone : user.id === where.id)) ?? null;
    this.user.update = async ({ where, data }: any) => {
      const user = this.users.find((candidate) => candidate.id === where.id);
      if (!user) throw new Error("missing user");
      if (data.fullName !== undefined) user.fullName = data.fullName;
      if (data.phone !== undefined) user.phone = data.phone;
      if (data.email !== undefined) user.email = data.email;
      if (data.passwordHash !== undefined) user.passwordHash = data.passwordHash;
      if (data.isActive !== undefined) user.isActive = data.isActive;
      if (data.tokenVersion !== undefined) {
        user.tokenVersion =
          typeof data.tokenVersion === "object" && data.tokenVersion !== null && "increment" in data.tokenVersion
            ? user.tokenVersion + data.tokenVersion.increment
            : data.tokenVersion;
      }
      user.updatedAt = new Date();
      return { ...user };
    };

    this.address.findUnique = async ({ where }: any) =>
      this.addresses.find((address) => address.id === where.id) ?? null;
    this.address.findFirst = async ({ where, orderBy }: any) => {
      let matches = this.addresses.filter((address) => address.userId === where.userId);
      if (orderBy?.createdAt === "desc") {
        matches = [...matches].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      }
      return matches[0] ?? null;
    };
    this.address.findMany = async ({ where, orderBy }: any) => {
      let matches = this.addresses.filter((address) => address.userId === where.userId);
      const orderings = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
      for (const ordering of [...orderings].reverse()) {
        if (ordering.isDefault === "desc") {
          matches = [...matches].sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
        } else if (ordering.createdAt === "desc") {
          matches = [...matches].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
        }
      }
      return matches.map((address) => ({ ...address }));
    };
    this.address.count = async ({ where }: any) =>
      this.addresses.filter((address) => address.userId === where.userId).length;
    this.address.create = async ({ data }: any) => {
      const now = new Date(Date.now() + this.sequence++ * 1_000);
      const address: AddressRecord = {
        id: data.id ?? randomUUID(),
        userId: data.userId,
        label: data.label,
        addressLine: data.addressLine,
        latitude: data.latitude,
        longitude: data.longitude,
        isDefault: data.isDefault ?? false,
        createdAt: now,
        updatedAt: now
      };
      this.addresses.push(address);
      return { ...address };
    };
    this.address.update = async ({ where, data }: any) => {
      const address = this.addresses.find((candidate) => candidate.id === where.id);
      if (!address) throw new Error("missing address");
      for (const key of ["label", "addressLine", "latitude", "longitude", "isDefault"] as const) {
        if (data[key] !== undefined) (address as any)[key] = data[key];
      }
      address.updatedAt = new Date();
      return { ...address };
    };
    this.address.updateMany = async ({ where, data }: any) => {
      const matches = this.addresses.filter((address) => address.userId === where.userId);
      for (const address of matches) {
        if (data.isDefault !== undefined) address.isDefault = data.isDefault;
      }
      return { count: matches.length };
    };
    this.address.delete = async ({ where }: any) => {
      const index = this.addresses.findIndex((address) => address.id === where.id);
      if (index === -1) throw new Error("missing address");
      const [removed] = this.addresses.splice(index, 1);
      return removed;
    };
    this.address.deleteMany = async ({ where }: any) => {
      const before = this.addresses.length;
      for (let index = this.addresses.length - 1; index >= 0; index -= 1) {
        if (this.addresses[index].userId === where.userId) this.addresses.splice(index, 1);
      }
      return { count: before - this.addresses.length };
    };

    this.pushToken.deleteMany = async ({ where }: any) => {
      const before = this.pushTokens.length;
      for (let index = this.pushTokens.length - 1; index >= 0; index -= 1) {
        if (this.pushTokens[index].userId === where.userId) this.pushTokens.splice(index, 1);
      }
      return { count: before - this.pushTokens.length };
    };

    this.refreshSession.updateMany = async ({ where, data }: any) => {
      const matches = this.refreshSessions.filter(
        (session) => session.userId === where.userId && (where.revokedAt !== null || session.revokedAt === null)
      );
      for (const session of matches) {
        if (data.revokedAt !== undefined) session.revokedAt = data.revokedAt;
      }
      return { count: matches.length };
    };

    this.auditLog.create = async ({ data }: any) => {
      const entry: AuditLogRecord = {
        id: randomUUID(),
        actorUserId: data.actorUserId,
        businessId: data.businessId ?? null,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        reason: data.reason ?? null,
        metadataJson: data.metadataJson ?? null,
        createdAt: new Date()
      };
      this.auditLogs.push(entry);
      return entry;
    };
  }

  async $transaction<T>(operation: (transaction: this) => Promise<T>): Promise<T> {
    return operation(this);
  }

  seedUser(overrides: Partial<UserRecord> = {}): UserRecord {
    const now = new Date();
    const user: UserRecord = {
      id: overrides.id ?? randomUUID(),
      fullName: "Sara Customer",
      phone: overrides.phone ?? `+97059${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
      email: "sara@example.com",
      passwordHash: "argon2-hash",
      role: UserRole.CUSTOMER,
      isActive: true,
      phoneVerifiedAt: now,
      tokenVersion: 0,
      createdAt: now,
      updatedAt: now,
      ...overrides
    };
    this.users.push(user);
    return user;
  }

  seedAddress(userId: string, overrides: Partial<AddressRecord> = {}): AddressRecord {
    const now = new Date(Date.now() + this.sequence++ * 1_000);
    const address: AddressRecord = {
      id: overrides.id ?? randomUUID(),
      userId,
      label: "Home",
      addressLine: "Al-Manara Square, Ramallah",
      latitude: 31.9038,
      longitude: 35.2034,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
      ...overrides
    };
    this.addresses.push(address);
    return address;
  }
}
