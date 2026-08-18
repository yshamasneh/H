import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { partnerKeys } from "./accounting.rules";

/**
 * The fixed parties in the revenue model exist as rows, not as names in code.
 *
 * "Abdullah's third of the delivery remainder" is a share belonging to *delivery operations*, and
 * whoever holds that role. Seeding the accounts here means the split never has to name a person,
 * and a partner can be renamed, or linked to a login, without touching any arithmetic.
 *
 * Deliberately conservative, like SystemRolesService: missing accounts are created, and an
 * existing one is never rewritten. A name edited in an admin screen must survive the next deploy.
 */
@Injectable()
export class PartnerAccountsService implements OnModuleInit {
  private readonly logger = new Logger(PartnerAccountsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.reconcile();
    } catch (error) {
      // Reference data upkeep must never stop the API from starting.
      this.logger.warn(`Could not reconcile partner accounts: ${(error as Error).message}`);
    }
  }

  async reconcile(): Promise<void> {
    const seeds = [
      { key: partnerKeys.ownerA, name: "Mohammad (platform owner)", kind: "PLATFORM_OWNER" as const },
      { key: partnerKeys.ownerB, name: "Khaldoun (platform owner)", kind: "PLATFORM_OWNER" as const },
      { key: partnerKeys.deliveryOps, name: "Abdullah (delivery operations)", kind: "DELIVERY_OPS" as const }
    ];

    for (const seed of seeds) {
      await this.prisma.partnerAccount.upsert({
        where: { key: seed.key },
        create: seed,
        // Nothing to update: an existing account is left exactly as the business set it up.
        update: {}
      });
    }
  }
}
