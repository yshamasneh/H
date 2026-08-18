import { Injectable } from "@nestjs/common";
import { writeAuditLog } from "../common/audit-log.util";
import { hashPassword } from "../auth/crypto.util";
import { normalizePhoneNumber } from "../auth/phone.util";
import { ApiException } from "../common/api.exception";
import {
  DeliveryFailureReason,
  DeliveryStatus,
  DriverApprovalStatus,
  NotificationType,
  OrderStatus,
  Prisma,
  UserRole,
  type Delivery,
  type DriverProfile,
  type Order,
  type Restaurant,
  type User
} from "../generated/prisma/client";
import {
  financialOutcomeByOrderStatus,
  recordOrderFinancials,
  type FinancialOutcome
} from "../accounting/order-financials.util";
import { createBusinessNotification, createNotification } from "../notifications/notification.util";
import { PrismaService } from "../prisma/prisma.service";
import { DeferredEmitter } from "../realtime/deferred-emitter";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import {
  activeDeliveryStatuses,
  allowedDeliveryTransitions,
  defaultFaultParty,
  deliveryStatusTransitions,
  orderStatusesAllowingDeliveryProgress
} from "./delivery.rules";
import type { DriverDeliveryStatusAction, DriverRegisterDto } from "./drivers.dto";
import type { AdminDriverView, DeliveryView, DriverProfileView, DriverStatsView, Page } from "./drivers.types";

type DeliveryWithRelations = Delivery & { order: Order & { restaurant: Restaurant } };
type DriverWithUser = DriverProfile & { user: User };

const deliveryInclude = { order: { include: { restaurant: true } } } as const;

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway
  ) {}

  async register(input: DriverRegisterDto): Promise<{ message: string; userId: string }> {
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

    try {
      const driver = await this.prisma.$transaction(async (transaction) => {
        const recheckedUser = await transaction.user.findUnique({ where: { phone } });
        if (recheckedUser) {
          throw phoneAlreadyRegistered();
        }
        const user = await transaction.user.create({
          data: {
            fullName,
            phone,
            passwordHash,
            role: UserRole.DRIVER,
            phoneVerifiedAt: new Date(),
            isActive: true
          }
        });
        await transaction.driverProfile.create({
          data: { userId: user.id, status: DriverApprovalStatus.PENDING, isOnline: false }
        });
        return user;
      });

      return {
        message:
          "Your driver account was created and is awaiting admin approval. Log in with your phone number and password once it is approved.",
        userId: driver.id
      };
    } catch (error) {
      if (isPrismaCode(error, "P2002")) {
        throw phoneAlreadyRegistered();
      }
      throw error;
    }
  }

  async setOnlineStatus(driverUserId: string, isOnline: boolean): Promise<DriverProfileView> {
    const profile = await this.requireOwnProfile(driverUserId);
    if (isOnline && profile.status !== DriverApprovalStatus.APPROVED) {
      throw new ApiException(
        403,
        "DRIVER_NOT_APPROVED",
        "Your driver account has not been approved yet. Please wait for admin approval."
      );
    }
    const updated = await this.prisma.driverProfile.update({ where: { userId: profile.userId }, data: { isOnline } });
    return toProfileView(updated);
  }

  async updateLocation(driverUserId: string, latitude: number, longitude: number): Promise<DriverProfileView> {
    const profile = await this.requireOwnProfile(driverUserId);
    const updated = await this.prisma.driverProfile.update({
      where: { userId: profile.userId },
      data: { lastLatitude: latitude, lastLongitude: longitude, lastLocationAt: new Date() }
    });
    return toProfileView(updated);
  }

  /**
   * A driver's own figures, read from the ledger rather than recomputed from deliveries.
   *
   * Recomputing would be a second source of truth for money that has already been recorded, and
   * the two would drift the first time a rate changed. Two separate facts are reported side by
   * side and never added together: what the driver has *earned*, and what cash the driver is
   * currently *holding* on the platform's behalf.
   */
  async getOwnStats(driverUserId: string): Promise<DriverStatsView> {
    await this.requireOwnProfile(driverUserId);
    const [completedCount, activeCount, earnings, payouts, custody] = await Promise.all([
      this.prisma.delivery.count({ where: { driverId: driverUserId, status: DeliveryStatus.DELIVERED } }),
      this.prisma.delivery.count({ where: { driverId: driverUserId, status: { in: activeDeliveryStatuses } } }),
      this.prisma.partnerEarning.aggregate({
        where: { driverUserId },
        _sum: { amountMinor: true }
      }),
      this.prisma.partnerSettlement.aggregate({
        where: { driverUserId },
        _sum: { amountMinor: true }
      }),
      this.prisma.driverCashCustody.aggregate({
        where: { driverUserId, status: { in: ["OUTSTANDING", "PARTIALLY_SETTLED"] } },
        _sum: { collectedAmountMinor: true, settledAmountMinor: true }
      })
    ]);
    const earningsMinor = earnings._sum.amountMinor ?? 0;
    const earningsPaidMinor = payouts._sum.amountMinor ?? 0;
    const cashOutstandingMinor =
      (custody._sum.collectedAmountMinor ?? 0) - (custody._sum.settledAmountMinor ?? 0);
    return {
      completedCount,
      activeCount,
      earningsMinor,
      earningsPaidMinor,
      earningsOutstandingMinor: earningsMinor - earningsPaidMinor,
      cashOutstandingMinor,
      perDeliveryMinor: completedCount > 0 ? Math.round(earningsMinor / completedCount) : 0
    };
  }

  async listAvailableDeliveries(): Promise<DeliveryView[]> {
    const deliveries = await this.prisma.delivery.findMany({
      where: { status: DeliveryStatus.PENDING_ASSIGNMENT },
      include: deliveryInclude,
      orderBy: { createdAt: "asc" }
    });
    return deliveries.map(toDeliveryView);
  }

  async listOwnDeliveries(driverUserId: string, page: number, pageSize: number): Promise<Page<DeliveryView>> {
    const where = { driverId: driverUserId };
    const [deliveries, total] = await Promise.all([
      this.prisma.delivery.findMany({
        where,
        include: deliveryInclude,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.delivery.count({ where })
    ]);
    return { items: deliveries.map(toDeliveryView), page, pageSize, total };
  }

  async acceptDelivery(driverUserId: string, deliveryId: string): Promise<DeliveryView> {
    const profile = await this.requireOwnProfile(driverUserId);
    if (!profile.isOnline) {
      throw new ApiException(409, "DRIVER_OFFLINE", "You must be online to accept a delivery.");
    }

    const emitter = new DeferredEmitter(this.realtime);
    const updated = await this.prisma.$transaction(async (tx) => {
      // One delivery at a time: a driver committed to an active job cannot claim another (and, since
      // there is no driver-facing cancel, cannot drop the current one to chase a better offer either).
      const activeCount = await tx.delivery.count({
        where: { driverId: driverUserId, status: { in: activeDeliveryStatuses } }
      });
      if (activeCount > 0) {
        throw new ApiException(
          409,
          "DELIVERY_DRIVER_HAS_ACTIVE",
          "Finish your current delivery before accepting another one."
        );
      }
      const existing = await tx.delivery.findUnique({ where: { id: deliveryId } });
      if (!existing) {
        throw deliveryNotFound();
      }
      // Refuse a delivery whose order is no longer awaiting handover, so a cancelled order cannot
      // be picked up and walked to completion.
      const claimedOrder = await tx.order.findUnique({ where: { id: existing.orderId } });
      if (!claimedOrder || !orderStatusesAllowingDeliveryProgress.includes(claimedOrder.status)) {
        throw new ApiException(
          409,
          "DELIVERY_ORDER_NOT_ACTIVE",
          "This order is no longer awaiting delivery."
        );
      }
      const claimed = await tx.delivery.updateMany({
        where: { id: deliveryId, status: DeliveryStatus.PENDING_ASSIGNMENT, driverId: null },
        data: { status: DeliveryStatus.ASSIGNED, driverId: driverUserId, assignedAt: new Date() }
      });
      if (claimed.count !== 1) {
        throw new ApiException(
          409,
          "DELIVERY_ALREADY_CLAIMED",
          "This delivery has already been accepted by another driver."
        );
      }
      const order = await tx.order.findUnique({ where: { id: existing.orderId } });
      if (order) {
        await createNotification(tx, emitter, {
          userId: order.customerId,
          type: NotificationType.DELIVERY_ASSIGNED,
          title: "A driver is on the way",
          body: "A driver has been assigned to pick up your order.",
          relatedEntityId: order.id
        });
        emitter.emitToOrder(order.id, "delivery.status.changed", { deliveryId, status: DeliveryStatus.ASSIGNED });
      }
      return tx.delivery.findUnique({ where: { id: deliveryId }, include: deliveryInclude });
    });
    emitter.flush();

    return toDeliveryView(updated!);
  }

  async updateDeliveryStatus(
    driverUserId: string,
    deliveryId: string,
    action: DriverDeliveryStatusAction,
    failure?: { failureReason?: DeliveryFailureReason; failureNote?: string }
  ): Promise<DeliveryView> {
    const targetStatus = deliveryStatusTransitions[action];
    if (targetStatus === DeliveryStatus.FAILED && !failure?.failureReason) {
      throw new ApiException(
        400,
        "DELIVERY_FAILURE_REASON_REQUIRED",
        "Choose why the delivery could not be completed."
      );
    }

    const emitter = new DeferredEmitter(this.realtime);
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.delivery.findUnique({ where: { id: deliveryId } });
      if (!existing || existing.driverId !== driverUserId) {
        throw deliveryNotFound();
      }
      if (!allowedDeliveryTransitions[existing.status].includes(targetStatus)) {
        throw invalidDeliveryTransition(existing.status, targetStatus);
      }

      // The order, not just the delivery, decides whether a courier task is still live. Without
      // this check a cancelled order's delivery stays actionable and the driver can complete it.
      const order = await tx.order.findUnique({ where: { id: existing.orderId } });
      if (!order || !orderStatusesAllowingDeliveryProgress.includes(order.status)) {
        throw new ApiException(
          409,
          "DELIVERY_ORDER_NOT_ACTIVE",
          "This order is no longer awaiting delivery."
        );
      }

      const now = new Date();
      const timestampField = deliveryTimestampField(targetStatus);
      const failureData =
        targetStatus === DeliveryStatus.FAILED
          ? {
              failureReason: failure!.failureReason,
              faultParty: defaultFaultParty[failure!.failureReason!],
              failureNote: failure?.failureNote?.trim() || null
            }
          : {};
      const changed = await tx.delivery.updateMany({
        where: { id: deliveryId, status: existing.status },
        data: {
          status: targetStatus,
          ...(timestampField ? { [timestampField]: now } : {}),
          ...failureData
        }
      });
      if (changed.count !== 1) {
        throw invalidDeliveryTransition(existing.status, targetStatus);
      }

      const finalOrderStatus = orderStatusForDelivery(targetStatus);
      if (finalOrderStatus) {
        // Guarded on the order's current status so this cannot overwrite a concurrent transition.
        const advanced = await tx.order.updateMany({
          where: { id: order.id, status: order.status },
          data: { status: finalOrderStatus }
        });
        if (advanced.count !== 1) {
          throw new ApiException(
            409,
            "DELIVERY_ORDER_NOT_ACTIVE",
            "This order is no longer awaiting delivery."
          );
        }
        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: order.status,
            toStatus: finalOrderStatus,
            changedByUserId: driverUserId,
            note:
              targetStatus === DeliveryStatus.FAILED
                ? `Delivery failed: ${failure!.failureReason}`
                : null
          }
        });
      }
      // The money and the delivery are one transaction. An order that reached a terminal outcome
      // without its financial record — or a record without the order having moved — would leave
      // cash in a driver's pocket that nothing in the system explains.
      const financialOutcome = financialOutcomeForOrderStatus(finalOrderStatus);
      if (financialOutcome) {
        await recordOrderFinancials(tx, order.id, financialOutcome);
      }

      await createNotification(tx, emitter, {
        userId: order.customerId,
        type: NotificationType.DELIVERY_STATUS_CHANGED,
        title: deliveryStatusNotificationTitle(targetStatus),
        body: deliveryStatusNotificationBody(targetStatus),
        relatedEntityId: order.id
      });
      if (targetStatus === DeliveryStatus.FAILED) {
        // The business needs to know immediately: the goods left and were not handed over.
        await createBusinessNotification(tx, emitter, {
          businessId: order.restaurantId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: "A delivery could not be completed",
          body: `The driver reported: ${failure!.failureReason}.`,
          relatedEntityId: order.id
        });
      }
      emitter.emitToOrder(order.id, "delivery.status.changed", { deliveryId, status: targetStatus });
      if (finalOrderStatus) {
        emitter.emitToOrder(order.id, "order.status.changed", { orderId: order.id, status: finalOrderStatus });
        emitter.emitToAdmins("order.status.changed", { orderId: order.id, status: finalOrderStatus });
      }

      return tx.delivery.findUnique({ where: { id: deliveryId }, include: deliveryInclude });
    });
    emitter.flush();

    return toDeliveryView(updated!);
  }

  async adminListDrivers(): Promise<AdminDriverView[]> {
    const profiles = await this.prisma.driverProfile.findMany({
      include: { user: true },
      orderBy: { createdAt: "desc" }
    });
    const driverIds = profiles.map((profile) => profile.userId);
    const allRelevantDeliveries = await this.prisma.delivery.findMany({
      where: {
        driverId: { in: driverIds },
        status: {
          in: [DeliveryStatus.DELIVERED, DeliveryStatus.ASSIGNED, DeliveryStatus.PICKED_UP, DeliveryStatus.ON_THE_WAY]
        }
      }
    });
    const completedByDriver = new Map<string, number>();
    const activeByDriver = new Map<string, string>();
    for (const delivery of allRelevantDeliveries) {
      if (!delivery.driverId) continue;
      if (delivery.status === DeliveryStatus.DELIVERED) {
        completedByDriver.set(delivery.driverId, (completedByDriver.get(delivery.driverId) ?? 0) + 1);
      } else {
        activeByDriver.set(delivery.driverId, delivery.id);
      }
    }

    return profiles.map((profile) =>
      toAdminView(profile, completedByDriver.get(profile.userId) ?? 0, activeByDriver.get(profile.userId) ?? null)
    );
  }

  async adminApprove(adminUserId: string, driverUserId: string): Promise<AdminDriverView> {
    return this.adminTransition(adminUserId, driverUserId, DriverApprovalStatus.APPROVED, [DriverApprovalStatus.PENDING], "DRIVER_APPROVED", undefined);
  }

  async adminReject(adminUserId: string, driverUserId: string, reason: string): Promise<AdminDriverView> {
    return this.adminTransition(adminUserId, driverUserId, DriverApprovalStatus.REJECTED, [DriverApprovalStatus.PENDING], "DRIVER_REJECTED", reason);
  }

  async adminSuspend(adminUserId: string, driverUserId: string, reason: string): Promise<AdminDriverView> {
    return this.adminTransition(adminUserId, driverUserId, DriverApprovalStatus.SUSPENDED, [DriverApprovalStatus.APPROVED], "DRIVER_SUSPENDED", reason);
  }

  async adminReactivate(adminUserId: string, driverUserId: string): Promise<AdminDriverView> {
    return this.adminTransition(adminUserId, driverUserId, DriverApprovalStatus.APPROVED, [DriverApprovalStatus.SUSPENDED], "DRIVER_REACTIVATED", undefined);
  }

  private async adminTransition(
    adminUserId: string,
    driverUserId: string,
    targetStatus: DriverApprovalStatus,
    allowedFrom: DriverApprovalStatus[],
    auditAction: string,
    reason: string | undefined
  ): Promise<AdminDriverView> {
    const emitter = new DeferredEmitter(this.realtime);
    const updated = await this.prisma.$transaction(async (tx) => {
      const profile = await tx.driverProfile.findUnique({ where: { userId: driverUserId }, include: { user: true } });
      if (!profile) {
        throw new ApiException(404, "DRIVER_NOT_FOUND", "This driver account does not exist.");
      }
      if (!allowedFrom.includes(profile.status)) {
        throw new ApiException(
          409,
          "DRIVER_INVALID_TRANSITION",
          `Driver cannot move from ${profile.status} to ${targetStatus}.`
        );
      }

      const data: Prisma.DriverProfileUpdateInput = { status: targetStatus };
      if (targetStatus !== DriverApprovalStatus.APPROVED) {
        data.isOnline = false;
      }
      const next = await tx.driverProfile.update({ where: { userId: driverUserId }, data, include: { user: true } });

      await writeAuditLog(tx, {
        actorUserId: adminUserId,
        action: auditAction,
        entityType: "DriverProfile",
        entityId: driverUserId,
        reason: reason ?? null,
        metadata: { fromStatus: profile.status, toStatus: targetStatus }
      });

      const notificationType =
        targetStatus === DriverApprovalStatus.APPROVED
          ? NotificationType.DRIVER_APPROVED
          : targetStatus === DriverApprovalStatus.REJECTED
            ? NotificationType.DRIVER_REJECTED
            : NotificationType.DRIVER_SUSPENDED;
      await createNotification(tx, emitter, {
        userId: driverUserId,
        type: notificationType,
        title: driverStatusNotificationTitle(targetStatus),
        body: reason ? `Reason: ${reason}` : driverStatusNotificationTitle(targetStatus),
        relatedEntityId: driverUserId
      });

      return next;
    });
    emitter.flush();

    return toAdminView(updated, 0, null);
  }

  private async requireOwnProfile(driverUserId: string): Promise<DriverProfile> {
    const profile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
    if (!profile) {
      throw new ApiException(404, "DRIVER_PROFILE_NOT_FOUND", "No driver profile is linked to this account.");
    }
    return profile;
  }

  private assertPasswordsMatch(password: string, confirmation: string): void {
    if (password !== confirmation) {
      throw new ApiException(400, "PASSWORDS_DO_NOT_MATCH", "The passwords do not match.");
    }
  }
}

/**
 * Which terminal order statuses move money. Cancelled and rejected orders move none, and an order
 * still in flight has nothing to value yet.
 */
function financialOutcomeForOrderStatus(status: OrderStatus | null): FinancialOutcome | null {
  if (status === OrderStatus.DELIVERED) return financialOutcomeByOrderStatus.DELIVERED;
  if (status === OrderStatus.DELIVERY_FAILED) return financialOutcomeByOrderStatus.DELIVERY_FAILED;
  return null;
}

function deliveryTimestampField(
  status: DeliveryStatus
): "pickedUpAt" | "onTheWayAt" | "deliveredAt" | "failedAt" | "cancelledAt" | null {
  switch (status) {
    case DeliveryStatus.PICKED_UP:
      return "pickedUpAt";
    case DeliveryStatus.ON_THE_WAY:
      return "onTheWayAt";
    case DeliveryStatus.DELIVERED:
      return "deliveredAt";
    case DeliveryStatus.FAILED:
      return "failedAt";
    case DeliveryStatus.CANCELLED:
      return "cancelledAt";
    default:
      return null;
  }
}

/** The order status a delivery outcome drives, or null when the order is unaffected. */
function orderStatusForDelivery(status: DeliveryStatus): OrderStatus | null {
  if (status === DeliveryStatus.DELIVERED) return OrderStatus.DELIVERED;
  if (status === DeliveryStatus.FAILED) return OrderStatus.DELIVERY_FAILED;
  return null;
}

function deliveryStatusNotificationTitle(status: DeliveryStatus): string {
  switch (status) {
    case DeliveryStatus.PICKED_UP:
      return "Your order has been picked up";
    case DeliveryStatus.ON_THE_WAY:
      return "Your order is on the way";
    case DeliveryStatus.DELIVERED:
      return "Your order has been delivered";
    case DeliveryStatus.FAILED:
      return "Your order could not be delivered";
    default:
      return "Delivery update";
  }
}

function deliveryStatusNotificationBody(status: DeliveryStatus): string {
  switch (status) {
    case DeliveryStatus.PICKED_UP:
      return "The driver has picked up your order from the restaurant.";
    case DeliveryStatus.ON_THE_WAY:
      return "The driver is on the way to your delivery address.";
    case DeliveryStatus.DELIVERED:
      return "Enjoy your meal! Your order has been marked delivered.";
    case DeliveryStatus.FAILED:
      return "The driver could not complete this delivery. Please contact support if you need help.";
    default:
      return "Your delivery status has changed.";
  }
}

function driverStatusNotificationTitle(status: DriverApprovalStatus): string {
  switch (status) {
    case DriverApprovalStatus.APPROVED:
      return "Your driver account has been approved";
    case DriverApprovalStatus.REJECTED:
      return "Your driver application was not approved";
    case DriverApprovalStatus.SUSPENDED:
      return "Your driver account has been suspended";
    default:
      return "Your driver account status has changed";
  }
}

function toProfileView(profile: DriverProfile): DriverProfileView {
  return {
    userId: profile.userId,
    status: profile.status,
    isOnline: profile.isOnline,
    lastLatitude: profile.lastLatitude,
    lastLongitude: profile.lastLongitude
  };
}

function toAdminView(profile: DriverWithUser, completedDeliveriesCount: number, activeDeliveryId: string | null): AdminDriverView {
  return {
    userId: profile.userId,
    fullName: profile.user.fullName,
    phone: profile.user.phone,
    isActive: profile.user.isActive,
    status: profile.status,
    isOnline: profile.isOnline,
    completedDeliveriesCount,
    activeDeliveryId,
    createdAt: profile.createdAt
  };
}

function toDeliveryView(delivery: DeliveryWithRelations): DeliveryView {
  return {
    id: delivery.id,
    status: delivery.status,
    order: {
      id: delivery.order.id,
      deliveryLabel: delivery.order.deliveryLabel,
      deliveryAddressLine: delivery.order.deliveryAddressLine,
      totalMinor: delivery.order.totalMinor,
      paymentMethod: delivery.order.paymentMethod
    },
    restaurant: {
      id: delivery.order.restaurant.id,
      name: delivery.order.restaurant.name,
      addressLine: delivery.order.restaurant.addressLine
    },
    assignedAt: delivery.assignedAt,
    pickedUpAt: delivery.pickedUpAt,
    onTheWayAt: delivery.onTheWayAt,
    deliveredAt: delivery.deliveredAt,
    createdAt: delivery.createdAt
  };
}

function deliveryNotFound(): ApiException {
  return new ApiException(404, "DELIVERY_NOT_FOUND", "This delivery does not exist.");
}

function invalidDeliveryTransition(from: DeliveryStatus, to: DeliveryStatus): ApiException {
  return new ApiException(409, "DELIVERY_INVALID_TRANSITION", `Delivery cannot move from ${from} to ${to}.`);
}

function phoneAlreadyRegistered(): ApiException {
  return new ApiException(
    409,
    "PHONE_ALREADY_REGISTERED",
    "An account already exists with this phone number. Please log in instead."
  );
}

function isPrismaCode(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
