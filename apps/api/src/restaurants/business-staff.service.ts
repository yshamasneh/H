import { Injectable } from "@nestjs/common";
import { hashPassword } from "../auth/crypto.util";
import { normalizePhoneNumber } from "../auth/phone.util";
import { writeAuditLog } from "../common/audit-log.util";
import { grantBusinessMembership } from "../common/authorization/business-membership.util";
import { resolveMemberBusinessId } from "../common/authorization/business-scope.util";
import { systemRoleKeys, type SystemRoleKey } from "../common/authorization/permissions";
import { ApiException } from "../common/api.exception";
import { Prisma, RoleScope, UserRole } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { AddBusinessStaffDto, UpdateBusinessStaffDto } from "./business-staff.dto";
import type { BusinessStaffView } from "./restaurants.types";

@Injectable()
export class BusinessStaffService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actorUserId: string): Promise<BusinessStaffView[]> {
    const businessId = await resolveMemberBusinessId(this.prisma, actorUserId);
    const members = await this.prisma.businessMember.findMany({
      where: { businessId },
      include: { user: true, role: true },
      orderBy: { createdAt: "asc" }
    });
    const business = await this.prisma.restaurant.findUnique({
      where: { id: businessId },
      select: { ownerUserId: true }
    });
    return members.map((member) => ({
      userId: member.userId,
      fullName: member.user.fullName,
      phone: member.user.phone,
      roleKey: member.role.key,
      isActive: member.isActive && member.user.isActive,
      isOwner: member.userId === business?.ownerUserId,
      createdAt: member.createdAt
    }));
  }

  /**
   * Creates a staff account for the caller's business.
   *
   * There is no email or SMS infrastructure on this platform, so onboarding mirrors how business
   * and driver accounts are already created: the business admin sets an initial password and passes
   * it on. The new user is phone-verified immediately for the same reason.
   */
  async add(actorUserId: string, input: AddBusinessStaffDto): Promise<BusinessStaffView> {
    const businessId = await resolveMemberBusinessId(this.prisma, actorUserId);
    const roleKey = await this.requireAssignableRole(input.roleKey);
    const phone = normalizePhoneNumber(input.countryCode, input.phoneNumber);
    const fullName = input.fullName.trim().replace(/\s+/g, " ");
    if (fullName.length < 2) {
      throw new ApiException(400, "INVALID_FULL_NAME", "Please enter the staff member's full name.");
    }
    if (input.password !== input.confirmPassword) {
      throw new ApiException(400, "PASSWORDS_DO_NOT_MATCH", "The passwords do not match.");
    }

    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing) {
      throw new ApiException(
        409,
        "PHONE_ALREADY_REGISTERED",
        "An account already exists with this phone number."
      );
    }
    const passwordHash = await hashPassword(input.password);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const rechecked = await tx.user.findUnique({ where: { phone } });
        if (rechecked) {
          throw new ApiException(
            409,
            "PHONE_ALREADY_REGISTERED",
            "An account already exists with this phone number."
          );
        }
        const user = await tx.user.create({
          data: {
            fullName,
            phone,
            passwordHash,
            role: UserRole.RESTAURANT,
            phoneVerifiedAt: new Date(),
            isActive: true
          }
        });
        await grantBusinessMembership(tx, {
          businessId,
          userId: user.id,
          roleKey,
          invitedByUserId: actorUserId
        });
        await writeAuditLog(tx, {
          actorUserId,
          action: "BUSINESS_STAFF_ADDED",
          entityType: "BusinessMember",
          entityId: user.id,
          businessId,
          metadata: { roleKey, phone }
        });
        return user;
      });
      return {
        userId: created.id,
        fullName: created.fullName,
        phone: created.phone,
        roleKey,
        isActive: true,
        isOwner: false,
        createdAt: created.createdAt
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ApiException(
          409,
          "PHONE_ALREADY_REGISTERED",
          "An account already exists with this phone number."
        );
      }
      throw error;
    }
  }

  async update(actorUserId: string, staffUserId: string, input: UpdateBusinessStaffDto): Promise<BusinessStaffView> {
    const businessId = await resolveMemberBusinessId(this.prisma, actorUserId);
    const membership = await this.requireMembership(businessId, staffUserId);
    await this.assertNotOwner(businessId, staffUserId, "The business owner's own access cannot be changed here.");
    if (staffUserId === actorUserId) {
      throw new ApiException(
        409,
        "BUSINESS_STAFF_SELF_CHANGE",
        "You cannot change your own access. Ask another administrator of this business."
      );
    }

    const roleKey = input.roleKey ? await this.requireAssignableRole(input.roleKey) : undefined;
    const updated = await this.prisma.$transaction(async (tx) => {
      const role = roleKey ? await tx.role.findUnique({ where: { key: roleKey } }) : null;
      const next = await tx.businessMember.update({
        where: { id: membership.id },
        data: {
          ...(role ? { roleId: role.id } : {}),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive })
        },
        include: { user: true, role: true }
      });
      await writeAuditLog(tx, {
        actorUserId,
        action: input.isActive === false ? "BUSINESS_STAFF_DEACTIVATED" : "BUSINESS_STAFF_UPDATED",
        entityType: "BusinessMember",
        entityId: staffUserId,
        businessId,
        metadata: {
          fromRoleKey: membership.role.key,
          toRoleKey: next.role.key,
          fromIsActive: membership.isActive,
          toIsActive: next.isActive
        }
      });
      return next;
    });

    return {
      userId: updated.userId,
      fullName: updated.user.fullName,
      phone: updated.user.phone,
      roleKey: updated.role.key,
      isActive: updated.isActive && updated.user.isActive,
      isOwner: false,
      createdAt: updated.createdAt
    };
  }

  /**
   * Removing a staff member deactivates their membership rather than deleting it, so audit entries
   * and any orders they accepted keep pointing at a resolvable person.
   */
  async remove(actorUserId: string, staffUserId: string): Promise<{ message: string }> {
    await this.update(actorUserId, staffUserId, { isActive: false });
    return { message: "This staff member no longer has access to your business." };
  }

  private async requireMembership(businessId: string, userId: string) {
    const membership = await this.prisma.businessMember.findUnique({
      where: { businessId_userId: { businessId, userId } },
      include: { role: true }
    });
    if (!membership) {
      throw new ApiException(404, "BUSINESS_STAFF_NOT_FOUND", "This person is not a member of your business.");
    }
    return membership;
  }

  private async assertNotOwner(businessId: string, userId: string, message: string): Promise<void> {
    const business = await this.prisma.restaurant.findUnique({
      where: { id: businessId },
      select: { ownerUserId: true }
    });
    if (business?.ownerUserId === userId) {
      throw new ApiException(409, "BUSINESS_OWNER_IMMUTABLE", message);
    }
  }

  /** Only business-scoped roles can be handed out from inside a business. */
  private async requireAssignableRole(roleKey: string): Promise<SystemRoleKey> {
    if (roleKey === systemRoleKeys.superAdmin) {
      throw new ApiException(403, "ROLE_NOT_ASSIGNABLE", "This role cannot be assigned to business staff.");
    }
    const role = await this.prisma.role.findUnique({ where: { key: roleKey } });
    if (!role || role.scope !== RoleScope.BUSINESS) {
      throw new ApiException(400, "ROLE_NOT_ASSIGNABLE", "Choose a role that applies inside a business.");
    }
    return role.key as SystemRoleKey;
  }
}
