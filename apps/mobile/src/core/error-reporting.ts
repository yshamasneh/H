/**
 * Store audit M2: vendor-neutral crash and error reporting for the app.
 *
 * A no-op unless EXPO_PUBLIC_ERROR_REPORT_URL is set at build time to an HTTPS ingest endpoint.
 * No vendor SDK, no key and no dependency is added here: any service (or the owner's own collector)
 * that accepts a JSON POST can be used, and a vendor SDK can later replace `send` behind the same
 * `reportError` call sites.
 *
 * Privacy: only the error name, message (trimmed, with digit runs that look like phone numbers
 * masked), a short stack, the app version, platform and a screen name are sent. Never tokens,
 * user ids, phone numbers, addresses or coordinates. The privacy policy must name the service
 * before this is switched on (owner action, placeholder P17).
 */
export type ErrorReport = {
  name: string;
  message: string;
  stack: string | null;
  fatal: boolean;
  context: string | null;
  appVersion: string;
  platform: string;
  at: string;
};

export type ErrorReporterDeps = {
  endpoint: string | null;
  appVersion: string;
  platform: string;
  send: (endpoint: string, report: ErrorReport) => Promise<unknown>;
  now?: () => Date;
};

const maxMessageLength = 500;
const maxStackLines = 15;
const maxReportsPerSession = 20;

export function sanitizeText(value: string): string {
  return value.replace(/\+?\d[\d\s-]{6,}\d/g, "[number]").replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]").slice(0, maxMessageLength);
}

export function isValidReportEndpoint(value: string | undefined | null): value is string {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  try {
    return new URL(trimmed).protocol === "https:";
  } catch {
    return false;
  }
}

export function buildErrorReport(error: unknown, options: { fatal: boolean; context?: string; appVersion: string; platform: string; now: Date }): ErrorReport {
  const asError = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Non-error thrown");
  return {
    name: asError.name || "Error",
    message: sanitizeText(asError.message || ""),
    stack: asError.stack ? sanitizeText(asError.stack.split("\n").slice(0, maxStackLines).join("\n")).slice(0, 4_000) : null,
    fatal: options.fatal,
    context: options.context ?? null,
    appVersion: options.appVersion,
    platform: options.platform,
    at: options.now.toISOString()
  };
}

export function createErrorReporter(deps: ErrorReporterDeps) {
  let sent = 0;
  const enabled = isValidReportEndpoint(deps.endpoint);
  return {
    enabled,
    /** Never throws and never awaits the network on the caller's path. */
    report(error: unknown, options: { fatal?: boolean; context?: string } = {}): void {
      if (!enabled || sent >= maxReportsPerSession) return;
      sent += 1;
      try {
        const report = buildErrorReport(error, {
          fatal: options.fatal ?? false,
          context: options.context,
          appVersion: deps.appVersion,
          platform: deps.platform,
          now: (deps.now ?? (() => new Date()))()
        });
        void deps.send(deps.endpoint as string, report).catch(() => undefined);
      } catch {
        // Reporting must never become the crash.
      }
    }
  };
}
