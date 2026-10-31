import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { writeAuditLog } from "../common/audit-log.util";
import { ApiException } from "../common/api.exception";
import { activeDeliveryStatuses } from "../drivers/delivery.rules";
import { CashCustodyStatus, Prisma, UserRole } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  anonymisedIdentity,
  defaultDeletionScheduleDays,
  deletionScheduleDate,
  driverDeletionBlockers,
  type AccountDeletionOutcome,
  type DeletionBlocker
} from "./account-deletion.rules";
import type { CreateAddressDto, RegisterPushTokenDto, UpdateAddressDto, UpdateMyProfileDto } from "./users.dto";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigService
  ) {}

  async getProfile(userId: string) {
    const user = await this.requireUser(userId);
    return toProfile(user);
  }

  async updateProfile(userId: string, input: UpdateMyProfileDto) {
    await this.requireUser(userId);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        fullName: input.fullName?.trim().replace(/\s+/g, " "),
        email: input.email !== undefined ? input.email?.trim().toLowerCase() || null : undefined
      }
    });
    return toProfile(updated);
  }

  async listAddresses(userId: string) {
    await this.requireUser(userId);
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }]
    });
  }

  async createAddress(userId: string, input: CreateAddressDto) {
    await this.requireUser(userId);
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.address.count({ where: { userId } });
      const makeDefault = input.isDefault === true || count === 0;
      if (makeDefault) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      return tx.address.create({
        data: {
          userId,
          label: input.label.trim(),
          addressLine: input.addressLine.trim(),
          latitude: input.latitude,
          longitude: input.longitude,
          isDefault: makeDefault
        }
      });
    });
  }

  async updateAddress(userId: string, addressId: string, input: UpdateAddressDto) {
    return this.prisma.$transaction(async (tx) => {
      const address = await tx.address.findUnique({ where: { id: addressId } });
      if (!address || address.userId !== userId) throw addressNotFound();
      if (input.isDefault === true) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return tx.address.update({
        where: { id: address.id },
        data: {
          label: input.label?.trim(),
          addressLine: input.addressLine?.trim(),
          latitude: input.latitude,
          longitude: input.longitude,
          isDefault: input.isDefault
        }
      });
    });
  }

  async deleteAddress(userId: string, addressId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const address = await tx.address.findUnique({ where: { id: addressId } });
      if (!address || address.userId !== userId) throw addressNotFound();
      await tx.address.delete({ where: { id: address.id } });
      if (address.isDefault) {
        const replacement = await tx.address.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
        if (replacement) await tx.address.update({ where: { id: replacement.id }, data: { isDefault: true } });
      }
    });
  }

  async registerPushToken(userId: string, input: RegisterPushTokenDto) {
    await this.requireUser(userId);
    const token = input.token.trim();
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.pushToken.findUnique({ where: { token }, select: { id: true, userId: true } });
      if (existing && existing.userId !== userId) {
        // A queued notification for account A must never be delivered after the installation is
        // reassigned to account B. Preserve the history, but terminally close unfinished jobs.
        await tx.pushDelivery.updateMany({
          where: {
            pushTokenId: existing.id,
            status: { in: ["PENDING", "PROCESSING", "AWAITING_RECEIPT", "RETRYABLE_FAILED"] }
          },
          data: {
            status: "PERMANENT_FAILED",
            processingStartedAt: null,
            lastErrorCode: "TOKEN_OWNERSHIP_CHANGED"
          }
        });
      }
      await tx.pushToken.upsert({
        where: { token },
        // An older build re-registering reports no version, so the stored one is cleared rather
        // than left claiming alert sounds that binary does not have.
        create: { userId, token, platform: input.platform, appVersion: input.appVersion ?? null },
        update: { userId, platform: input.platform, appVersion: input.appVersion ?? null, isActive: true, lastRegisteredAt: new Date() }
      });
    });
    return { registered: true };
  }

  async unregisterPushToken(userId: string, token: string): Promise<void> {
    await this.prisma.pushToken.updateMany({
      where: { userId, token: token.trim() },
      data: { isActive: false }
    });
  }

  /**
   * Self-service account deletion for customers, drivers and store staff (store audit H1).
   *
   * - CUSTOMER: anonymised at once (unchanged behaviour).
   * - DRIVER: anonymised at once when nothing is outstanding; otherwise the deletion is scheduled
   *   (never refused) and completed by AccountDeletionSweepService once the active delivery, cash
   *   custody and earnings balance are all settled.
   * - RESTAURANT (store staff): anonymised at once and removed from the business. The store's single
   *   legal owner is refused: an administrator must transfer the store first.
   * - ADMIN: refused; another administrator closes admin accounts.
   *
   * Orders, deliveries, cash custody, settlements and earnings are never modified or deleted.
   */
  async deleteMyAccount(userId: string): Promise<AccountDeletionOutcome> {
    const user = await this.requireUser(userId);
    switch (user.role) {
      case UserRole.CUSTOMER:
        await this.prisma.$transaction(async (tx) => {
          await this.anonymise(tx, userId, "CUSTOMER_ACCOUNT_DEACTIVATED", UserRole.CUSTOMER);
        });
        return { status: "DELETED" };
      case UserRole.ADMIN:
        throw new ApiException(
          409,
          "ADMIN_DELETION_REQUIRES_SECOND_ADMIN",
          "Administrator accounts are closed by another administrator."
        );
      case UserRole.RESTAURANT:
        return this.deleteStoreStaff(userId);
      case UserRole.DRIVER:
        return this.deleteDriver(userId);
      default:
        throw new ApiException(409, "ACCOUNT_DELETION_SUPPORT_REQUIRED", "This account must be closed by support.");
    }
  }

  /**
   * Completes a scheduled deletion once every blocker has cleared and the scheduled date has come.
   * Returns the blockers still outstanding (empty when the account was anonymised or there was
   * nothing to do). Used by AccountDeletionSweepService.
   */
  async completeScheduledDeletion(userId: string, now = new Date()): Promise<DeletionBlocker[]> {
    return this.prisma.$transaction(
      async (tx) => {
        const request = await tx.accountDeletionRequest.findUnique({ where: { userId } });
        if (!request || request.status !== "PENDING" || request.scheduledFor.getTime() > now.getTime()) return [];
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user || !user.isActive) {
          await tx.accountDeletionRequest.update({ where: { userId }, data: { status: "COMPLETED", completedAt: now, blockers: [] } });
          return [];
        }
        const blockers = user.role === UserRole.DRIVER ? await readDriverBlockers(tx, userId) : [];
        if (blockers.length > 0) {
          await tx.accountDeletionRequest.update({ where: { userId }, data: { blockers } });
          return blockers;
        }
        await this.anonymise(tx, userId, "ACCOUNT_DELETED", user.role, { scheduled: true });
        await tx.accountDeletionRequest.update({ where: { userId }, data: { status: "COMPLETED", completedAt: now, blockers: [] } });
        return [];
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  /** The person's pending deletion, if any, so the app can show the date. */
  async getDeletionRequest(userId: string) {
    const request = await this.prisma.accountDeletionRequest.findUnique({ where: { userId } });
    if (!request || request.status !== "PENDING") return { status: "NONE" as const };
    return {
      status: "SCHEDULED" as const,
      scheduledFor: request.scheduledFor.toISOString(),
      blockers: request.blockers as DeletionBlocker[]
    };
  }

  private async deleteDriver(userId: string): Promise<AccountDeletionOutcome> {
    const now = new Date();
    return this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.accountDeletionRequest.findUnique({ where: { userId } });
        const blockers = await readDriverBlockers(tx, userId);
        if (blockers.length === 0) {
          await this.anonymise(tx, userId, "ACCOUNT_DELETED", UserRole.DRIVER);
          if (existing?.status === "PENDING") {
            await tx.accountDeletionRequest.update({ where: { userId }, data: { status: "COMPLETED", completedAt: now, blockers: [] } });
          }
          return { status: "DELETED" as const };
        }
        if (existing?.status === "PENDING") {
          // Asking again never moves the date; it only refreshes what is still outstanding.
          await tx.accountDeletionRequest.update({ where: { userId }, data: { blockers } });
          return { status: "SCHEDULED" as const, scheduledFor: existing.scheduledFor.toISOString(), blockers };
        }
        const scheduledFor = deletionScheduleDate(now, this.scheduleDays());
        await tx.accountDeletionRequest.upsert({
          where: { userId },
          create: { userId, scheduledFor, blockers },
          update: { status: "PENDING", requestedAt: now, scheduledFor, blockers, completedAt: null }
        });
        await writeAuditLog(tx, {
          actorUserId: userId,
          action: "ACCOUNT_DELETION_SCHEDULED",
          entityType: "User",
          entityId: userId,
          reason: "Requested by account owner",
          metadata: { role: UserRole.DRIVER, blockers, scheduledFor: scheduledFor.toISOString() }
        });
        return { status: "SCHEDULED" as const, scheduledFor: scheduledFor.toISOString(), blockers };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  private async deleteStoreStaff(userId: string): Promise<AccountDeletionOutcome> {
    const owned = await this.prisma.restaurant.findUnique({ where: { ownerUserId: userId }, select: { id: true } });
    if (owned) {
      throw new ApiException(
        409,
        "BUSINESS_OWNER_DELETION_REQUIRES_ADMIN",
        "This is the store owner's account. A JOVO administrator must transfer the store before it can be deleted."
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await this.anonymise(tx, userId, "ACCOUNT_DELETED", UserRole.RESTAURANT);
    });
    return { status: "DELETED" };
  }

  /**
   * Erases the person, keeps the records. The customer path writes exactly what it always wrote;
   * drivers additionally lose their last known position and shift state, store staff their
   * business memberships.
   */
  private async anonymise(
    tx: Prisma.TransactionClient,
    userId: string,
    action: "CUSTOMER_ACCOUNT_DEACTIVATED" | "ACCOUNT_DELETED",
    role: UserRole,
    extraMetadata: Record<string, unknown> = {}
  ): Promise<void> {
    await tx.address.deleteMany({ where: { userId } });
    await tx.pushToken.deleteMany({ where: { userId } });
    await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (role === UserRole.DRIVER) {
      await tx.driverProfile.updateMany({
        where: { userId },
        data: {
          isOnline: false,
          appState: null,
          appLeaseUntil: null,
          appSeenAt: null,
          lastLatitude: null,
          lastLongitude: null,
          lastLocationAt: null
        }
      });
    }
    if (role === UserRole.RESTAURANT) {
      await tx.businessMember.updateMany({ where: { userId }, data: { isActive: false } });
    }
    await writeAuditLog(tx, {
      actorUserId: userId,
      action,
      entityType: "User",
      entityId: userId,
      reason: "Requested by account owner",
      ...(action === "ACCOUNT_DELETED" ? { metadata: { role, ...extraMetadata } } : {})
    });
    await tx.user.update({
      where: { id: userId },
      data: { ...anonymisedIdentity(userId), tokenVersion: { increment: 1 } }
    });
  }

  private scheduleDays(): number {
    const configured = Number(this.config?.get<string | number>("ACCOUNT_DELETION_SCHEDULE_DAYS"));
    return Number.isFinite(configured) && configured > 0 ? configured : defaultDeletionScheduleDays;
  }

  private async requireUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new ApiException(404, "USER_NOT_FOUND", "This user account does not exist.");
    return user;
  }
}

function toProfile(user: { id: string; fullName: string; phone: string; email: string | null; role: UserRole; createdAt: Date }) {
  return { id: user.id, fullName: user.fullName, phone: user.phone, email: user.email, role: user.role, createdAt: user.createdAt };
}

function addressNotFound() {
  return new ApiException(404, "ADDRESS_NOT_FOUND", "This saved address does not exist.");
}

/** Reads (never writes) what a driver still owes or is owed. Mirrors the accounting balance. */
async function readDriverBlockers(tx: Prisma.TransactionClient, userId: string): Promise<DeletionBlocker[]> {
  const payeeKey = `DRIVER:${userId}`;
  const [activeDeliveries, unsettledCashCustodies, earned, paid] = await Promise.all([
    tx.delivery.count({ where: { driverId: userId, status: { in: activeDeliveryStatuses } } }),
    tx.driverCashCustody.count({ where: { driverUserId: userId, status: { not: CashCustodyStatus.SETTLED } } }),
    tx.partnerEarning.aggregate({ where: { payeeKey }, _sum: { amountMinor: true } }),
    tx.partnerSettlement.aggregate({ where: { payeeKey }, _sum: { amountMinor: true } })
  ]);
  return driverDeletionBlockers({
    activeDeliveries,
    unsettledCashCustodies,
    earningsBalanceMinor: (earned._sum.amountMinor ?? 0) - (paid._sum.amountMinor ?? 0)
  });
}
