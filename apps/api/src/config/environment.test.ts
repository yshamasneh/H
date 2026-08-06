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
