import { Injectable } from "@nestjs/common";
import { hashPassword } from "../auth/crypto.util";
import { normalizePhoneNumber } from "../auth/phone.util";
import { writeAuditLog } from "../common/audit-log.util";
import { ApiException } from "../common/api.exception";
import {
  DeliveryStatus,
  DriverApprovalStatus,
  OrderStatus,
  Prisma,
  RestaurantStatus,
  RoleScope,
  UserRole
} from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type {
  AdminAuditLogQueryDto,
  AdminUsersQueryDto,
  AssignPlatformRoleDto,
  CreateAdminUserDto,
  SetUserActiveDto
} from "./admin.dto";
import type { AdminUserView, AuditLogEntryView, DashboardOverview, Page } from "./admin.types";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(): Promise<DashboardOverview> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      ordersToday,
      revenueAggregate,
      activeDeliveries,
      pendingRestaurantApprovals,
      onlineDriversCount,
      newCustomerSignupsToday,
      activity
    ] = await Promise.all([
      this.prisma.order.count({ where: { createdAt: { gte: startOfToday } } }),
      // Sum today's revenue in SQL rather than loading every order (M-8). Same filter as
      // before: created today, excluding CANCELLED/REJECTED.
      this.prisma.order.aggregate({
        where: {
          createdAt: { gte: startOfToday },
          status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED] }
        },
        _sum: { totalMinor: true }
      }),
      this.prisma.delivery.count({
        where: {
          status: {
            in: [DeliveryStatus.PENDING_ASSIGNMENT, DeliveryStatus.ASSIGNED, DeliveryStatus.PICKED_UP, DeliveryStatus.ON_THE_WAY]
          }
        }
      }),
      this.prisma.restaurant.count({ where: { status: RestaurantStatus.PENDING } }),
      this.prisma.driverProfile.count({ where: { isOnline: true, status: DriverApprovalStatus.APPROVED } }),
      this.prisma.user.count({ where: { role: UserRole.CUSTOMER, createdAt: { gte: startOfToday } } }),
      this.prisma.orderStatusHistory.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { order: { include: { restaurant: true } } }
      })
    ]);

    const revenueTodayMinor = revenueAggregate._sum.totalMinor ?? 0;

    return {
      ordersToday,
      revenueTodayMinor,
      activeDeliveries,
      pendingRestaurantApprovals,
      onlineDriversCount,
      newCustomerSignupsToday,
      activityFeed: activity.map((entry) => ({
        id: entry.id,
        orderId: entry.orderId,
        restaurantName: entry.order.restaurant.name,
        toStatus: entry.toStatus,
        createdAt: entry.createdAt
      }))
    };
  }

  async listUsers(query: AdminUsersQueryDto): Promise<Page<AdminUserView>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.UserWhereInput = {
      role: query.role as UserRole | undefined,
      OR: query.search
        ? [{ fullName: { contains: query.search, mode: "insensitive" } }, { phone: { contains: query.search } }]
        : undefined
    };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.user.count({ where })
    ]);
    return {
      items: users.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
        phoneVerifiedAt: user.phoneVerifiedAt,
        createdAt: user.createdAt
      })),
      page,
      pageSize,
      total
    };
  }

  /**
   * Creates an administrator account.
   *
   * There is no email or SMS delivery on this platform, so the creator sets an initial password and
   * passes it on, matching how business and driver accounts are already onboarded. The account is
   * phone-verified immediately for the same reason.
   */
  async createAdminUser(actorUserId: string, input: CreateAdminUserDto): Promise<AdminUserView> {
    const phone = normalizePhoneNumber(input.countryCode, input.phoneNumber);
    const fullName = input.fullName.trim().replace(/\s+/g, " ");
    if (fullName.length < 2) {
      throw new ApiException(400, "INVALID_FULL_NAME", "Please enter the administrator's full name.");
    }
    if (await this.prisma.user.findUnique({ where: { phone } })) {
      throw phoneAlreadyRegistered();
    }
    const passwordHash = await hashPassword(input.password);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        if (await tx.user.findUnique({ where: { phone } })) throw phoneAlreadyRegistered();
        const role = input.platformRoleKey
          ? await tx.role.findUnique({ where: { key: input.platformRoleKey } })
          : null;
        if (input.platformRoleKey && !role) {
          throw new ApiException(500, "SYSTEM_ROLE_MISSING", "The platform's roles are not initialised.");
        }
        const user = await tx.user.create({
          data: {
            fullName,
            phone,
            passwordHash,
            role: UserRole.ADMIN,
            platformRoleId: role?.id ?? null,
            phoneVerifiedAt: new Date(),
            isActive: true
          }
        });
        await writeAuditLog(tx, {
          actorUserId,
          action: "ADMIN_USER_CREATED",
          entityType: "User",
          entityId: user.id,
          metadata: { phone, platformRoleKey: input.platformRoleKey ?? null }
        });
        return user;
      });
      return toAdminUserView(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw phoneAlreadyRegistered();
      }
      throw error;
    }
  }

  /**
   * Suspends or restores an account. Deliberately not a delete: orders reference their customer and
   * business, and a financial record must always resolve to a person.
   */
  async setUserActive(actorUserId: string, userId: string, input: SetUserActiveDto): Promise<AdminUserView> {
    if (userId === actorUserId) {
      throw new ApiException(
        409,
        "ADMIN_SELF_CHANGE",
        "You cannot change your own account status. Ask another administrator."
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new ApiException(404, "USER_NOT_FOUND", "This user account does not exist.");
      if (user.isActive === input.isActive) {
        throw new ApiException(409, "USER_STATUS_UNCHANGED", "This account is already in that state.");
      }
      const next = await tx.user.update({
        where: { id: userId },
        // Bumping the token version ends every existing session immediately, so a suspension takes
        // effect on the next request rather than whenever a token happens to expire.
        data: { isActive: input.isActive, tokenVersion: { increment: 1 } }
      });
      await tx.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      await writeAuditLog(tx, {
        actorUserId,
        action: input.isActive ? "USER_REACTIVATED" : "USER_SUSPENDED",
        entityType: "User",
        entityId: userId,
        reason: input.reason,
        metadata: { fromIsActive: user.isActive, toIsActive: input.isActive }
      });
      return next;
    });
    return toAdminUserView(updated);
  }

  async assignPlatformRole(
    actorUserId: string,
    userId: string,
    input: AssignPlatformRoleDto
  ): Promise<AdminUserView> {
    if (userId === actorUserId) {
      throw new ApiException(
        409,
        "ADMIN_SELF_CHANGE",
        "You cannot change your own platform role. Ask another administrator."
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, include: { platformRole: true } });
      if (!user) throw new ApiException(404, "USER_NOT_FOUND", "This user account does not exist.");
      if (user.role !== UserRole.ADMIN) {
        throw new ApiException(
          409,
          "PLATFORM_ROLE_NOT_APPLICABLE",
          "Only an administrator account can hold a platform role."
        );
      }
      const role = input.platformRoleKey
        ? await tx.role.findUnique({ where: { key: input.platformRoleKey } })
        : null;
      if (input.platformRoleKey && (!role || role.scope !== RoleScope.PLATFORM)) {
        throw new ApiException(400, "ROLE_NOT_ASSIGNABLE", "Choose a platform-scoped role.");
      }
      const next = await tx.user.update({
        where: { id: userId },
        data: { platformRoleId: role?.id ?? null, tokenVersion: { increment: 1 } }
      });
      await writeAuditLog(tx, {
        actorUserId,
        action: "PLATFORM_ROLE_ASSIGNED",
        entityType: "User",
        entityId: userId,
        metadata: { fromRoleKey: user.platformRole?.key ?? null, toRoleKey: role?.key ?? null }
      });
      return next;
    });
    return toAdminUserView(updated);
  }

  async listAuditLog(query: AdminAuditLogQueryDto): Promise<Page<AuditLogEntryView>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.AuditLogWhereInput = {
      actorUserId: query.actorUserId,
      action: query.action,
      createdAt: {
        gte: query.fromDate ? new Date(query.fromDate) : undefined,
        lte: query.toDate ? new Date(query.toDate) : undefined
      }
    };
    const [entries, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.auditLog.count({ where })
    ]);
    return {
      items: entries.map((entry) => ({
        id: entry.id,
        actorUserId: entry.actorUserId,
        actorFullName: entry.actor.fullName,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        reason: entry.reason,
        metadataJson: entry.metadataJson,
        createdAt: entry.createdAt
      })),
      page,
      pageSize,
      total
    };
  }
}

function toAdminUserView(user: {
  id: string;
  fullName: string;
  phone: string;
  role: UserRole;
  isActive: boolean;
  phoneVerifiedAt: Date | null;
  createdAt: Date;
}): AdminUserView {
  return {
    id: user.id,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    phoneVerifiedAt: user.phoneVerifiedAt,
    createdAt: user.createdAt
  };
}

function phoneAlreadyRegistered(): ApiException {
  return new ApiException(
    409,
    "PHONE_ALREADY_REGISTERED",
    "An account already exists with this phone number."
  );
}
