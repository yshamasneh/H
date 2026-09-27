import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { appInsightsExceptionEnvelope, parseAppInsightsConnectionString, type AppInsightsTarget, type ReportedError } from "./app-insights";
import { redactText } from "./structured-logger";

export type ErrorContext = {
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
};


/**
 * Sends every 5xx to whichever error-tracking destinations are configured: a vendor-neutral
 * webhook (ERROR_TRACKING_WEBHOOK_URL + token) and/or Azure Application Insights
 * (APPLICATIONINSIGHTS_CONNECTION_STRING). Delivery is fire-and-forget: a tracking outage must
 * never turn into a slower or failed API response, so a failed delivery is only logged.
 */
@Injectable()
export class ErrorReporterService {
  private readonly logger = new Logger(ErrorReporterService.name);

  constructor(private readonly config: ConfigService) {}

  capture(exception: unknown, context: ErrorContext): void {
    const error = toReportedError(exception);
    const url = this.config.get<string>("ERROR_TRACKING_WEBHOOK_URL");
    const token = this.config.get<string>("ERROR_TRACKING_TOKEN");
    if (url && token) {
      void this.dispatchWebhook(url, token, error, context).catch(() => {
        this.logger.warn({ event: "error_tracking_delivery_failed", sink: "webhook", requestId: context.requestId });
      });
    }
    const appInsights = parseAppInsightsConnectionString(this.config.get<string>("APPLICATIONINSIGHTS_CONNECTION_STRING"));
    if (appInsights) {
      void this.dispatchAppInsights(appInsights, error, context).catch(() => {
        this.logger.warn({ event: "error_tracking_delivery_failed", sink: "app_insights", requestId: context.requestId });
      });
    }
  }

  private async dispatchWebhook(url: string, token: string, error: ReportedError, context: ErrorContext): Promise<void> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        service: "tasawaq-api",
        environment: this.environment,
        release: this.release,
        error,
        context
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new Error("Error tracking endpoint rejected the event");
  }

  private async dispatchAppInsights(
    target: AppInsightsTarget,
    error: ReportedError,
    context: ErrorContext
  ): Promise<void> {
    const response = await fetch(`${target.ingestionEndpoint}v2/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([appInsightsExceptionEnvelope(target.instrumentationKey, error, context, {
        environment: this.environment,
        release: this.release
      })]),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new Error("Application Insights rejected the event");
  }

  private get environment(): string {
    return this.config.get<string>("NODE_ENV", "development");
  }

  private get release(): string {
    return this.config.get<string>("APP_VERSION", "development");
  }

  private get timeoutMs(): number {
    return this.config.get<number>("ERROR_TRACKING_TIMEOUT_MS", 3_000);
  }
}

function toReportedError(exception: unknown): ReportedError {
  const error = exception instanceof Error ? exception : new Error(String(exception));
  return {
    name: error.name,
    message: redactText(error.message),
    stack: error.stack ? redactText(error.stack) : undefined
  };
}
