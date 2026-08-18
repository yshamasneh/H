const requiredSecrets = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "OTP_HASH_SECRET"] as const;
const productionPlaceholders = ["replace_with_", "change_me", "changeme", "tasawaq_dev_password"];
const supportedNodeEnvironments = ["development", "test", "production"] as const;
const supportedLogLevels = ["error", "warn", "log", "debug", "verbose"] as const;

export function validateEnvironment(input: Record<string, unknown>): Record<string, unknown> {
  const environment = { ...input };
  const nodeEnv = readChoice(environment, "NODE_ENV", "development", supportedNodeEnvironments);
  const isProduction = nodeEnv === "production";
  const otpProvider = readChoice(environment, "OTP_PROVIDER", "development", ["development", "webhook"] as const);
  const databaseUrl = readString(environment, "DATABASE_URL", "");

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  for (const key of requiredSecrets) {
    const value = readSecret(environment, key, isProduction);
    environment[key] = value;
  }

  if (new Set(requiredSecrets.map((key) => environment[key])).size !== requiredSecrets.length) {
    throw new Error("JWT and OTP secrets must be different values");
  }

  if (isProduction && containsProductionPlaceholder(databaseUrl)) {
    throw new Error("DATABASE_URL contains a development placeholder and cannot be used in production");
  }

  const corsOrigin = readString(environment, "CORS_ORIGIN", isProduction ? "" : "*");
  if (isProduction) validateProductionCorsOrigins(corsOrigin);

  if (isProduction && otpProvider !== "webhook") {
    throw new Error("OTP_PROVIDER=webhook is required when NODE_ENV=production");
  }
  if (otpProvider === "webhook") {
    environment.OTP_WEBHOOK_URL = readHttpsUrl(environment, "OTP_WEBHOOK_URL", isProduction);
    environment.OTP_WEBHOOK_TOKEN = readSecret(environment, "OTP_WEBHOOK_TOKEN", isProduction);
  }

  const errorTrackingUrl = readString(environment, "ERROR_TRACKING_WEBHOOK_URL", "");
  if (isProduction && !errorTrackingUrl) {
    throw new Error("ERROR_TRACKING_WEBHOOK_URL is required in production");
  }
  if (errorTrackingUrl) {
    environment.ERROR_TRACKING_WEBHOOK_URL = readHttpsUrl(environment, "ERROR_TRACKING_WEBHOOK_URL", isProduction);
    environment.ERROR_TRACKING_TOKEN = readSecret(environment, "ERROR_TRACKING_TOKEN", isProduction);
  }

  const monitoringToken = readString(environment, "MONITORING_TOKEN", "");
  if (isProduction && monitoringToken.length < 32) {
    throw new Error("MONITORING_TOKEN must contain at least 32 characters in production");
  }
  if (isProduction && containsProductionPlaceholder(monitoringToken)) {
    throw new Error("MONITORING_TOKEN contains a placeholder and cannot be used in production");
  }

  environment.NODE_ENV = nodeEnv;
  environment.APP_VERSION = readString(environment, "APP_VERSION", "development");
  environment.LOG_LEVEL = readChoice(environment, "LOG_LEVEL", isProduction ? "log" : "debug", supportedLogLevels);
  environment.OTP_PROVIDER = otpProvider;
  environment.CORS_ORIGIN = corsOrigin;
  environment.MONITORING_TOKEN = monitoringToken;
  environment.TRUST_PROXY = readTrustProxy(environment, isProduction ? 1 : false);
  environment.REQUIRE_HTTPS = readBoolean(environment, "REQUIRE_HTTPS", isProduction);
  environment.PORT = readPositiveInteger(environment, "PORT", 3000);
  environment.RATE_LIMIT_TTL_MS = readPositiveInteger(environment, "RATE_LIMIT_TTL_MS", 60_000);
  environment.RATE_LIMIT_LIMIT = readPositiveInteger(environment, "RATE_LIMIT_LIMIT", 60);
  environment.DELIVERY_MIN_FEE_MINOR = readPositiveInteger(environment, "DELIVERY_MIN_FEE_MINOR", 1_000);
  environment.DELIVERY_INCLUDED_DISTANCE_METERS = readPositiveInteger(
    environment,
    "DELIVERY_INCLUDED_DISTANCE_METERS",
    3_000
  );
  environment.DELIVERY_RATE_PER_KM_MINOR = readPositiveInteger(environment, "DELIVERY_RATE_PER_KM_MINOR", 150);
  environment.DELIVERY_MAX_DISTANCE_METERS = readPositiveInteger(
    environment,
    "DELIVERY_MAX_DISTANCE_METERS",
    25_000
  );
  environment.JWT_ACCESS_EXPIRATION_SECONDS = readPositiveInteger(environment, "JWT_ACCESS_EXPIRATION_SECONDS", 900);
  environment.JWT_REFRESH_EXPIRATION_DAYS = readPositiveInteger(environment, "JWT_REFRESH_EXPIRATION_DAYS", 30);
  environment.OTP_EXPIRATION_MINUTES = readPositiveInteger(environment, "OTP_EXPIRATION_MINUTES", 5);
  environment.OTP_RESEND_COOLDOWN_SECONDS = readPositiveInteger(environment, "OTP_RESEND_COOLDOWN_SECONDS", 60);
  environment.OTP_MAX_ATTEMPTS = readPositiveInteger(environment, "OTP_MAX_ATTEMPTS", 5);
  environment.OTP_WEBHOOK_TIMEOUT_MS = readPositiveInteger(environment, "OTP_WEBHOOK_TIMEOUT_MS", 5_000);
  environment.ERROR_TRACKING_TIMEOUT_MS = readPositiveInteger(environment, "ERROR_TRACKING_TIMEOUT_MS", 3_000);
  environment.PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES = readPositiveInteger(
    environment,
    "PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES",
    10
  );
  // The restaurant vertical is built and tested but not launched yet (customers see a "coming
  // soon" card). This gates both public restaurant browsing and restaurant order creation
  // server-side, so launch is a config flip, not a rebuild. Supermarket ordering is unaffected.
  environment.RESTAURANT_ORDERING_ENABLED = readBoolean(environment, "RESTAURANT_ORDERING_ENABLED", false);
  return environment;
}

function readSecret(input: Record<string, unknown>, key: string, production: boolean): string {
  const value = readString(input, key, "");
  if (value.length < 32) {
    throw new Error(`${key} must contain at least 32 characters`);
  }
  if (production && containsProductionPlaceholder(value)) {
    throw new Error(`${key} contains a placeholder and cannot be used in production`);
  }
  return value;
}

function containsProductionPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase();
  return productionPlaceholders.some((placeholder) => normalized.includes(placeholder));
}

function validateProductionCorsOrigins(value: string): void {
  if (!value || value === "*") {
    throw new Error("CORS_ORIGIN must contain explicit HTTPS origins in production");
  }
  for (const origin of value.split(",").map((item) => item.trim())) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`Invalid CORS origin: ${origin}`);
    }
    if (parsed.protocol !== "https:" || parsed.origin !== origin || parsed.username || parsed.password) {
      throw new Error(`Production CORS origins must be exact HTTPS origins: ${origin}`);
    }
  }
}

function readHttpsUrl(input: Record<string, unknown>, key: string, requireHttps: boolean): string {
  const value = readString(input, key, "");
  if (!value) throw new Error(`${key} is required`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${key} must use HTTP or HTTPS`);
  }
  if (requireHttps && parsed.protocol !== "https:") {
    throw new Error(`${key} must use HTTPS in production`);
  }
  return parsed.toString();
}

function readString(input: Record<string, unknown>, key: string, fallback: string): string {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readChoice<const T extends readonly string[]>(
  input: Record<string, unknown>,
  key: string,
  fallback: T[number],
  choices: T
): T[number] {
  const value = readString(input, key, fallback);
  if (!choices.includes(value)) throw new Error(`Unsupported ${key}: ${value}`);
  return value as T[number];
}

function readPositiveInteger(input: Record<string, unknown>, key: string, fallback: number): number {
  const rawValue = input[key];
  const value = typeof rawValue === "number" ? rawValue : Number(rawValue ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

function readBoolean(input: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = input[key];
  if (value === undefined || value === "") return fallback;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`${key} must be true or false`);
}

function readTrustProxy(input: Record<string, unknown>, fallback: number | false): number | false {
  const value = input.TRUST_PROXY;
  if (value === undefined || value === "") return fallback;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  const hops = Number(value);
  if (!Number.isInteger(hops) || hops < 1 || hops > 10) {
    throw new Error("TRUST_PROXY must be false or a number from 1 to 10");
  }
  return hops;
}
