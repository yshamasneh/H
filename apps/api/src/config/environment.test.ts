import assert from "node:assert/strict";
import test from "node:test";
import { validateEnvironment } from "./environment";

const base = {
  DATABASE_URL: "postgresql://app:strong-password@db:5432/app",
  JWT_ACCESS_SECRET: "access-secret-value-that-is-at-least-32-characters-long",
  JWT_REFRESH_SECRET: "refresh-secret-value-that-is-at-least-32-characters-long",
  OTP_HASH_SECRET: "otp-hash-secret-value-that-is-at-least-32-characters-long"
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
    () => validateEnvironment({ ...base, NODE_ENV: "production", CORS_ORIGIN: "*" }),
    /explicit HTTPS origins/
  );
  assert.throws(
    () => validateEnvironment({ ...base, NODE_ENV: "production", CORS_ORIGIN: "https://app.example.com" }),
    /OTP_PROVIDER=webhook/
  );
});

test("production rejects placeholder values and reused secrets", () => {
  assert.throws(
    () => validateEnvironment({ ...base, NODE_ENV: "production", JWT_ACCESS_SECRET: "replace_with_a_random_secret_at_least_32_characters" }),
    /placeholder/
  );
  assert.throws(
    () => validateEnvironment({ ...base, JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET }),
    /must be different/
  );
});
