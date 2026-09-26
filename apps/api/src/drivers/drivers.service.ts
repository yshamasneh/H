import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { writeAuditLog } from "../common/audit-log.util";
import { cashDue } from "../common/cash-rounding";
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
import * as copy from "../notifications/notification-copy";
import {
  createBusinessNotification,
  createNotification,
  createNotificationsForUsers,
  findAdminUserIds
} from "../notifications/notification.util";
import { PrismaService } from "../prisma/prisma.service";
import { DeferredEmitter } from "../realtime/deferred-emitter";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { RoutingService } from "../routing/routing.service";
import {
  activeDeliveryStatuses,
  allowedDeliveryTransitions,
  defaultFaultParty,
  deliveryStatusTransitions,
  orderStatusesAllowingDeliveryProgress
} from "./delivery.rules";
import { buildCashLines, resolvePeriodStart, type OrderFact } from "./driver-cash-summary";
import {
  defaultPresenceDurations,
  isAppOpen,
  nextPresence,
  renewedPresence,
  type PresenceDurations,
  type PresenceReport
} from "./presence.rules";
import type { DriverDeliveryStatusAction, DriverRegisterDto } from "./drivers.dto";
import type {
  AdminDriverLocationView,
  AdminDriverView,
  AdminOrderTrackingView,
  DeliveryRouteView,
  DeliveryView,
  DriverCashPeriod,
  AdminDriverPresence,
  DriverCashSummaryView,
  DriverLocationReportView,
  DriverProfileView,
  DriverStatsView,
  Page
} from "./drivers.types";

type DeliveryWithRelations = Delivery & { order: Order & { restaurant: Restaurant; customer?: Pick<User, "phone"> | null } };
type DriverWithUser = DriverProfile & { user: User };

const deliveryInclude = { order: { include: { restaurant: true, customer: { select: { phone: true } } } } } as const;

/** Orders listed under a cash summary. Totals are exact regardless; only the list is capped. */
const cashSummaryLineLimit = 100;

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly routing?: RoutingService
  ) {}

  private presenceDurations(): PresenceDurations {
    return {
      foregroundLeaseMs:
        (this.config?.get<number>("DRIVER_PRESENCE_FOREGROUND_LEASE_SECONDS") ??
          defaultPresenceDurations.foregroundLeaseMs / 1_000) * 1_000,
      backgroundGraceMs:
        (this.config?.get<number>("DRIVER_PRESENCE_BACKGROUND_GRACE_MINUTES") ??
          defaultPresenceDurations.backgroundGraceMs / 60_000) * 60_000
    };
  }

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
    const now = new Date();
    // Tapping the switch is proof the app is open in the foreground right now.
    const presence = isOnline ? nextPresence("FOREGROUND", now, this.presenceDurations()) : {};
    const updated = await this.prisma.driverProfile.update({
      where: { userId: profile.userId },
      data: { isOnline, ...presence, ...(isOnline ? { appSeenAt: now } : {}) }
    });
    this.realtime.emitToAdmins("driver.status.changed", { userId: profile.userId, isOnline });
    this.emitPresence(updated, now);
    return toProfileView(updated);
  }

  /**
   * The app says it is open (a heartbeat), has gone to the background, or is closed.
   *
   * This is the only thing that tells the server the app is running, because a force-close cannot
   * be observed directly; it can only be inferred from the reports stopping. See presence.rules.ts
   * for the lease and what it means for alerts.
   */
  async reportPresence(
    driverUserId: string,
    report: PresenceReport
  ): Promise<{ appOpen: boolean; appLeaseUntil: Date | null }> {
    const profile = await this.requireOwnProfile(driverUserId);
    const now = new Date();
    const wasOpen = isAppOpen(profile, now);
    const previousState = profile.appState;
    const next = nextPresence(report, now, this.presenceDurations());
    const updated = await this.prisma.driverProfile.update({
      where: { userId: profile.userId },
      data: { ...next, appSeenAt: now }
    });
    // Announce only changes (the app opening, closing, or moving between foreground and background),
    // not every heartbeat, so a room of admins is not woken by each driver's every 45 seconds.
    if (wasOpen !== isAppOpen(updated, now) || previousState !== updated.appState) {
      this.emitPresence(updated, now);
    }
    return { appOpen: isAppOpen(updated, now), appLeaseUntil: updated.appLeaseUntil };
  }

  private emitPresence(profile: DriverProfile, now: Date): void {
    this.realtime.emitToAdmins("driver.presence.changed", {
      userId: profile.userId,
      isOnline: profile.isOnline,
      ...presenceView(profile, now)
    });
  }

  async updateLocation(driverUserId: string, latitude: number, longitude: number): Promise<DriverLocationReportView> {
    const profile = await this.requireOwnProfile(driverUserId);
    const reportedAt = new Date();
    // A fix is proof the app is running, and keeps whichever state it last announced.
    const presence = renewedPresence(profile, reportedAt, this.presenceDurations());
    const updated = await this.prisma.driverProfile.update({
      where: { userId: profile.userId },
      data: { lastLatitude: latitude, lastLongitude: longitude, lastLocationAt: reportedAt, ...presence, appSeenAt: reportedAt }
    });
    const activeDeliveries = await this.prisma.delivery.count({
      where: { driverId: profile.userId, status: { in: activeDeliveryStatuses } }
    });
    // Admins only: a driver's position is operational data for dispatch, not something the customer
    // or the business is shown, so it never goes to an order room.
    this.realtime.emitToAdmins("driver.location.updated", {
      userId: profile.userId,
      latitude,
      longitude,
      lastLocationAt: reportedAt
    });
    return { ...toProfileView(updated), hasActiveDelivery: activeDeliveries > 0 };
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

  /**
   * The driver's cash-and-pay screen: three separate facts read straight from the accounting ledger.
   *
   * Nothing is recomputed here. Cash collected and cash handed over come from DriverCashCustody, the
   * delivery-fee share from PartnerEarning, what has been paid out from PartnerSettlement — the rows
   * the accounting layer wrote when each order reached its outcome. Cash is settled GROSS (the
   * driver hands over everything collected and is paid separately), so the amount owed to the
   * platform is deliberately NOT reduced by the driver's earnings.
   *
   * Per-order lines are attributed through the order's financial record; a ledger correction that
   * is not tied to an order still counts in the totals but has no line of its own.
   */
  async getOwnCashSummary(driverUserId: string, period: DriverCashPeriod): Promise<DriverCashSummaryView> {
    await this.requireOwnProfile(driverUserId);
    const now = new Date();
    const lastHandover = await this.prisma.cashSettlement.findFirst({
      where: { driverUserId },
      orderBy: { settledAt: "desc" },
      select: { settledAt: true }
    });
    const lastHandoverAt = lastHandover?.settledAt ?? null;
    const from = resolvePeriodStart(period, now, lastHandoverAt);

    const collectedWhere = { driverUserId, ...(from ? { collectedAt: { gte: from } } : {}) };
    const earnedWhere = { driverUserId, ...(from ? { occurredAt: { gte: from } } : {}) };
    const [
      custodyTotals,
      custodyRows,
      openCustody,
      earningTotals,
      earningRows,
      earnedToDate,
      paidToDate,
      deliveredCount,
      failedCount
    ] = await Promise.all([
      this.prisma.driverCashCustody.aggregate({
        where: collectedWhere,
        _sum: { collectedAmountMinor: true, settledAmountMinor: true }
      }),
      this.prisma.driverCashCustody.findMany({
        where: collectedWhere,
        orderBy: { collectedAt: "desc" },
        take: cashSummaryLineLimit + 1
      }),
      this.prisma.driverCashCustody.findMany({
        where: { driverUserId, status: { in: ["OUTSTANDING", "PARTIALLY_SETTLED"] } },
        orderBy: { collectedAt: "asc" },
        select: { orderId: true, collectedAmountMinor: true, settledAmountMinor: true, collectedAt: true }
      }),
      this.prisma.partnerEarning.aggregate({ where: earnedWhere, _sum: { amountMinor: true } }),
      this.prisma.partnerEarning.findMany({
        where: earnedWhere,
        orderBy: { occurredAt: "desc" },
        take: cashSummaryLineLimit + 1,
        select: { amountMinor: true, occurredAt: true, orderFinancialRecordId: true }
      }),
      this.prisma.partnerEarning.aggregate({ where: { driverUserId }, _sum: { amountMinor: true } }),
      this.prisma.partnerSettlement.aggregate({ where: { driverUserId }, _sum: { amountMinor: true } }),
      this.prisma.delivery.count({
        where: {
          driverId: driverUserId,
          status: DeliveryStatus.DELIVERED,
          ...(from ? { deliveredAt: { gte: from } } : {})
        }
      }),
      this.prisma.delivery.count({
        where: {
          driverId: driverUserId,
          status: DeliveryStatus.FAILED,
          ...(from ? { failedAt: { gte: from } } : {})
        }
      })
    ]);

    const recordIds = [
      ...new Set(earningRows.map((row) => row.orderFinancialRecordId).filter((id): id is string => Boolean(id)))
    ];
    const records = recordIds.length
      ? await this.prisma.orderFinancialRecord.findMany({
          where: { id: { in: recordIds } },
          select: { id: true, orderId: true, outcome: true }
        })
      : [];
    const orderIdByRecord = new Map(records.map((record) => [record.id, record.orderId]));
    const outcomeByOrder = new Map(records.map((record) => [record.orderId, record.outcome]));

    const custodyFacts = custodyRows.slice(0, cashSummaryLineLimit);
    const earningFacts = earningRows.slice(0, cashSummaryLineLimit).map((row) => ({
      orderId: row.orderFinancialRecordId ? (orderIdByRecord.get(row.orderFinancialRecordId) ?? null) : null,
      amountMinor: row.amountMinor,
      occurredAt: row.occurredAt
    }));
    // The unsettled orders behind the standing balance, which is a different set from the period's.
    const openFacts = openCustody.slice(0, cashSummaryLineLimit);
    const orderIds = [
      ...new Set([
        ...custodyFacts.map((row) => row.orderId),
        ...earningFacts.map((row) => row.orderId),
        ...openFacts.map((row) => row.orderId)
      ])
    ].filter((id): id is string => Boolean(id));
    const orders = orderIds.length
      ? await this.prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, deliveryLabel: true, restaurant: { select: { name: true } } }
        })
      : [];
    const orderFacts = new Map<string, OrderFact>(
      orders.map((order) => [
        order.id,
        {
          restaurantName: order.restaurant.name,
          deliveryLabel: order.deliveryLabel,
          // Cash custody exists only for a delivered order; a failed one takes no cash.
          outcome:
            outcomeByOrder.get(order.id) ??
            ([...custodyFacts, ...openFacts].some((row) => row.orderId === order.id) ? "DELIVERED" : null)
        }
      ])
    );

    const lines = buildCashLines(custodyFacts, earningFacts, orderFacts);
    // Oldest first: the order that has been held longest is the one to hand over first.
    const openOrders = buildCashLines(openFacts, [], orderFacts).reverse();
    const owedNow = openCustody.reduce((sum, row) => sum + row.collectedAmountMinor - row.settledAmountMinor, 0);
    const owedFromBeforePeriod = from
      ? openCustody
          .filter((row) => row.collectedAt < from)
          .reduce((sum, row) => sum + row.collectedAmountMinor - row.settledAmountMinor, 0)
      : 0;
    const earnedAllMinor = earnedToDate._sum.amountMinor ?? 0;
    const paidAllMinor = paidToDate._sum.amountMinor ?? 0;

    return {
      period,
      from,
      to: now,
      lastHandoverAt,
      cashCollectedMinor: custodyTotals._sum.collectedAmountMinor ?? 0,
      cashHandedOverMinor: custodyTotals._sum.settledAmountMinor ?? 0,
      earningsMinor: earningTotals._sum.amountMinor ?? 0,
      deliveredCount,
      failedCount,
      balance: {
        cashOwedToPlatformMinor: owedNow,
        unsettledOrderCount: openCustody.length,
        oldestUnsettledAt: openCustody.reduce<Date | null>(
          (oldest, row) => (oldest === null || row.collectedAt < oldest ? row.collectedAt : oldest),
          null
        ),
        cashOwedFromBeforePeriodMinor: owedFromBeforePeriod,
        earningsOwedToDriverMinor: earnedAllMinor - paidAllMinor,
        openOrders,
        openOrdersTruncated: openCustody.length > cashSummaryLineLimit
      },
      lines,
      linesTruncated: custodyRows.length > cashSummaryLineLimit || earningRows.length > cashSummaryLineLimit
    };
  }

  async getOwnProfile(driverUserId: string): Promise<DriverProfileView> {
    return toProfileView(await this.requireOwnProfile(driverUserId));
  }

  /**
   * The road route from the store to the customer for one of this driver's deliveries.
   *
   * A driver can only ask about their own delivery, so this is not a general routing proxy. The
   * route never changes once the order exists and is cached by the routing service, so it costs
   * about one upstream request per delivery.
   */
  async getDeliveryRoute(driverUserId: string, deliveryId: string): Promise<DeliveryRouteView> {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: deliveryInclude
    });
    if (!delivery || delivery.driverId !== driverUserId) {
      throw deliveryNotFound();
    }
    const store = delivery.order.restaurant;
    const destination = delivery.order;
    if (
      typeof store.latitude !== "number" ||
      typeof store.longitude !== "number" ||
      typeof destination.deliveryLatitude !== "number" ||
      typeof destination.deliveryLongitude !== "number"
    ) {
      return { deliveryId, route: null, unavailableReason: "NO_COORDINATES" };
    }
    const route = await this.routing?.route(
      { latitude: store.latitude, longitude: store.longitude },
      { latitude: destination.deliveryLatitude, longitude: destination.deliveryLongitude }
    );
    return route
      ? { deliveryId, route, unavailableReason: null }
      : { deliveryId, route: null, unavailableReason: "UNAVAILABLE" };
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
          ...copy.driverAssignedForCustomer(),
          relatedEntityId: order.id
        });
        emitter.emitToOrder(order.id, "delivery.status.changed", { deliveryId, status: DeliveryStatus.ASSIGNED });
        emitter.emitToAdmins("delivery.status.changed", {
          deliveryId,
          orderId: order.id,
          status: DeliveryStatus.ASSIGNED,
          driverUserId
        });
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
        ...copy.deliveryStatusForCustomer(targetStatus),
        relatedEntityId: order.id
      });
      if (targetStatus === DeliveryStatus.FAILED) {
        // The business needs to know immediately: the goods left and were not handed over.
        await createBusinessNotification(tx, emitter, {
          businessId: order.restaurantId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          ...copy.deliveryFailedForBusiness(failure!.failureReason),
          relatedEntityId: order.id
        });
        // The order is now stuck between "left the store" and "handed over" and only an operator can
        // decide what happens to it (re-dispatch, refund, return to store), so admins are pushed too.
        await createNotificationsForUsers(tx, emitter, await findAdminUserIds(tx), {
          type: NotificationType.ADMIN_ALERT,
          ...copy.deliveryFailedForAdmin(order.id.slice(0, 8), failure!.failureReason),
          relatedEntityId: order.id
        });
      }
      emitter.emitToOrder(order.id, "delivery.status.changed", { deliveryId, status: targetStatus });
      emitter.emitToAdmins("delivery.status.changed", {
        deliveryId,
        orderId: order.id,
        status: targetStatus,
        driverUserId
      });
      if (finalOrderStatus) {
        emitter.emitToOrder(order.id, "order.status.changed", { orderId: order.id, status: finalOrderStatus });
        emitter.emitToAdmins("order.status.changed", { orderId: order.id, status: finalOrderStatus });
        emitter.emitToRestaurant(order.restaurantId, "order.status.changed", { orderId: order.id, status: finalOrderStatus });
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

    const now = new Date();
    return profiles.map((profile) =>
      toAdminView(profile, completedByDriver.get(profile.userId) ?? 0, activeByDriver.get(profile.userId) ?? null, now)
    );
  }

  /**
   * Every driver who is on shift or mid-delivery, with their last reported position. A driver who
   * has gone offline but still holds an active delivery stays listed, because dispatch still needs
   * to see where that order is.
   */
  async adminListDriverLocations(): Promise<AdminDriverLocationView[]> {
    const activeDeliveries = await this.prisma.delivery.findMany({
      where: { status: { in: activeDeliveryStatuses } },
      include: { order: { include: { restaurant: true } } }
    });
    const activeByDriver = new Map<string, DeliveryWithRelations>();
    for (const delivery of activeDeliveries) {
      if (delivery.driverId) activeByDriver.set(delivery.driverId, delivery as DeliveryWithRelations);
    }
    const profiles = await this.prisma.driverProfile.findMany({
      where: {
        status: DriverApprovalStatus.APPROVED,
        OR: [{ isOnline: true }, { userId: { in: [...activeByDriver.keys()] } }]
      },
      include: { user: true },
      orderBy: { createdAt: "asc" }
    });
    const now = new Date();
    return profiles.map((profile) => toLocationView(profile, activeByDriver.get(profile.userId) ?? null, now));
  }

  /** Where the assigned driver of one order is right now. */
  async adminGetOrderTracking(orderId: string): Promise<AdminOrderTrackingView> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { restaurant: true, delivery: true }
    });
    if (!order) {
      throw new ApiException(404, "ORDER_NOT_FOUND", "This order does not exist.");
    }
    const delivery = order.delivery;
    let driver: AdminDriverLocationView | null = null;
    if (delivery?.driverId) {
      const profile = await this.prisma.driverProfile.findUnique({
        where: { userId: delivery.driverId },
        include: { user: true }
      });
      if (profile) {
        driver = toLocationView(profile, { ...delivery, order } as unknown as DeliveryWithRelations, new Date());
      }
    }
    return {
      orderId: order.id,
      deliveryId: delivery?.id ?? null,
      deliveryStatus: delivery?.status ?? null,
      driver,
      pickup: {
        name: order.restaurant.name,
        latitude: order.restaurant.latitude,
        longitude: order.restaurant.longitude
      },
      destination: {
        label: order.deliveryLabel,
        latitude: order.deliveryLatitude,
        longitude: order.deliveryLongitude
      }
    };
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
        ...copy.driverAccountStatus(targetStatus, reason),
        relatedEntityId: driverUserId
      });

      return next;
    });
    emitter.flush();

    return toAdminView(updated, 0, null, new Date());
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

function toProfileView(profile: DriverProfile): DriverProfileView {
  return {
    userId: profile.userId,
    status: profile.status,
    isOnline: profile.isOnline,
    lastLatitude: profile.lastLatitude,
    lastLongitude: profile.lastLongitude
  };
}

function presenceView(profile: DriverProfile, now: Date): AdminDriverPresence {
  return {
    appState: profile.appState,
    appLeaseUntil: profile.appLeaseUntil,
    appOpen: isAppOpen(profile, now)
  };
}

function toLocationView(
  profile: DriverWithUser,
  active: DeliveryWithRelations | null,
  now: Date
): AdminDriverLocationView {
  const live = active && activeDeliveryStatuses.includes(active.status) ? active : null;
  return {
    ...presenceView(profile, now),
    userId: profile.userId,
    fullName: profile.user.fullName,
    phone: profile.user.phone,
    status: profile.status,
    isOnline: profile.isOnline,
    latitude: profile.lastLatitude,
    longitude: profile.lastLongitude,
    lastLocationAt: profile.lastLocationAt,
    activeDelivery: live
      ? {
          deliveryId: live.id,
          orderId: live.orderId,
          status: live.status,
          restaurantName: live.order.restaurant.name
        }
      : null
  };
}

function toAdminView(
  profile: DriverWithUser,
  completedDeliveriesCount: number,
  activeDeliveryId: string | null,
  now: Date
): AdminDriverView {
  return {
    ...presenceView(profile, now),
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
      ...cashDue(delivery.order.totalMinor),
      paymentMethod: delivery.order.paymentMethod,
      latitude: delivery.order.deliveryLatitude,
      longitude: delivery.order.deliveryLongitude,
      ...(driverMayCallCustomer(delivery) ? { customerPhone: delivery.order.customer!.phone } : {})
    },
    restaurant: {
      id: delivery.order.restaurant.id,
      name: delivery.order.restaurant.name,
      addressLine: delivery.order.restaurant.addressLine,
      latitude: delivery.order.restaurant.latitude,
      longitude: delivery.order.restaurant.longitude
    },
    assignedAt: delivery.assignedAt,
    pickedUpAt: delivery.pickedUpAt,
    onTheWayAt: delivery.onTheWayAt,
    deliveredAt: delivery.deliveredAt,
    failedAt: delivery.failedAt,
    cancelledAt: delivery.cancelledAt,
    failureReason: delivery.failureReason,
    failureNote: delivery.failureNote,
    createdAt: delivery.createdAt
  };
}

/**
 * A driver may hold the customer's number only while the job is theirs and still open: assigned to
 * a driver, and ASSIGNED / PICKED_UP / ON_THE_WAY. Enforced here, in the one function every driver
 * delivery response is built by, so the field is never in the payload otherwise (not merely hidden
 * by the app).
 */
function driverMayCallCustomer(delivery: DeliveryWithRelations): boolean {
  return delivery.driverId !== null && activeDeliveryStatuses.includes(delivery.status) && Boolean(delivery.order.customer?.phone);
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
