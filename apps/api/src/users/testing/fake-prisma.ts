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

type PushTokenRecord = {
  id: string;
  userId: string;
  token: string;
  isActive: boolean;
  platform?: string;
  appVersion?: string | null;
  lastRegisteredAt?: Date;
};
type PushDeliveryRecord = { pushTokenId: string; status: string; lastErrorCode?: string | null };
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

type DeliveryRecord = { id: string; driverId: string | null; status: string };
type CashCustodyRecord = { id: string; driverUserId: string; status: string };
type AmountRecord = { payeeKey: string; amountMinor: number };
type DriverProfileRecord = {
  userId: string;
  isOnline: boolean;
  appState: string | null;
  appLeaseUntil: Date | null;
  appSeenAt: Date | null;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastLocationAt: Date | null;
};
type BusinessMemberRecord = { id: string; userId: string; businessId: string; isActive: boolean };
type DeletionRequestRecord = {
  id: string;
  userId: string;
  status: "PENDING" | "COMPLETED";
  requestedAt: Date;
  scheduledFor: Date;
  blockers: string[];
  completedAt: Date | null;
};

export class FakeUsersPrisma {
  readonly users: UserRecord[] = [];
  readonly addresses: AddressRecord[] = [];
  readonly pushTokens: PushTokenRecord[] = [];
  readonly pushDeliveries: PushDeliveryRecord[] = [];
  readonly refreshSessions: RefreshSessionRecord[] = [];
  readonly auditLogs: AuditLogRecord[] = [];
  // Read-only facts for the deletion rules (store audit H1). Nothing in UsersService may write them.
  readonly deliveries: DeliveryRecord[] = [];
  readonly cashCustodies: CashCustodyRecord[] = [];
  readonly earnings: AmountRecord[] = [];
  readonly payouts: AmountRecord[] = [];
  readonly restaurants: Array<{ id: string; ownerUserId: string }> = [];
  readonly driverProfiles: DriverProfileRecord[] = [];
  readonly businessMembers: BusinessMemberRecord[] = [];
  readonly deletionRequests: DeletionRequestRecord[] = [];
  readonly transactionOptions: unknown[] = [];
  private sequence = 0;

  readonly user = {} as any;
  readonly address = {} as any;
  readonly pushToken = {} as any;
  readonly pushDelivery = {} as any;
  readonly refreshSession = {} as any;
  readonly auditLog = {} as any;
  readonly delivery = {} as any;
  readonly driverCashCustody = {} as any;
  readonly partnerEarning = {} as any;
  readonly partnerSettlement = {} as any;
  readonly restaurant = {} as any;
  readonly driverProfile = {} as any;
  readonly businessMember = {} as any;
  readonly accountDeletionRequest = {} as any;

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
    this.pushToken.findUnique = async ({ where }: any) => {
      const entry = this.pushTokens.find((candidate) => candidate.token === where.token) ?? null;
      return entry ? { id: entry.id, userId: entry.userId } : null;
    };
    this.pushToken.upsert = async ({ where, create, update }: any) => {
      const existing = this.pushTokens.find((entry) => entry.token === where.token);
      if (existing) {
        existing.userId = update.userId;
        existing.platform = update.platform;
        existing.appVersion = update.appVersion;
        existing.isActive = update.isActive;
        existing.lastRegisteredAt = update.lastRegisteredAt;
        return { ...existing };
      }
      const entry: PushTokenRecord = {
        id: randomUUID(),
        userId: create.userId,
        token: create.token,
        platform: create.platform,
        appVersion: create.appVersion,
        isActive: true,
        lastRegisteredAt: new Date()
      };
      this.pushTokens.push(entry);
      return { ...entry };
    };
    this.pushToken.updateMany = async ({ where, data }: any) => {
      const matches = this.pushTokens.filter(
        (entry) =>
          (where.userId === undefined || entry.userId === where.userId) &&
          (where.token === undefined || entry.token === where.token)
      );
      for (const entry of matches) {
        if (data.isActive !== undefined) entry.isActive = data.isActive;
      }
      return { count: matches.length };
    };
    this.pushDelivery.updateMany = async ({ where, data }: any) => {
      const matches = this.pushDeliveries.filter(
        (entry) => entry.pushTokenId === where.pushTokenId && where.status.in.includes(entry.status)
      );
      for (const entry of matches) Object.assign(entry, data);
      return { count: matches.length };
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

    this.delivery.count = async ({ where }: any) =>
      this.deliveries.filter((entry) => entry.driverId === where.driverId && where.status.in.includes(entry.status)).length;
    this.driverCashCustody.count = async ({ where }: any) =>
      this.cashCustodies.filter((entry) => entry.driverUserId === where.driverUserId && entry.status !== where.status.not).length;
    const sumFor = (rows: AmountRecord[]) => async ({ where }: any) => {
      const matches = rows.filter((row) => row.payeeKey === where.payeeKey);
      return { _sum: { amountMinor: matches.length ? matches.reduce((total, row) => total + row.amountMinor, 0) : null } };
    };
    this.partnerEarning.aggregate = sumFor(this.earnings);
    this.partnerSettlement.aggregate = sumFor(this.payouts);
    this.restaurant.findUnique = async ({ where }: any) =>
      this.restaurants.find((entry) => entry.ownerUserId === where.ownerUserId) ?? null;
    this.driverProfile.updateMany = async ({ where, data }: any) => {
      const matches = this.driverProfiles.filter((entry) => entry.userId === where.userId);
      for (const entry of matches) Object.assign(entry, data);
      return { count: matches.length };
    };
    this.businessMember.updateMany = async ({ where, data }: any) => {
      const matches = this.businessMembers.filter((entry) => entry.userId === where.userId);
      for (const entry of matches) Object.assign(entry, data);
      return { count: matches.length };
    };
    this.accountDeletionRequest.findUnique = async ({ where }: any) => {
      const entry = this.deletionRequests.find((candidate) => candidate.userId === where.userId);
      return entry ? { ...entry, blockers: [...entry.blockers] } : null;
    };
    this.accountDeletionRequest.update = async ({ where, data }: any) => {
      const entry = this.deletionRequests.find((candidate) => candidate.userId === where.userId);
      if (!entry) throw new Error("missing deletion request");
      Object.assign(entry, data);
      return { ...entry };
    };
    this.accountDeletionRequest.upsert = async ({ where, create, update }: any) => {
      const existing = this.deletionRequests.find((candidate) => candidate.userId === where.userId);
      if (existing) {
        Object.assign(existing, update);
        return { ...existing };
      }
      const entry: DeletionRequestRecord = {
        id: randomUUID(),
        userId: create.userId,
        status: "PENDING",
        requestedAt: new Date(),
        scheduledFor: create.scheduledFor,
        blockers: create.blockers,
        completedAt: null
      };
      this.deletionRequests.push(entry);
      return { ...entry };
    };
    this.accountDeletionRequest.findMany = async ({ where, take }: any) =>
      this.deletionRequests
        .filter((entry) => entry.status === where.status && entry.scheduledFor.getTime() <= where.scheduledFor.lte.getTime())
        .sort((left, right) => left.scheduledFor.getTime() - right.scheduledFor.getTime())
        .slice(0, take)
        .map((entry) => ({ userId: entry.userId }));
  }

  async $transaction<T>(operation: (transaction: this) => Promise<T>, options?: unknown): Promise<T> {
    this.transactionOptions.push(options ?? null);
    return operation(this);
  }

  seedDriverProfile(userId: string): DriverProfileRecord {
    const profile: DriverProfileRecord = {
      userId,
      isOnline: true,
      appState: "FOREGROUND",
      appLeaseUntil: new Date(Date.now() + 60_000),
      appSeenAt: new Date(),
      lastLatitude: 31.9,
      lastLongitude: 35.2,
      lastLocationAt: new Date()
    };
    this.driverProfiles.push(profile);
    return profile;
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
