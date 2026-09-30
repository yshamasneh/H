// Deliberately the contract, not the adapter: this module is also loaded on its own by
// scripts/release-readiness.mjs through a bare `tsx --eval`, where a NestJS or class-validator
// decorator anywhere in the import graph would fail to evaluate.
import {
  TWEETSMS_DEFAULT_BASE_URL,
  TWEETSMS_DEFAULT_MESSAGE_TEMPLATE,
  assertUsableTweetSmsOptions,
  tweetSmsRecipientFormats
} from "../auth/tweetsms.contract";
import { parseAppInsightsConnectionString } from "../observability/app-insights";
const requiredSecrets = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "OTP_HASH_SECRET"] as const;
const productionPlaceholders = ["replace_with_", "change_me", "changeme", "tasawaq_dev_password"];
const supportedNodeEnvironments = ["development", "test", "production"] as const;
const supportedLogLevels = ["error", "warn", "log", "debug", "verbose"] as const;

export function validateEnvironment(input: Record<string, unknown>): Record<string, unknown> {
  const environment = { ...input };
  const nodeEnv = readChoice(environment, "NODE_ENV", "development", supportedNodeEnvironments);
  const isProduction = nodeEnv === "production";
  const otpProvider = readChoice(environment, "OTP_PROVIDER", "development", [
    "development",
    "webhook",
    "tweetsms"
  ] as const);
  const databaseUrl = readString(environment, "DATABASE_URL", "");
  const storageAccountName = readString(environment, "AZURE_STORAGE_ACCOUNT_NAME", "");
  const storagePublicContainer = readString(environment, "AZURE_STORAGE_PUBLIC_CONTAINER_NAME", "");
  const storageUploadContainer = readString(environment, "AZURE_STORAGE_UPLOAD_CONTAINER_NAME", "");

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const storageValues = [storageAccountName, storagePublicContainer, storageUploadContainer];
  if (storageValues.some(Boolean) && !storageValues.every(Boolean)) {
    throw new Error(
      "AZURE_STORAGE_ACCOUNT_NAME, AZURE_STORAGE_PUBLIC_CONTAINER_NAME, and AZURE_STORAGE_UPLOAD_CONTAINER_NAME must be configured together"
    );
  }
  if (isProduction && !storageValues.every(Boolean)) {
    throw new Error("Azure image storage configuration is required in production");
  }
  if (storageAccountName && !/^[a-z0-9]{3,24}$/.test(storageAccountName)) {
    throw new Error("AZURE_STORAGE_ACCOUNT_NAME must be a valid Storage Account name");
  }
  for (const [key, value] of [
    ["AZURE_STORAGE_PUBLIC_CONTAINER_NAME", storagePublicContainer],
    ["AZURE_STORAGE_UPLOAD_CONTAINER_NAME", storageUploadContainer]
  ] as const) {
    if (value && !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(value)) {
      throw new Error(`${key} must be a valid Blob container name`);
    }
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

  // NODE_ENV=production must name a provider that actually delivers an SMS. The development provider
  // only writes the code to the server log, so anyone able to read logs could sign in as anyone.
  //
  // This check alone does NOT cover every deployment: the Azure trial deliberately runs with
  // NODE_ENV=development (see TRIAL_DEPLOY_CHECK.md), so it passes here. `deployed` below is the
  // broader signal, and OTP_REQUIRE_REAL_PROVIDER is what turns it into a refusal.
  if (isProduction && otpProvider === "development") {
    throw new Error("OTP_PROVIDER=tweetsms (or webhook) is required when NODE_ENV=production");
  }

  const deploymentEnv = readChoice(environment, "DEPLOYMENT_ENV", isProduction ? "production" : "local", [
    "local",
    "trial",
    "production"
  ] as const);
  const deployed = isDeployedEnvironment(environment, deploymentEnv, isProduction);
  environment.DEPLOYMENT_ENV = deploymentEnv;
  environment.IS_DEPLOYED = deployed;
  environment.OTP_REQUIRE_REAL_PROVIDER = readBoolean(environment, "OTP_REQUIRE_REAL_PROVIDER", false);
  if (deployed && otpProvider === "development" && environment.OTP_REQUIRE_REAL_PROVIDER === true) {
    throw new Error(
      "OTP_PROVIDER=development is refused on a deployed environment while OTP_REQUIRE_REAL_PROVIDER=true"
    );
  }
  if (otpProvider === "webhook") {
    environment.OTP_WEBHOOK_URL = readHttpsUrl(environment, "OTP_WEBHOOK_URL", isProduction);
    environment.OTP_WEBHOOK_TOKEN = readSecret(environment, "OTP_WEBHOOK_TOKEN", isProduction);
  }
  if (otpProvider === "tweetsms") {
    applyTweetSmsConfiguration(environment, isProduction);
  }

  const errorTrackingUrl = readString(environment, "ERROR_TRACKING_WEBHOOK_URL", "");
  const appInsightsConnection = readString(environment, "APPLICATIONINSIGHTS_CONNECTION_STRING", "");
  if (isProduction && !errorTrackingUrl && !appInsightsConnection) {
    throw new Error("ERROR_TRACKING_WEBHOOK_URL or APPLICATIONINSIGHTS_CONNECTION_STRING is required in production");
  }
  if (appInsightsConnection) {
    // A malformed value would otherwise mean errors are silently dropped; fail at boot instead.
    if (!parseAppInsightsConnectionString(appInsightsConnection)) {
      throw new Error("APPLICATIONINSIGHTS_CONNECTION_STRING must contain an InstrumentationKey and an HTTPS IngestionEndpoint");
    }
    environment.APPLICATIONINSIGHTS_CONNECTION_STRING = appInsightsConnection;
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
  // Palestinian mobile carriers use CGNAT heavily, so many customers share one public IP;
  // a per-IP limit near typical single-user traffic would throttle unrelated customers against
  // each other. Default well above that, still configurable per deployment.
  environment.RATE_LIMIT_LIMIT = readPositiveInteger(environment, "RATE_LIMIT_LIMIT", 400);
  // Postgres connection-pool size for this API instance. The pg driver's own default is only 10,
  // which caps total concurrency well below what a multi-core host and Postgres can serve (load
  // testing showed throughput plateauing at ~450 req/s with every endpoint queueing for a
  // connection). Tune per deployment to min(cores * 2, postgres_max_connections / instances).
  environment.DATABASE_POOL_MAX = readPositiveInteger(environment, "DATABASE_POOL_MAX", 20);
  // How long a request waits for a free pooled connection before failing fast (ms). 0 = wait
  // forever (the pg default), which turns pool exhaustion into unbounded latency; a finite value
  // sheds load instead. Default 0 to preserve existing behaviour unless a deployment opts in.
  environment.DATABASE_POOL_CONNECTION_TIMEOUT_MS = readNonNegativeInteger(
    environment,
    "DATABASE_POOL_CONNECTION_TIMEOUT_MS",
    0
  );
  // Interactive-transaction ceiling. Prisma's own default is only 5000ms, which load testing showed
  // a small fraction of checkouts exceed under heavy hot-product contention — the order transaction
  // then aborts and the checkout hard-fails instead of just being slow. A more forgiving 10s default
  // lets a slow-but-progressing order commit, while still bounding a genuinely stuck transaction.
  environment.DATABASE_TRANSACTION_TIMEOUT_MS = readPositiveInteger(environment, "DATABASE_TRANSACTION_TIMEOUT_MS", 10_000);
  // How long a transaction waits to be opened before giving up (Prisma default 2000ms).
  environment.DATABASE_TRANSACTION_MAX_WAIT_MS = readPositiveInteger(environment, "DATABASE_TRANSACTION_MAX_WAIT_MS", 5_000);
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
  // Cost ceilings, not security controls. The 60-second resend cooldown stops one person spamming
  // one number; neither of these stops a determined attacker. What they do is bound the bill when
  // a paid SMS gateway is behind the webhook, because every code sent costs real money and an
  // unbounded send rate is an unbounded invoice. Sized generously enough that a real person
  // retrying a signup never meets them.
  environment.OTP_MAX_PER_PHONE_PER_DAY = readPositiveInteger(environment, "OTP_MAX_PER_PHONE_PER_DAY", 10);
  environment.OTP_MAX_GLOBAL_PER_DAY = readPositiveInteger(environment, "OTP_MAX_GLOBAL_PER_DAY", 2_000);
  environment.OTP_WEBHOOK_TIMEOUT_MS = readPositiveInteger(environment, "OTP_WEBHOOK_TIMEOUT_MS", 5_000);
  environment.ERROR_TRACKING_TIMEOUT_MS = readPositiveInteger(environment, "ERROR_TRACKING_TIMEOUT_MS", 3_000);
  // Road routes for the driver's map come from any OSRM-compatible service (routing/routing.service.ts).
  environment.ROUTING_ENABLED = readBoolean(environment, "ROUTING_ENABLED", true);
  environment.ROUTING_TIMEOUT_MS = readPositiveInteger(environment, "ROUTING_TIMEOUT_MS", 4_000);
  // How long a driver's app report counts as proof the app is running (drivers/presence.rules.ts).
  environment.DRIVER_PRESENCE_FOREGROUND_LEASE_SECONDS = readPositiveInteger(environment, "DRIVER_PRESENCE_FOREGROUND_LEASE_SECONDS", 120);
  environment.DRIVER_PRESENCE_BACKGROUND_GRACE_MINUTES = readPositiveInteger(environment, "DRIVER_PRESENCE_BACKGROUND_GRACE_MINUTES", 30);
  environment.PUSH_WORKER_ENABLED = readBoolean(environment, "PUSH_WORKER_ENABLED", true);
  environment.PUSH_WORKER_POLL_INTERVAL_MS = readPositiveInteger(environment, "PUSH_WORKER_POLL_INTERVAL_MS", 5_000);
  environment.PUSH_WORKER_MAX_BATCHES_PER_RUN = readPositiveInteger(environment, "PUSH_WORKER_MAX_BATCHES_PER_RUN", 10);
  environment.PUSH_PROVIDER_TIMEOUT_MS = readPositiveInteger(environment, "PUSH_PROVIDER_TIMEOUT_MS", 5_000);
  environment.PUSH_PROCESSING_STALE_MS = readPositiveInteger(environment, "PUSH_PROCESSING_STALE_MS", 120_000);
  environment.PUSH_MAX_ATTEMPTS = readPositiveInteger(environment, "PUSH_MAX_ATTEMPTS", 6);
  environment.PUSH_MAX_RECEIPT_ATTEMPTS = readPositiveInteger(environment, "PUSH_MAX_RECEIPT_ATTEMPTS", 10);
  environment.PUSH_RECEIPT_DELAY_MS = readPositiveInteger(environment, "PUSH_RECEIPT_DELAY_MS", 60_000);
  environment.PUSH_RETRY_BASE_MS = readPositiveInteger(environment, "PUSH_RETRY_BASE_MS", 5_000);
  environment.PUSH_RETRY_MAX_MS = readPositiveInteger(environment, "PUSH_RETRY_MAX_MS", 900_000);
  environment.PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES = readPositiveInteger(
    environment,
    "PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES",
    10
  );
  // The restaurant vertical is built and tested but not launched yet (customers see a "coming
  // soon" card). This gates both public restaurant browsing and restaurant order creation
  // server-side, so launch is a config flip, not a rebuild. Supermarket ordering is unaffected.
  environment.RESTAURANT_ORDERING_ENABLED = readBoolean(environment, "RESTAURANT_ORDERING_ENABLED", false);
  environment.AZURE_STORAGE_ACCOUNT_NAME = storageAccountName;
  environment.AZURE_STORAGE_PUBLIC_CONTAINER_NAME = storagePublicContainer;
  environment.AZURE_STORAGE_UPLOAD_CONTAINER_NAME = storageUploadContainer;
  environment.UPLOAD_MAX_IMAGE_BYTES = readPositiveInteger(environment, "UPLOAD_MAX_IMAGE_BYTES", 5 * 1024 * 1024);
  environment.UPLOAD_SAS_TTL_SECONDS = readPositiveInteger(environment, "UPLOAD_SAS_TTL_SECONDS", 300);
  if ((environment.UPLOAD_MAX_IMAGE_BYTES as number) > 5 * 1024 * 1024) {
    throw new Error("UPLOAD_MAX_IMAGE_BYTES cannot exceed 5242880");
  }
  if ((environment.UPLOAD_SAS_TTL_SECONDS as number) > 300) {
    throw new Error("UPLOAD_SAS_TTL_SECONDS cannot exceed 300");
  }
  return environment;
}

/**
 * Whether this process is running somewhere other people can reach.
 *
 * NODE_ENV is not a reliable answer to that question in this project. The Azure trial runs the
 * production container image with `NODE_ENV=development` set as an App Service application setting,
 * on purpose, so that the relaxed CORS and HTTP settings a trial needs are accepted — which means a
 * guard written as `NODE_ENV === "production"` does not cover the trial at all.
 *
 * So three signals are combined, and any one of them is enough:
 *  - `DEPLOYMENT_ENV` set to `trial` or `production`: the operator saying so explicitly.
 *  - `WEBSITE_SITE_NAME` / `WEBSITE_INSTANCE_ID`: injected into every container Azure App Service
 *    runs, so a deployment there is detected whether or not anyone remembered to set the above.
 *  - `NODE_ENV=production`.
 */
export function isDeployedEnvironment(
  input: Record<string, unknown>,
  deploymentEnv: string,
  isProduction: boolean
): boolean {
  if (isProduction || deploymentEnv !== "local") return true;
  return Boolean(
    readString(input, "WEBSITE_SITE_NAME", "") || readString(input, "WEBSITE_INSTANCE_ID", "")
  );
}

/**
 * TweetSMS is the first provider whose credentials live in this process, so its configuration is
 * checked at boot with the very same assertion the adapter runs on itself — an unusable sender or an
 * oversized template stops the process instead of surfacing later as a failed signup.
 */
function applyTweetSmsConfiguration(environment: Record<string, unknown>, isProduction: boolean): void {
  // HTTPS is required whatever NODE_ENV says, because the API key travels in the request body.
  const baseUrl = readString(environment, "TWEETSMS_BASE_URL", TWEETSMS_DEFAULT_BASE_URL);
  environment.TWEETSMS_BASE_URL = readHttpsUrl({ TWEETSMS_BASE_URL: baseUrl }, "TWEETSMS_BASE_URL", true);

  // Not readSecret: the provider issues this key and chooses its length, so a 32-character floor
  // would reject a legitimate credential.
  const apiKey = readString(environment, "TWEETSMS_API_KEY", "");
  if (apiKey.length < 8) {
    throw new Error("TWEETSMS_API_KEY is required and must contain at least 8 characters");
  }
  if (isProduction && containsProductionPlaceholder(apiKey)) {
    throw new Error("TWEETSMS_API_KEY contains a placeholder and cannot be used in production");
  }
  environment.TWEETSMS_API_KEY = apiKey;

  const sender = readString(environment, "TWEETSMS_SENDER", "");
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,19}$/.test(sender)) {
    throw new Error(
      "TWEETSMS_SENDER must be the sender name approved by TweetSMS: 1-20 characters, starting with a letter or digit"
    );
  }
  if (isProduction && containsProductionPlaceholder(sender)) {
    throw new Error("TWEETSMS_SENDER contains a placeholder and cannot be used in production");
  }
  environment.TWEETSMS_SENDER = sender;

  const recipientFormat = readChoice(
    environment,
    "TWEETSMS_RECIPIENT_FORMAT",
    "digits",
    tweetSmsRecipientFormats
  );
  const messageTemplate = readString(
    environment,
    "TWEETSMS_MESSAGE_TEMPLATE",
    TWEETSMS_DEFAULT_MESSAGE_TEMPLATE
  );
  const timeoutMs = readPositiveInteger(environment, "TWEETSMS_TIMEOUT_MS", 8_000);
  const includeOptionalFields = readBoolean(environment, "TWEETSMS_SEND_OPTIONAL_FIELDS", false);

  assertUsableTweetSmsOptions({
    baseUrl: environment.TWEETSMS_BASE_URL as string,
    apiKey,
    sender,
    timeoutMs,
    recipientFormat,
    messageTemplate,
    includeOptionalFields
  });

  environment.TWEETSMS_RECIPIENT_FORMAT = recipientFormat;
  environment.TWEETSMS_MESSAGE_TEMPLATE = messageTemplate;
  environment.TWEETSMS_TIMEOUT_MS = timeoutMs;
  environment.TWEETSMS_SEND_OPTIONAL_FIELDS = includeOptionalFields;
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

function readNonNegativeInteger(input: Record<string, unknown>, key: string, fallback: number): number {
  const rawValue = input[key];
  const value = typeof rawValue === "number" ? rawValue : Number(rawValue ?? fallback);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${key} must be a non-negative integer`);
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
