import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NotificationType, UserRole } from "../generated/prisma/client";
import { offerActive } from "../notifications/notification-copy";
import { broadcastNotification } from "../notifications/notification.util";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

const activationBatchSize = 20;

/**
 * Announces an offer to every customer the first time it is observed inside its active window.
 * Polling (rather than hooking adminCreate/adminUpdate directly) is what makes this correct for a
 * scheduled offer, not just an offer switched on right now: nothing else calls this when a
 * `startsAt` in the future simply arrives. `Offer.activationNotifiedAt` makes each offer eligible
 * exactly once regardless of how it got here, and the claim-then-act update mirrors the same
 * compare-and-set idiom PushSenderService uses so two API instances polling at once cannot both
 * broadcast the same offer.
 */
@Injectable()
export class OfferActivationNotifierService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OfferActivationNotifierService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly realtime: RealtimeGateway
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>("OFFER_ACTIVATION_WORKER_ENABLED", true)) return;
    const intervalMs = this.config.get<number>("OFFER_ACTIVATION_POLL_INTERVAL_MS", 30_000);
    this.timer = setInterval(() => void this.runScheduled(), intervalMs);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** Exposed for deterministic tests and for the interval callback. */
  async processOnce(): Promise<void> {
    if (this.stopping) return;
    const now = new Date();
    const candidates = await this.prisma.offer.findMany({
      where: {
        isActive: true,
        activationNotifiedAt: null,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }]
      },
      orderBy: { startsAt: "asc" },
      take: activationBatchSize
    });

    for (const offer of candidates) {
      if (this.stopping) return;
      const claim = await this.prisma.offer.updateMany({
        where: { id: offer.id, activationNotifiedAt: null },
        data: { activationNotifiedAt: now }
      });
      if (claim.count !== 1) continue; // another instance already claimed this offer

      const customers = await this.prisma.user.findMany({
        where: { role: UserRole.CUSTOMER, isActive: true },
        select: { id: true }
      });
      if (customers.length === 0) continue;

      const copy = offerActive(offer.title);
      const notified = await broadcastNotification(this.prisma, this.realtime, {
        userIds: customers.map((customer) => customer.id),
        type: NotificationType.OFFER_ACTIVE,
        title: copy.title,
        body: copy.body,
        relatedEntityId: offer.id
      });
      this.logger.log(JSON.stringify({ event: "offer_activation_notified", offerId: offer.id, recipients: notified }));
    }
  }

  private async runScheduled(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = this.processOnce().catch((error: unknown) => {
      this.logger.warn(JSON.stringify({
        event: "offer_activation_worker_failed",
        message: error instanceof Error ? error.message : "unknown"
      }));
    }).finally(() => {
      this.running = undefined;
    });
    await this.running;
  }
}
