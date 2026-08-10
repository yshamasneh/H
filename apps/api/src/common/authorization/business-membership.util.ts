import type { Prisma } from "../../generated/prisma/client";
import { ApiException } from "../api.exception";
import { systemRoleKeys, type SystemRoleKey } from "./permissions";

/**
 * Grants a user a role inside a business.
 *
 * Every path that creates a business has to call this, or the business is created with no members
 * and its own owner cannot open the portal. Failing loudly when the system roles are absent is
 * deliberate: a business that exists but is unreachable is far worse than a refused registration.
 */
export async function grantBusinessMembership(
  tx: Prisma.TransactionClient,
  input: {
    businessId: string;
    userId: string;
    roleKey?: SystemRoleKey;
    invitedByUserId?: string | null;
  }
): Promise<void> {
  const roleKey = input.roleKey ?? systemRoleKeys.businessAdmin;
  const role = await tx.role.findUnique({ where: { key: roleKey } });
  if (!role) {
    throw new ApiException(
      500,
      "SYSTEM_ROLE_MISSING",
      "The platform's roles are not initialised. Run database migrations before creating businesses.",
      { roleKey }
    );
  }

  await tx.businessMember.upsert({
    where: { businessId_userId: { businessId: input.businessId, userId: input.userId } },
    create: {
      businessId: input.businessId,
      userId: input.userId,
      roleId: role.id,
      isActive: true,
      invitedByUserId: input.invitedByUserId ?? null
    },
    update: { roleId: role.id, isActive: true }
  });
}
