import { Injectable } from "@nestjs/common";
import {
  DeliveryStatus,
  DriverApprovalStatus,
  OrderStatus,
  Prisma,
  RestaurantStatus,
  UserRole
} from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { AdminAuditLogQueryDto, AdminUsersQueryDto } from "./admin.dto";
import type { AdminUserView, AuditLogEntryView, DashboardOverview, Page } from "./admin.types";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(): Promise<DashboardOverview> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      ordersToday,
      revenueOrders,
      activeDeliveries,
      pendingRestaurantApprovals,
      onlineDriversCount,
      newCustomerSignupsToday,
      activity
    ] = await Promise.all([
      this.prisma.order.count({ where: { createdAt: { gte: startOfToday } } }),
      this.prisma.order.findMany({
        where: {
          createdAt: { gte: startOfToday },
          status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED] }
        },
        select: { totalMinor: true }
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

    const revenueTodayMinor = revenueOrders.reduce((sum, order) => sum + order.totalMinor, 0);

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
