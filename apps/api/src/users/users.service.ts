import { Injectable } from "@nestjs/common";
import { writeAuditLog } from "../common/audit-log.util";
import { ApiException } from "../common/api.exception";
import { UserRole } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateAddressDto, RegisterPushTokenDto, UpdateAddressDto, UpdateMyProfileDto } from "./users.dto";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
    await this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform: input.platform },
      update: { userId, platform: input.platform, isActive: true, lastRegisteredAt: new Date() }
    });
    return { registered: true };
  }

  async unregisterPushToken(userId: string, token: string): Promise<void> {
    await this.prisma.pushToken.updateMany({
      where: { userId, token: token.trim() },
      data: { isActive: false }
    });
  }

  async deleteMyAccount(userId: string): Promise<void> {
    const user = await this.requireUser(userId);
    if (user.role !== UserRole.CUSTOMER) {
      throw new ApiException(409, "ACCOUNT_DELETION_SUPPORT_REQUIRED", "Store, driver, and admin accounts must be closed by support so active operations can be reviewed.");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.address.deleteMany({ where: { userId } });
      await tx.pushToken.deleteMany({ where: { userId } });
      await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await writeAuditLog(tx, {
        actorUserId: userId,
        action: "CUSTOMER_ACCOUNT_DEACTIVATED",
        entityType: "User",
        entityId: userId,
        reason: "Requested by account owner"
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          fullName: "Deleted account",
          phone: `deleted-${userId}`,
          email: null,
          passwordHash: "DELETED",
          isActive: false,
          tokenVersion: { increment: 1 }
        }
      });
    });
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
