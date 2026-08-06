import { Injectable } from "@nestjs/common";
import { hashPassword } from "../auth/crypto.util";
import { normalizePhoneNumber } from "../auth/phone.util";
import { ApiException } from "../common/api.exception";
import {
  DeliveryStatus,
  OrderStatus,
  Prisma,
  UserRole,
  type Delivery,
  type DriverProfile,
  type Order,
  type Restaurant
} from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { DriverDeliveryStatusAction, DriverRegisterDto } from "./drivers.dto";
import type { DeliveryView, DriverProfileView, Page } from "./drivers.types";

type DeliveryWithRelations = Delivery & { order: Order & { restaurant: Restaurant } };

const deliveryInclude = { order: { include: { restaurant: true } } } as const;

const deliveryStatusTransitions: Record<DriverDeliveryStatusAction, DeliveryStatus> = {
  PICKED_UP: DeliveryStatus.PICKED_UP,
  ON_THE_WAY: DeliveryStatus.ON_THE_WAY,
  DELIVERED: DeliveryStatus.DELIVERED
};

const allowedDeliveryTransitions: Record<DeliveryStatus, DeliveryStatus[]> = {
  [DeliveryStatus.PENDING_ASSIGNMENT]: [],
  [DeliveryStatus.ASSIGNED]: [DeliveryStatus.PICKED_UP],
  [DeliveryStatus.PICKED_UP]: [DeliveryStatus.ON_THE_WAY],
  [DeliveryStatus.ON_THE_WAY]: [DeliveryStatus.DELIVERED],
  [DeliveryStatus.DELIVERED]: [],
  [DeliveryStatus.CANCELLED]: []
};

@Injectable()
export class DriversService {
  constructor(private readonly prisma: PrismaService) {}

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
        await transaction.driverProfile.create({ data: { userId: user.id, isOnline: false } });
        return user;
      });

      return {
        message: "Your driver account was created. Log in with your phone number and password.",
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
    const updated = await this.prisma.driverProfile.update({ where: { userId: profile.userId }, data: { isOnline } });
    return toProfileView(updated);
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

    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.delivery.findUnique({ where: { id: deliveryId } });
      if (!existing) {
        throw deliveryNotFound();
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
      return tx.delivery.findUnique({ where: { id: deliveryId }, include: deliveryInclude });
    });

    return toDeliveryView(updated!);
  }

  async updateDeliveryStatus(
    driverUserId: string,
    deliveryId: string,
    action: DriverDeliveryStatusAction
  ): Promise<DeliveryView> {
    const targetStatus = deliveryStatusTransitions[action];

    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.delivery.findUnique({ where: { id: deliveryId } });
      if (!existing || existing.driverId !== driverUserId) {
        throw deliveryNotFound();
      }
      if (!allowedDeliveryTransitions[existing.status].includes(targetStatus)) {
        throw invalidDeliveryTransition(existing.status, targetStatus);
      }

      const timestampField = deliveryTimestampField(targetStatus);
      const changed = await tx.delivery.updateMany({
        where: { id: deliveryId, status: existing.status },
        data: { status: targetStatus, ...(timestampField ? { [timestampField]: new Date() } : {}) }
      });
      if (changed.count !== 1) {
        throw invalidDeliveryTransition(existing.status, targetStatus);
      }

      if (targetStatus === DeliveryStatus.DELIVERED) {
        const order = await tx.order.findUnique({ where: { id: existing.orderId } });
        if (order && order.status !== OrderStatus.DELIVERED) {
          await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.DELIVERED } });
          await tx.orderStatusHistory.create({
            data: {
              orderId: order.id,
              fromStatus: order.status,
              toStatus: OrderStatus.DELIVERED,
              changedByUserId: driverUserId
            }
          });
        }
      }

      return tx.delivery.findUnique({ where: { id: deliveryId }, include: deliveryInclude });
    });

    return toDeliveryView(updated!);
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

function deliveryTimestampField(status: DeliveryStatus): "pickedUpAt" | "onTheWayAt" | "deliveredAt" | null {
  switch (status) {
    case DeliveryStatus.PICKED_UP:
      return "pickedUpAt";
    case DeliveryStatus.ON_THE_WAY:
      return "onTheWayAt";
    case DeliveryStatus.DELIVERED:
      return "deliveredAt";
    default:
      return null;
  }
}

function toProfileView(profile: DriverProfile): DriverProfileView {
  return {
    userId: profile.userId,
    isOnline: profile.isOnline,
    lastLatitude: profile.lastLatitude,
    lastLongitude: profile.lastLongitude
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
