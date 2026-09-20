import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, PushDeliveryStatus } from "../generated/prisma/client";
import { MetricsService } from "../observability/metrics.service";
import { pushPresentation } from "../notifications/push-presentation";
import { PrismaService } from "../prisma/prisma.service";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const EXPO_BATCH_SIZE = 100;

type Delivery = Prisma.PushDeliveryGetPayload<{
  include: { notification: true; pushToken: true };
}>;

type ExpoResult = {
  status: "ok" | "error";
  id?: string;
  details?: { error?: string };
};

type ProviderResponse<T> =
  | { kind: "ok"; data: T }
  | { kind: "transient"; code: string }
  | { kind: "permanent"; code: string };

const activeSendStatuses = [PushDeliveryStatus.PENDING, PushDeliveryStatus.RETRYABLE_FAILED];
const unfinishedStatuses = [
  PushDeliveryStatus.PENDING,
  PushDeliveryStatus.PROCESSING,
  PushDeliveryStatus.AWAITING_RECEIPT,
  PushDeliveryStatus.RETRYABLE_FAILED
];

/**
 * PostgreSQL-backed Expo delivery worker. Domain code only inserts PushDelivery rows; this worker
 * claims them with compare-and-set updates, so multiple API instances can poll safely without an
 * external broker. Provider failures never run inside, or roll back, a domain transaction.
 */
@Injectable()
export class PushSenderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PushSenderService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional() private readonly metrics?: MetricsService
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>("PUSH_WORKER_ENABLED", true)) return;
    const intervalMs = this.config.get<number>("PUSH_WORKER_POLL_INTERVAL_MS", 5_000);
    this.timer = setInterval(() => void this.runScheduled(), intervalMs);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** Exposed for deterministic tests and for the interval callback; never calls real Expo in tests. */
  async processOnce(): Promise<void> {
    if (this.stopping) return;
    await this.recoverStaleProcessing();

    const maxBatches = this.config.get<number>("PUSH_WORKER_MAX_BATCHES_PER_RUN", 10);
    for (let batchNumber = 0; batchNumber < maxBatches && !this.stopping; batchNumber += 1) {
      const deliveries = await this.claimSendBatch();
      if (deliveries.length === 0) break;
      await this.sendBatch(deliveries);
    }

    for (let batchNumber = 0; batchNumber < maxBatches && !this.stopping; batchNumber += 1) {
      const deliveries = await this.claimReceiptBatch();
      if (deliveries.length === 0) break;
      await this.pollReceipts(deliveries);
    }

    const pending = await this.prisma.pushDelivery.count({
      where: { status: { in: unfinishedStatuses } }
    });
    this.metrics?.setPushDeliveriesPending(pending);
  }

  private async runScheduled(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = this.processOnce().catch((error: unknown) => {
      this.log("warn", "push_worker_run_failed", { code: errorCode(error) });
    }).finally(() => {
      this.running = undefined;
    });
    await this.running;
  }

  private async recoverStaleProcessing(): Promise<void> {
    const now = new Date();
    const maximumSendAttempts = this.config.get<number>("PUSH_MAX_ATTEMPTS", 6);
    const maximumReceiptAttempts = this.config.get<number>("PUSH_MAX_RECEIPT_ATTEMPTS", 10);
    const staleBefore = new Date(
      now.getTime() - this.config.get<number>("PUSH_PROCESSING_STALE_MS", 120_000)
    );
    const receiptRecovery = await this.prisma.pushDelivery.updateMany({
      where: {
        status: PushDeliveryStatus.PROCESSING,
        processingStartedAt: { lte: staleBefore },
        expoTicketId: { not: null },
        receiptAttemptCount: { lt: maximumReceiptAttempts }
      },
      data: {
        status: PushDeliveryStatus.AWAITING_RECEIPT,
        processingStartedAt: null,
        nextAttemptAt: now,
        lastErrorCode: "STALE_RECEIPT_PROCESSING"
      }
    });
    const sendRecovery = await this.prisma.pushDelivery.updateMany({
      where: {
        status: PushDeliveryStatus.PROCESSING,
        processingStartedAt: { lte: staleBefore },
        expoTicketId: null,
        attemptCount: { lt: maximumSendAttempts }
      },
      data: {
        status: PushDeliveryStatus.RETRYABLE_FAILED,
        processingStartedAt: null,
        nextAttemptAt: now,
        lastErrorCode: "STALE_SEND_PROCESSING"
      }
    });
    const recovered = receiptRecovery.count + sendRecovery.count;
    if (recovered > 0) {
      this.metrics?.incrementPushDeliveries("retried", recovered);
      this.log("warn", "push_stale_processing_recovered", { count: recovered });
    }
    const exhaustedReceipts = await this.prisma.pushDelivery.updateMany({
      where: {
        status: PushDeliveryStatus.PROCESSING,
        processingStartedAt: { lte: staleBefore },
        expoTicketId: { not: null },
        receiptAttemptCount: { gte: maximumReceiptAttempts }
      },
      data: {
        status: PushDeliveryStatus.PERMANENT_FAILED,
        processingStartedAt: null,
        lastErrorCode: "MAX_RECEIPT_ATTEMPTS_AFTER_CRASH"
      }
    });
    const exhaustedSends = await this.prisma.pushDelivery.updateMany({
      where: {
        status: PushDeliveryStatus.PROCESSING,
        processingStartedAt: { lte: staleBefore },
        expoTicketId: null,
        attemptCount: { gte: maximumSendAttempts }
      },
      data: {
        status: PushDeliveryStatus.PERMANENT_FAILED,
        processingStartedAt: null,
        lastErrorCode: "MAX_SEND_ATTEMPTS_AFTER_CRASH"
      }
    });
    const exhausted = exhaustedReceipts.count + exhaustedSends.count;
    if (exhausted > 0) this.metrics?.incrementPushDeliveries("permanently_failed", exhausted);
  }

  private async claimSendBatch(): Promise<Delivery[]> {
    const now = new Date();
    const maximumAttempts = this.config.get<number>("PUSH_MAX_ATTEMPTS", 6);
    const candidates = await this.prisma.pushDelivery.findMany({
      where: {
        status: { in: activeSendStatuses },
        nextAttemptAt: { lte: now },
        attemptCount: { lt: maximumAttempts }
      },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      take: EXPO_BATCH_SIZE,
      include: { notification: true, pushToken: true }
    });
    return this.claimCandidates(candidates, false, now);
  }

  private async claimReceiptBatch(): Promise<Delivery[]> {
    const now = new Date();
    const maximumAttempts = this.config.get<number>("PUSH_MAX_RECEIPT_ATTEMPTS", 10);
    const candidates = await this.prisma.pushDelivery.findMany({
      where: {
        status: PushDeliveryStatus.AWAITING_RECEIPT,
        nextAttemptAt: { lte: now },
        receiptAttemptCount: { lt: maximumAttempts },
        expoTicketId: { not: null }
      },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      take: EXPO_BATCH_SIZE,
      include: { notification: true, pushToken: true }
    });
    return this.claimCandidates(candidates, true, now);
  }

  private async claimCandidates(candidates: Delivery[], receipt: boolean, now: Date): Promise<Delivery[]> {
    const claimed: Delivery[] = [];
    for (const candidate of candidates) {
      const result = await this.prisma.pushDelivery.updateMany({
        where: { id: candidate.id, status: candidate.status, nextAttemptAt: { lte: now } },
        data: {
          status: PushDeliveryStatus.PROCESSING,
          processingStartedAt: now,
          ...(receipt
            ? { receiptAttemptCount: { increment: 1 } }
            : { attemptCount: { increment: 1 } })
        }
      });
      if (result.count === 1) {
        claimed.push({
          ...candidate,
          status: PushDeliveryStatus.PROCESSING,
          processingStartedAt: now,
          attemptCount: candidate.attemptCount + (receipt ? 0 : 1),
          receiptAttemptCount: candidate.receiptAttemptCount + (receipt ? 1 : 0)
        });
      }
    }
    return claimed;
  }

  private async sendBatch(deliveries: Delivery[]): Promise<void> {
    const eligible: Delivery[] = [];
    for (const delivery of deliveries) {
      if (!delivery.pushToken.isActive || delivery.pushToken.userId !== delivery.notification.userId) {
        await this.markPermanent(delivery, "TOKEN_NOT_ACTIVE_FOR_RECIPIENT");
      } else if (!isExpoPushToken(delivery.pushToken.token)) {
        await this.deactivateToken(delivery.pushTokenId);
        await this.markPermanent(delivery, "MALFORMED_PUSH_TOKEN", true);
      } else {
        eligible.push(delivery);
      }
    }
    if (eligible.length === 0) return;

    const response = await this.request<{ data?: ExpoResult[] }>(EXPO_PUSH_URL, eligible.map((delivery) => ({
      to: delivery.pushToken.token,
      title: delivery.notification.title,
      body: delivery.notification.body,
      data: {
        type: delivery.notification.type,
        relatedEntityId: delivery.notification.relatedEntityId ?? undefined
      },
      ...pushPresentation(delivery.notification.type, delivery.pushToken.platform),
      priority: "high"
    })));

    if (response.kind !== "ok") {
      await Promise.all(eligible.map((delivery) =>
        response.kind === "transient"
          ? this.scheduleSendRetry(delivery, response.code)
          : this.markPermanent(delivery, response.code)
      ));
      return;
    }

    const tickets = response.data.data ?? [];
    await Promise.all(eligible.map(async (delivery, index) => {
      const ticket = tickets[index];
      if (!ticket) return this.scheduleSendRetry(delivery, "MISSING_EXPO_TICKET");
      if (ticket.status === "ok" && ticket.id) {
        await this.prisma.pushDelivery.update({
          where: { id: delivery.id },
          data: {
            status: PushDeliveryStatus.AWAITING_RECEIPT,
            expoTicketId: ticket.id,
            processingStartedAt: null,
            nextAttemptAt: new Date(Date.now() + this.config.get<number>("PUSH_RECEIPT_DELAY_MS", 60_000)),
            lastErrorCode: null
          }
        });
        return;
      }
      const code = sanitizeProviderCode(ticket.details?.error, "EXPO_TICKET_ERROR");
      if (code === "DeviceNotRegistered") {
        await this.deactivateToken(delivery.pushTokenId);
        return this.markPermanent(delivery, code, true);
      }
      if (isTransientExpoCode(code)) return this.scheduleSendRetry(delivery, code);
      return this.markPermanent(delivery, code);
    }));
  }

  private async pollReceipts(deliveries: Delivery[]): Promise<void> {
    const ids = deliveries.map((delivery) => delivery.expoTicketId).filter((id): id is string => Boolean(id));
    const response = await this.request<{ data?: Record<string, ExpoResult> }>(EXPO_RECEIPTS_URL, { ids });
    if (response.kind !== "ok") {
      await Promise.all(deliveries.map((delivery) =>
        response.kind === "transient"
          ? this.scheduleReceiptRetry(delivery, response.code)
          : this.markPermanent(delivery, response.code)
      ));
      return;
    }

    const receipts = response.data.data ?? {};
    await Promise.all(deliveries.map(async (delivery) => {
      const receipt = delivery.expoTicketId ? receipts[delivery.expoTicketId] : undefined;
      if (!receipt) return this.scheduleReceiptRetry(delivery, "RECEIPT_PENDING");
      if (receipt.status === "ok") {
        await this.prisma.pushDelivery.update({
          where: { id: delivery.id },
          data: {
            status: PushDeliveryStatus.DELIVERED,
            deliveredAt: new Date(),
            processingStartedAt: null,
            lastErrorCode: null
          }
        });
        this.metrics?.incrementPushDeliveries("delivered");
        return;
      }
      const code = sanitizeProviderCode(receipt.details?.error, "EXPO_RECEIPT_ERROR");
      if (code === "DeviceNotRegistered") {
        await this.deactivateToken(delivery.pushTokenId);
        return this.markPermanent(delivery, code, true);
      }
      if (isTransientExpoCode(code)) return this.scheduleReceiptRetry(delivery, code);
      return this.markPermanent(delivery, code);
    }));
  }

  private async scheduleSendRetry(delivery: Delivery, code: string): Promise<void> {
    const maximumAttempts = this.config.get<number>("PUSH_MAX_ATTEMPTS", 6);
    if (delivery.attemptCount >= maximumAttempts) {
      await this.markPermanent(delivery, "MAX_SEND_ATTEMPTS");
      return;
    }
    await this.prisma.pushDelivery.update({
      where: { id: delivery.id },
      data: {
        status: PushDeliveryStatus.RETRYABLE_FAILED,
        processingStartedAt: null,
        nextAttemptAt: this.nextBackoff(delivery.attemptCount),
        lastErrorCode: code
      }
    });
    this.metrics?.incrementPushDeliveries("retried");
    this.log("warn", "push_delivery_retry_scheduled", {
      deliveryId: delivery.id,
      attempt: delivery.attemptCount,
      code
    });
  }

  private async scheduleReceiptRetry(delivery: Delivery, code: string): Promise<void> {
    const maximumAttempts = this.config.get<number>("PUSH_MAX_RECEIPT_ATTEMPTS", 10);
    if (delivery.receiptAttemptCount >= maximumAttempts) {
      await this.markPermanent(delivery, "MAX_RECEIPT_ATTEMPTS");
      return;
    }
    await this.prisma.pushDelivery.update({
      where: { id: delivery.id },
      data: {
        status: PushDeliveryStatus.AWAITING_RECEIPT,
        processingStartedAt: null,
        nextAttemptAt: this.nextBackoff(delivery.receiptAttemptCount),
        lastErrorCode: code
      }
    });
    this.metrics?.incrementPushDeliveries("retried");
  }

  private nextBackoff(attempt: number): Date {
    const base = this.config.get<number>("PUSH_RETRY_BASE_MS", 5_000);
    const maximum = this.config.get<number>("PUSH_RETRY_MAX_MS", 15 * 60_000);
    const withoutJitter = Math.min(maximum, base * 2 ** Math.max(0, attempt - 1));
    const jitter = Math.floor(withoutJitter * 0.25 * Math.random());
    return new Date(Date.now() + withoutJitter + jitter);
  }

  private async markPermanent(delivery: Delivery, code: string, invalidToken = false): Promise<void> {
    await this.prisma.pushDelivery.update({
      where: { id: delivery.id },
      data: {
        status: PushDeliveryStatus.PERMANENT_FAILED,
        processingStartedAt: null,
        lastErrorCode: code
      }
    });
    this.metrics?.incrementPushDeliveries("permanently_failed");
    if (invalidToken) this.metrics?.incrementPushDeliveries("invalid_tokens");
    this.log("warn", "push_delivery_permanently_failed", { deliveryId: delivery.id, code });
  }

  private async deactivateToken(pushTokenId: string): Promise<void> {
    await this.prisma.pushToken.updateMany({
      where: { id: pushTokenId },
      data: { isActive: false }
    });
  }

  private async request<T>(url: string, body: unknown): Promise<ProviderResponse<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.get<number>("PUSH_PROVIDER_TIMEOUT_MS", 5_000)
    );
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) {
        const code = `EXPO_HTTP_${response.status}`;
        return response.status === 429 || response.status >= 500
          ? { kind: "transient", code }
          : { kind: "permanent", code };
      }
      try {
        return { kind: "ok", data: await response.json() as T };
      } catch {
        return { kind: "transient", code: "EXPO_INVALID_JSON" };
      }
    } catch (error) {
      return {
        kind: "transient",
        code: error instanceof Error && error.name === "AbortError" ? "EXPO_TIMEOUT" : "EXPO_NETWORK_ERROR"
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private log(level: "warn" | "log", event: string, details: Record<string, unknown>): void {
    this.logger[level](JSON.stringify({ event, ...details }));
  }
}

function isExpoPushToken(token: string): boolean {
  return /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9._~-]+\]$/.test(token);
}

function sanitizeProviderCode(code: string | undefined, fallback: string): string {
  return code && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(code) ? code : fallback;
}

function isTransientExpoCode(code: string): boolean {
  return code === "MessageRateExceeded" || code === "ServiceUnavailable" || code === "InternalServerError";
}

function errorCode(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  return "PUSH_WORKER_ERROR";
}
