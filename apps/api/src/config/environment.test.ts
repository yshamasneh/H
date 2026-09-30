import assert from "node:assert/strict";
import test from "node:test";
import { validateEnvironment } from "./environment";

const base = {
  DATABASE_URL: "postgresql://app:strong-password@db:5432/app",
  JWT_ACCESS_SECRET: "access-secret-value-that-is-at-least-32-characters-long",
  JWT_REFRESH_SECRET: "refresh-secret-value-that-is-at-least-32-characters-long",
  OTP_HASH_SECRET: "otp-hash-secret-value-that-is-at-least-32-characters-long"
};

const imageStorage = {
  AZURE_STORAGE_ACCOUNT_NAME: "jovoimages",
  AZURE_STORAGE_PUBLIC_CONTAINER_NAME: "product-images",
  AZURE_STORAGE_UPLOAD_CONTAINER_NAME: "image-uploads"
};

test("development defaults remain local-friendly", () => {
  const result = validateEnvironment(base);
  assert.equal(result.NODE_ENV, "development");
  assert.equal(result.OTP_PROVIDER, "development");
  assert.equal(result.CORS_ORIGIN, "*");
  assert.equal(result.REQUIRE_HTTPS, false);
  assert.equal(result.TRUST_PROXY, false);
});

test("production accepts explicit HTTPS integrations and secure secrets", () => {
  const result = validateEnvironment({
    ...base,
    ...imageStorage,
    NODE_ENV: "production",
    APP_VERSION: "0.8.0",
    CORS_ORIGIN: "https://app.example.com,https://admin.example.com",
    OTP_PROVIDER: "webhook",
    OTP_WEBHOOK_URL: "https://messaging.example.com/otp",
    OTP_WEBHOOK_TOKEN: "otp-delivery-token-that-is-at-least-32-characters",
    ERROR_TRACKING_WEBHOOK_URL: "https://errors.example.com/events",
    ERROR_TRACKING_TOKEN: "error-tracking-token-that-is-at-least-32-characters",
    MONITORING_TOKEN: "monitoring-token-that-is-at-least-32-characters"
  });

  assert.equal(result.REQUIRE_HTTPS, true);
  assert.equal(result.TRUST_PROXY, 1);
  assert.equal(result.OTP_PROVIDER, "webhook");
});

const productionWithoutTracking = {
  ...base,
  ...imageStorage,
  NODE_ENV: "production",
  CORS_ORIGIN: "https://admin.example.com",
  OTP_PROVIDER: "webhook",
  OTP_WEBHOOK_URL: "https://messaging.example.com/otp",
  OTP_WEBHOOK_TOKEN: "otp-delivery-token-that-is-at-least-32-characters",
  MONITORING_TOKEN: "monitoring-token-that-is-at-least-32-characters"
};

test("production refuses to boot with no error-tracking destination at all", () => {
  assert.throws(() => validateEnvironment(productionWithoutTracking), /ERROR_TRACKING_WEBHOOK_URL or APPLICATIONINSIGHTS_CONNECTION_STRING/);
});

test("production accepts Application Insights alone as its error-tracking destination", () => {
  const result = validateEnvironment({
    ...productionWithoutTracking,
    APPLICATIONINSIGHTS_CONNECTION_STRING: "InstrumentationKey=abc;IngestionEndpoint=https://uaenorth-0.in.applicationinsights.azure.com/"
  });
  assert.match(String(result.APPLICATIONINSIGHTS_CONNECTION_STRING), /InstrumentationKey=abc/);
});

test("a malformed Application Insights connection string fails at boot instead of dropping errors", () => {
  assert.throws(
    () => validateEnvironment({ ...base, APPLICATIONINSIGHTS_CONNECTION_STRING: "InstrumentationKey=abc" }),
    /APPLICATIONINSIGHTS_CONNECTION_STRING/
  );
});

test("the DB connection-pool size defaults sensibly and is tunable", () => {
  // Regression for the load-test finding: the pool must not silently sit at the pg driver default
  // of 10. Our validated default lifts it, and a deployment can tune it further.
  assert.equal(validateEnvironment(base).DATABASE_POOL_MAX, 20);
  assert.equal(validateEnvironment({ ...base, DATABASE_POOL_MAX: "50" }).DATABASE_POOL_MAX, 50);
});

test("a non-positive or non-integer DB pool size is rejected", () => {
  assert.throws(() => validateEnvironment({ ...base, DATABASE_POOL_MAX: "0" }), /DATABASE_POOL_MAX/);
  assert.throws(() => validateEnvironment({ ...base, DATABASE_POOL_MAX: "12.5" }), /DATABASE_POOL_MAX/);
});

test("the pool connection-acquisition timeout defaults to 0 (wait) and accepts a finite value", () => {
  assert.equal(validateEnvironment(base).DATABASE_POOL_CONNECTION_TIMEOUT_MS, 0);
  assert.equal(
    validateEnvironment({ ...base, DATABASE_POOL_CONNECTION_TIMEOUT_MS: "5000" }).DATABASE_POOL_CONNECTION_TIMEOUT_MS,
    5000
  );
  assert.throws(
    () => validateEnvironment({ ...base, DATABASE_POOL_CONNECTION_TIMEOUT_MS: "-1" }),
    /DATABASE_POOL_CONNECTION_TIMEOUT_MS/
  );
});

test("the interactive-transaction timeout defaults above Prisma's 5s and is tunable", () => {
  // Regression for the load-test finding: a handful of checkouts exceeded Prisma's default 5s
  // transaction timeout and hard-failed. The default is now more forgiving and configurable.
  const result = validateEnvironment(base);
  assert.equal(result.DATABASE_TRANSACTION_TIMEOUT_MS, 10_000);
  assert.equal(result.DATABASE_TRANSACTION_MAX_WAIT_MS, 5_000);
  assert.equal(validateEnvironment({ ...base, DATABASE_TRANSACTION_TIMEOUT_MS: "20000" }).DATABASE_TRANSACTION_TIMEOUT_MS, 20_000);
  assert.throws(() => validateEnvironment({ ...base, DATABASE_TRANSACTION_TIMEOUT_MS: "0" }), /DATABASE_TRANSACTION_TIMEOUT_MS/);
});

test("production rejects wildcard CORS and the development OTP provider", () => {
  assert.throws(
    () => validateEnvironment({ ...base, ...imageStorage, NODE_ENV: "production", CORS_ORIGIN: "*" }),
    /explicit HTTPS origins/
  );
  assert.throws(
    () => validateEnvironment({ ...base, ...imageStorage, NODE_ENV: "production", CORS_ORIGIN: "https://app.example.com" }),
    /OTP_PROVIDER=tweetsms/
  );
});

const tweetSms = {
  OTP_PROVIDER: "tweetsms",
  TWEETSMS_API_KEY: "tweetsms-account-api-key",
  TWEETSMS_SENDER: "JOVO"
};

/*
 * "Deployed" is not the same question as NODE_ENV.
 *
 * The Azure trial runs the production image with NODE_ENV=development set as an App Service
 * application setting, on purpose (TRIAL_DEPLOY_CHECK.md). So a guard written against
 * NODE_ENV=production does not cover the trial, and these tests pin the broader signal.
 */

test("a local development environment is not deployed", () => {
  const result = validateEnvironment(base);
  assert.equal(result.DEPLOYMENT_ENV, "local");
  assert.equal(result.IS_DEPLOYED, false);
  assert.equal(result.OTP_REQUIRE_REAL_PROVIDER, false);
});

test("Azure App Service is detected as deployed even with NODE_ENV=development", () => {
  // App Service injects WEBSITE_SITE_NAME into every container it runs, so this is detected whether
  // or not anyone remembered to set DEPLOYMENT_ENV.
  const byPlatform = validateEnvironment({ ...base, WEBSITE_SITE_NAME: "jovo-api-trial" });
  assert.equal(byPlatform.IS_DEPLOYED, true);
  assert.equal(byPlatform.DEPLOYMENT_ENV, "local", "the marker does not rename the environment");

  assert.equal(validateEnvironment({ ...base, WEBSITE_INSTANCE_ID: "abc123" }).IS_DEPLOYED, true);
  assert.equal(validateEnvironment({ ...base, DEPLOYMENT_ENV: "trial" }).IS_DEPLOYED, true);
});

test("NODE_ENV=production is deployed and defaults DEPLOYMENT_ENV to production", () => {
  const result = validateEnvironment({
    ...base,
    ...imageStorage,
    ...tweetSms,
    NODE_ENV: "production",
    CORS_ORIGIN: "https://app.example.com",
    MONITORING_TOKEN: "monitoring-token-that-is-at-least-32-characters",
    APPLICATIONINSIGHTS_CONNECTION_STRING:
      "InstrumentationKey=abc;IngestionEndpoint=https://uaenorth-0.in.applicationinsights.azure.com/"
  });
  assert.equal(result.IS_DEPLOYED, true);
  assert.equal(result.DEPLOYMENT_ENV, "production");
});

test("OTP_REQUIRE_REAL_PROVIDER turns a deployed log-only provider into a boot failure", () => {
  const deployedTrial = { ...base, WEBSITE_SITE_NAME: "jovo-api-trial", OTP_PROVIDER: "development" };
  // Permitted by default, so this change does not stop the existing trial from booting.
  assert.equal(validateEnvironment(deployedTrial).IS_DEPLOYED, true);
  assert.throws(
    () => validateEnvironment({ ...deployedTrial, OTP_REQUIRE_REAL_PROVIDER: "true" }),
    /OTP_REQUIRE_REAL_PROVIDER/
  );
  // It bites only on the log-only provider: a real one is unaffected.
  assert.equal(
    validateEnvironment({ ...deployedTrial, ...tweetSms, OTP_REQUIRE_REAL_PROVIDER: "true" }).OTP_PROVIDER,
    "tweetsms"
  );
});

test("an unrecognised DEPLOYMENT_ENV stops the boot rather than being read as local", () => {
  assert.throws(() => validateEnvironment({ ...base, DEPLOYMENT_ENV: "staging" }), /DEPLOYMENT_ENV/);
});

test("the TweetSMS provider defaults to the documented endpoint and the safe options", () => {
  const result = validateEnvironment({ ...base, ...tweetSms });
  assert.equal(result.OTP_PROVIDER, "tweetsms");
  assert.equal(result.TWEETSMS_BASE_URL, "https://tweetsms.ps/api.php/maan/sendsms");
  assert.equal(result.TWEETSMS_TIMEOUT_MS, 8_000);
  // Both defaults are the conservative reading of what was never live-tested: no plus in a form
  // body, and no empty groups/date/time fields that a gateway might read as a scheduled send.
  assert.equal(result.TWEETSMS_RECIPIENT_FORMAT, "digits");
  assert.equal(result.TWEETSMS_SEND_OPTIONAL_FIELDS, false);
  assert.match(String(result.TWEETSMS_MESSAGE_TEMPLATE), /\{\{code\}\}/);
});

test("TweetSMS is a valid production provider with its own credentials", () => {
  const result = validateEnvironment({
    ...base,
    ...imageStorage,
    ...tweetSms,
    NODE_ENV: "production",
    CORS_ORIGIN: "https://app.example.com",
    MONITORING_TOKEN: "monitoring-token-that-is-at-least-32-characters",
    APPLICATIONINSIGHTS_CONNECTION_STRING:
      "InstrumentationKey=abc;IngestionEndpoint=https://uaenorth-0.in.applicationinsights.azure.com/"
  });
  assert.equal(result.OTP_PROVIDER, "tweetsms");
  assert.equal(result.TWEETSMS_SENDER, "JOVO");
});

test("TweetSMS credentials are required, and placeholders cannot reach production", () => {
  assert.throws(() => validateEnvironment({ ...base, OTP_PROVIDER: "tweetsms" }), /TWEETSMS_API_KEY/);
  assert.throws(
    () => validateEnvironment({ ...base, OTP_PROVIDER: "tweetsms", TWEETSMS_API_KEY: "tweetsms-account-api-key" }),
    /TWEETSMS_SENDER/
  );
  assert.throws(
    () =>
      validateEnvironment({
        ...base,
        ...imageStorage,
        ...tweetSms,
        NODE_ENV: "production",
        CORS_ORIGIN: "https://app.example.com",
        MONITORING_TOKEN: "monitoring-token-that-is-at-least-32-characters",
        ERROR_TRACKING_WEBHOOK_URL: "https://errors.example.com/events",
        ERROR_TRACKING_TOKEN: "error-tracking-token-that-is-at-least-32-characters",
        TWEETSMS_API_KEY: "replace_with_the_tweetsms_api_key"
      }),
    /TWEETSMS_API_KEY contains a placeholder/
  );
});

test("the TweetSMS endpoint must be HTTPS, because the API key is in the request body", () => {
  assert.throws(
    () => validateEnvironment({ ...base, ...tweetSms, TWEETSMS_BASE_URL: "http://tweetsms.ps/api.php/maan/sendsms" }),
    /TWEETSMS_BASE_URL/
  );
});

test("an unusable TweetSMS message template or recipient format stops the boot", () => {
  assert.throws(
    () => validateEnvironment({ ...base, ...tweetSms, TWEETSMS_MESSAGE_TEMPLATE: "Your code is here" }),
    /\{\{code\}\}/
  );
  assert.throws(
    () =>
      validateEnvironment({
        ...base,
        ...tweetSms,
        TWEETSMS_MESSAGE_TEMPLATE: `{{code}} ${"padding ".repeat(30)}`
      }),
    /within 160/
  );
  assert.throws(
    () => validateEnvironment({ ...base, ...tweetSms, TWEETSMS_RECIPIENT_FORMAT: "msisdn" }),
    /TWEETSMS_RECIPIENT_FORMAT/
  );
  assert.throws(
    () => validateEnvironment({ ...base, ...tweetSms, TWEETSMS_SENDER: "sender name that is far too long" }),
    /TWEETSMS_SENDER/
  );
});

test("production rejects placeholder values and reused secrets", () => {
  assert.throws(
    () => validateEnvironment({ ...base, ...imageStorage, NODE_ENV: "production", JWT_ACCESS_SECRET: "replace_with_a_random_secret_at_least_32_characters" }),
    /placeholder/
  );
  assert.throws(
    () => validateEnvironment({ ...base, JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET }),
    /must be different/
  );
});

test("image storage is complete, named safely, and bounded to five-minute/five-megabyte uploads", () => {
  assert.throws(
    () => validateEnvironment({ ...base, AZURE_STORAGE_ACCOUNT_NAME: "jovoimages" }),
    /must be configured together/
  );
  assert.throws(
    () => validateEnvironment({ ...base, ...imageStorage, UPLOAD_SAS_TTL_SECONDS: "301" }),
    /cannot exceed 300/
  );
  assert.throws(
    () => validateEnvironment({ ...base, ...imageStorage, UPLOAD_MAX_IMAGE_BYTES: String(5 * 1024 * 1024 + 1) }),
    /cannot exceed 5242880/
  );
});
