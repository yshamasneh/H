import { Injectable } from "@nestjs/common";
import { RoleScope, UserRole } from "../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";
import { systemRoleKeys, type Permission } from "./permissions";

/** One business the actor belongs to, with the permissions their role grants inside it. */
export type BusinessGrant = {
  businessId: string;
  roleKey: string;
  permissions: ReadonlySet<Permission>;
};

export type AuthorizationContext = {
  userId: string;
  /** True for SUPER_ADMIN, which holds every permission implicitly. */
  isSuperAdmin: boolean;
  platformPermissions: ReadonlySet<Permission>;
  businessGrants: BusinessGrant[];
};

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(userId: string, role: UserRole): Promise<AuthorizationContext> {
    const [user, memberships] = await Promise.all([
      role === UserRole.ADMIN
        ? this.prisma.user.findUnique({ where: { id: userId }, include: { platformRole: true } })
        : Promise.resolve(null),
      role === UserRole.RESTAURANT
        ? this.prisma.businessMember.findMany({
            where: { userId, isActive: true },
            include: { role: true }
          })
        : Promise.resolve([])
    ]);

    const platformRole = user?.platformRole ?? null;
    return {
      userId,
      isSuperAdmin: platformRole?.key === systemRoleKeys.superAdmin,
      platformPermissions: toPermissionSet(
        platformRole && platformRole.scope === RoleScope.PLATFORM ? platformRole.permissions : []
      ),
      businessGrants: memberships.map((membership) => ({
        businessId: membership.businessId,
        roleKey: membership.role.key,
        permissions: toPermissionSet(membership.role.permissions)
      }))
    };
  }

  /**
   * Whether the actor holds a permission. When `businessId` is given the permission must come from
   * that specific business's membership — a grant in business A never satisfies a request against
   * business B. When it is omitted, only platform-scoped permissions are considered.
   */
  static hasPermission(
    context: AuthorizationContext,
    permission: Permission,
    businessId?: string
  ): boolean {
    if (context.isSuperAdmin) return true;
    if (businessId === undefined) return context.platformPermissions.has(permission);
    return (
      context.businessGrants
        .find((grant) => grant.businessId === businessId)
        ?.permissions.has(permission) ?? false
    );
  }

  /**
   * The single business an actor belongs to.
   *
   * `Restaurant.ownerUserId` is still unique, so a business account belongs to exactly one
   * business and this is unambiguous. It returns null once a user belongs to several, which forces
   * such routes to name their business explicitly rather than silently picking one.
   */
  static soleBusinessId(context: AuthorizationContext): string | null {
    return context.businessGrants.length === 1 ? context.businessGrants[0].businessId : null;
  }
}

function toPermissionSet(permissions: readonly string[]): ReadonlySet<Permission> {
  return new Set(permissions as readonly Permission[]);
}
