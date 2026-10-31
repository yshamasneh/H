import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "./users.service";

const sweepBatchSize = 20;

/**
 * Completes scheduled account deletions (store audit H1). A request is processed on or after its
 * scheduled date; if the driver still has an active delivery, cash to hand over or an unsettled
 * earnings balance, it stays pending and is retried on the next sweep, and the outstanding blockers
 * are logged for the operations team. Nothing financial is ever written here.
 */
@Injectable()
export class AccountDeletionSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountDeletionSweepService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly config: ConfigService
  ) {}

  onModuleInit(): void {
    // Accepts a real boolean or the env string; only an explicit false switches the sweep off.
    if (String(this.config.get("ACCOUNT_DELETION_WORKER_ENABLED", "true")).toLowerCase() === "false") return;
    const intervalMs = Number(this.config.get("ACCOUNT_DELETION_SWEEP_INTERVAL_MS", 60 * 60 * 1000));
    this.timer = setInterval(() => void this.runScheduled(), Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 3_600_000);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** Exposed for deterministic tests and for the interval callback. Returns how many completed. */
  async processDue(now = new Date()): Promise<number> {
    const due = await this.prisma.accountDeletionRequest.findMany({
      where: { status: "PENDING", scheduledFor: { lte: now } },
      orderBy: { scheduledFor: "asc" },
      take: sweepBatchSize,
      select: { userId: true }
    });
    let completed = 0;
    for (const { userId } of due) {
      if (this.stopping) break;
      try {
        const blockers = await this.users.completeScheduledDeletion(userId, now);
        if (blockers.length === 0) completed += 1;
        else this.logger.warn(`Scheduled deletion for user ${userId} is still blocked: ${blockers.join(", ")}`);
      } catch (error) {
        // A serialization conflict or transient failure leaves the request pending for the next sweep.
        this.logger.warn(`Scheduled deletion for user ${userId} will be retried: ${(error as Error).message}`);
      }
    }
    return completed;
  }

  private async runScheduled(): Promise<void> {
    if (this.running) return;
    this.running = this.processDue()
      .then(() => undefined)
      .catch((error) => this.logger.error(`Account deletion sweep failed: ${(error as Error).message}`))
      .finally(() => {
        this.running = undefined;
      });
    await this.running;
  }
}
