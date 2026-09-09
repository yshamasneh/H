import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export type PushMessage = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Expo's push API refuses a request with more than 100 messages in one call.
const EXPO_PUSH_BATCH_SIZE = 100;

type ExpoPushTicket = {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
};

/**
 * Sends device push notifications through Expo's push service. `PushToken` rows were collected
 * from day one (Phase 14) but nothing ever sent to them — this is that missing sender.
 *
 * Called from `createNotification` alongside the existing socket emit, so every in-app
 * notification also reaches a device that has the app closed. A dead or misbehaving token must
 * never break the notification write itself: every failure here is caught and logged, never
 * thrown, and this class is always invoked fire-and-forget after the writing transaction has
 * already committed (see `RealtimeGateway.sendPush` / `DeferredEmitter`).
 */
@Injectable()
export class PushSenderService {
  private readonly logger = new Logger(PushSenderService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sendToUser(userId: string, message: PushMessage): Promise<void> {
    try {
      const tokens = await this.prisma.pushToken.findMany({
        where: { userId, isActive: true },
        select: { id: true, token: true }
      });
      if (tokens.length === 0) return;

      for (let i = 0; i < tokens.length; i += EXPO_PUSH_BATCH_SIZE) {
        await this.sendBatch(tokens.slice(i, i + EXPO_PUSH_BATCH_SIZE), message);
      }
    } catch (error) {
      this.logger.warn(`Failed to send push notification to user ${userId}: ${(error as Error).message}`);
    }
  }

  private async sendBatch(batch: { id: string; token: string }[], message: PushMessage): Promise<void> {
    const body = batch.map((entry) => ({
      to: entry.token,
      title: message.title,
      body: message.body,
      data: message.data ?? {},
      sound: "default",
      priority: "high" as const
    }));

    let response: Response;
    try {
      response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body)
      });
    } catch (error) {
      this.logger.warn(`Expo push request failed: ${(error as Error).message}`);
      return;
    }

    if (!response.ok) {
      this.logger.warn(`Expo push send returned HTTP ${response.status}`);
      return;
    }

    let result: { data?: ExpoPushTicket[] };
    try {
      result = (await response.json()) as { data?: ExpoPushTicket[] };
    } catch (error) {
      this.logger.warn(`Expo push response was not valid JSON: ${(error as Error).message}`);
      return;
    }

    await this.deactivateUnregisteredTokens(batch, result.data ?? []);
  }

  /**
   * A ticket's `DeviceNotRegistered` error means the app was uninstalled or the token expired —
   * the one failure mode that should permanently stop future sends rather than just being logged.
   */
  private async deactivateUnregisteredTokens(
    batch: { id: string; token: string }[],
    tickets: ExpoPushTicket[]
  ): Promise<void> {
    const deadTokenIds: string[] = [];
    tickets.forEach((ticket, index) => {
      if (ticket.status !== "error") return;
      const entry = batch[index];
      this.logger.warn(
        `Expo push ticket error for token ${entry?.id ?? "unknown"}: ${ticket.message ?? ticket.details?.error ?? "unknown error"}`
      );
      if (entry && ticket.details?.error === "DeviceNotRegistered") {
        deadTokenIds.push(entry.id);
      }
    });

    if (deadTokenIds.length === 0) return;
    try {
      await this.prisma.pushToken.updateMany({
        where: { id: { in: deadTokenIds } },
        data: { isActive: false }
      });
    } catch (error) {
      this.logger.warn(`Failed to deactivate unregistered push tokens: ${(error as Error).message}`);
    }
  }
}
