import type { ErrorContext } from "./error-reporter.service";

/** Azure Application Insights, spoken directly over its ingestion API: no SDK, no auto-instrumentation. */

export type ReportedError = { name: string; message: string; stack?: string };

export type AppInsightsTarget = { instrumentationKey: string; ingestionEndpoint: string };

/** Reads the two parts the ingestion API needs; anything malformed means "not configured". */
export function parseAppInsightsConnectionString(value: string | undefined | null): AppInsightsTarget | null {
  if (!value) return null;
  const parts = new Map(
    value
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        return [part.slice(0, separator).toLowerCase(), part.slice(separator + 1)] as const;
      })
  );
  const instrumentationKey = parts.get("instrumentationkey");
  const endpoint = parts.get("ingestionendpoint");
  if (!instrumentationKey || !endpoint) return null;
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "https:") return null;
    return { instrumentationKey, ingestionEndpoint: parsed.toString().endsWith("/") ? parsed.toString() : `${parsed.toString()}/` };
  } catch {
    return null;
  }
}

/** One Application Insights "exception" telemetry item (the ingestion API's envelope schema). */
export function appInsightsExceptionEnvelope(
  instrumentationKey: string,
  error: ReportedError,
  context: ErrorContext,
  meta: { environment: string; release: string }
) {
  return {
    name: "Microsoft.ApplicationInsights.Exception",
    time: new Date().toISOString(),
    iKey: instrumentationKey,
    tags: {
      "ai.cloud.role": "jovo-api",
      "ai.application.ver": meta.release,
      "ai.operation.id": context.requestId,
      "ai.operation.name": `${context.method} ${context.path}`
    },
    data: {
      baseType: "ExceptionData",
      baseData: {
        ver: 2,
        severityLevel: 3,
        exceptions: [{
          typeName: error.name,
          message: error.message,
          hasFullStack: Boolean(error.stack),
          stack: error.stack
        }],
        properties: {
          environment: meta.environment,
          requestId: context.requestId,
          method: context.method,
          path: context.path,
          statusCode: String(context.statusCode)
        }
      }
    }
  };
}
