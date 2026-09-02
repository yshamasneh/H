import { Injectable } from "@nestjs/common";
import { writeAuditLog } from "../common/audit-log.util";
import type { PlatformSetting } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { UpdatePlatformSettingsDto } from "./settings.dto";
import type { PlatformSettingsView, PublicPlatformSettingsView } from "./settings.types";

// The settings table holds exactly one row. A fixed id keeps reads and writes
// pointed at that row without a "which one" lookup, and makes the create-if-missing
// fallback below idempotent.
const SINGLETON_ID = "singleton";

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The full settings row, creating it with defaults if it has never been written. */
  async get(): Promise<PlatformSettingsView> {
    return toView(await this.load());
  }

  /** The narrow view any authenticated app user may read. */
  async getPublic(): Promise<PublicPlatformSettingsView> {
    const setting = await this.load();
    return { substitutionOptionEnabled: setting.substitutionOptionEnabled };
  }

  async update(adminUserId: string, input: UpdatePlatformSettingsDto): Promise<PlatformSettingsView> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const setting = await tx.platformSetting.upsert({
        where: { id: SINGLETON_ID },
        create: { id: SINGLETON_ID, substitutionOptionEnabled: input.substitutionOptionEnabled },
        update: { substitutionOptionEnabled: input.substitutionOptionEnabled }
      });
      await writeAuditLog(tx, {
        actorUserId: adminUserId,
        action: "PLATFORM_SETTINGS_UPDATED",
        entityType: "PlatformSetting",
        entityId: setting.id,
        metadata: { substitutionOptionEnabled: setting.substitutionOptionEnabled }
      });
      return setting;
    });
    return toView(updated);
  }

  // The migration seeds the singleton row, but a create-if-missing keeps reads working
  // against any database where that row was never written (e.g. a hand-built fixture).
  private async load(): Promise<PlatformSetting> {
    const existing = await this.prisma.platformSetting.findUnique({ where: { id: SINGLETON_ID } });
    if (existing) return existing;
    return this.prisma.platformSetting.create({ data: { id: SINGLETON_ID } });
  }
}

function toView(setting: PlatformSetting): PlatformSettingsView {
  return {
    substitutionOptionEnabled: setting.substitutionOptionEnabled,
    updatedAt: setting.updatedAt
  };
}
