import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { RoleScope } from "../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";
import { allPermissions, systemRoleKeys, systemRolePermissions } from "./permissions";

/**
 * Keeps the seeded system roles in step with the permission catalogue in code.
 *
 * Deliberately conservative about what it overwrites:
 * - missing system roles are created, so a fresh database always has them;
 * - SUPER_ADMIN's stored permission list is kept complete, because it is informational only
 *   (authorization treats SUPER_ADMIN as holding everything implicitly) and a stale list would be
 *   misleading in a roles screen;
 * - the business roles' permissions are never rewritten. Granting a role a new capability is a
 *   deliberate decision, not something a deploy should do silently — and it keeps a future roles
 *   editor from having its changes reverted on the next restart.
 */
@Injectable()
export class SystemRolesService implements OnModuleInit {
  private readonly logger = new Logger(SystemRolesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.reconcile();
    } catch (error) {
      // Never block startup on reference-data upkeep; the migration already seeded these roles.
      this.logger.warn(`Could not reconcile system roles: ${(error as Error).message}`);
    }
  }

  async reconcile(): Promise<void> {
    await this.prisma.role.upsert({
      where: { key: systemRoleKeys.superAdmin },
      create: {
        key: systemRoleKeys.superAdmin,
        name: "Super Admin",
        scope: RoleScope.PLATFORM,
        permissions: [...allPermissions],
        isSystem: true
      },
      update: { permissions: [...allPermissions], isSystem: true }
    });

    for (const [key, permissions] of Object.entries(systemRolePermissions)) {
      await this.prisma.role.upsert({
        where: { key },
        create: {
          key,
          name: key === systemRoleKeys.businessAdmin ? "Business Admin" : "Business Account",
          scope: RoleScope.BUSINESS,
          permissions: [...permissions],
          isSystem: true
        },
        update: {}
      });
    }
  }
}
