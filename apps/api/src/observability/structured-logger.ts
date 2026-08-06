import type { LoggerService } from "@nestjs/common";

type StructuredLogLevel = "verbose" | "debug" | "log" | "warn" | "error" | "fatal";
const severity: Record<StructuredLogLevel, number> = {
  verbose: 10,
  debug: 20,
  log: 30,
  warn: 40,
  error: 50,
  fatal: 60
};
const sensitiveKey = /^(?:authorization|cookie|set-cookie|password|passcode|token|secret|otp|code|.*(?:password|passcode|token|secret|otp|apiKey))$/i;

export class StructuredLogger implements LoggerService {
  constructor(
    private readonly minimumLevel = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "log" : "debug"),
    private readonly service = "tasawaq-api"
  ) {}

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write("log", message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write("error", message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write("warn", message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write("debug", message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write("verbose", message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write("fatal", message, optionalParams);
  }

  private write(level: StructuredLogLevel, message: unknown, optionalParams: unknown[]): void {
    const configuredSeverity = severity[this.minimumLevel as StructuredLogLevel] ?? severity.log;
    if (severity[level] < configuredSeverity) return;

    const context = typeof optionalParams.at(-1) === "string" ? String(optionalParams.at(-1)) : undefined;
    const details = (context ? optionalParams.slice(0, -1) : optionalParams).map((item) => redact(item));
    const metadata = typeof message === "object" && message !== null ? redact(message) : undefined;
    const renderedMessage = metadata ? undefined : redactText(String(message));
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      ...(context ? { context } : {}),
      ...(renderedMessage ? { message: renderedMessage } : {}),
      ...(metadata ? { data: metadata } : {}),
      ...(details.length ? { details } : {})
    };
    const stream = severity[level] >= severity.error ? process.stderr : process.stdout;
    stream.write(`${JSON.stringify(entry)}\n`);
  }
}

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (!value || typeof value !== "object") return typeof value === "string" ? redactText(value) : value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (value instanceof Error) {
    return { name: value.name, message: redactText(value.message), stack: value.stack ? redactText(value.stack) : undefined };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, sensitiveKey.test(key) ? "[REDACTED]" : redact(item, seen)])
  );
}

export function redactText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, "$1[REDACTED]@")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .slice(0, 8_000);
}
