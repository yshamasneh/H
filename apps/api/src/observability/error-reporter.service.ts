import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { redactText } from "./structured-logger";

export type ErrorContext = {
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
};

@Injectable()
export class ErrorReporterService {
  private readonly logger = new Logger(ErrorReporterService.name);

  constructor(private readonly config: ConfigService) {}

  capture(exception: unknown, context: ErrorContext): void {
    const url = this.config.get<string>("ERROR_TRACKING_WEBHOOK_URL");
    const token = this.config.get<string>("ERROR_TRACKING_TOKEN");
    if (!url || !token) return;
    void this.dispatch(url, token, exception, context).catch(() => {
      this.logger.warn({ event: "error_tracking_delivery_failed", requestId: context.requestId });
    });
  }

  private async dispatch(url: string, token: string, exception: unknown, context: ErrorContext): Promise<void> {
    const error = exception instanceof Error ? exception : new Error(String(exception));
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        service: "tasawaq-api",
        environment: this.config.get<string>("NODE_ENV", "development"),
        release: this.config.get<string>("APP_VERSION", "development"),
        error: {
          name: error.name,
          message: redactText(error.message),
          stack: error.stack ? redactText(error.stack) : undefined
        },
        context
      }),
      signal: AbortSignal.timeout(this.config.get<number>("ERROR_TRACKING_TIMEOUT_MS", 3_000))
    });
    if (!response.ok) throw new Error("Error tracking endpoint rejected the event");
  }
}
