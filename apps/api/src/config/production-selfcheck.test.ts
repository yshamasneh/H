import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSelfCheck, productionSelfCheck, redact } from "./production-selfcheck";

test("lists missing production variables by name and never prints a value", () => {
  const env = { DATABASE_URL: "postgresql://user:SuperSecretPw@db.internal:5432/app", OTP_PROVIDER: "development", JWT_ACCESS_SECRET: "a-very-secret-access-value-123456" };
  const result = productionSelfCheck(env);
  assert.equal(result.readyForProduction, false);
  for (const name of ["JWT_REFRESH_SECRET", "OTP_HASH_SECRET", "CORS_ORIGIN", "MONITORING_TOKEN", "ERROR_TRACKING_WEBHOOK_URL", "AZURE_STORAGE_ACCOUNT_NAME"]) {
    assert.ok(result.missing.includes(name), name);
  }
  assert.ok(result.missing.some((name) => name.startsWith("OTP_PROVIDER")));
  const text = formatSelfCheck(result);
  assert.ok(!text.includes("SuperSecretPw"));
  assert.ok(!text.includes("a-very-secret-access-value-123456"));
  assert.match(text, /NOT READY/);
});

test("TweetSMS and S3 switch the required names", () => {
  const result = productionSelfCheck({ OTP_PROVIDER: "tweetsms", IMAGE_STORAGE_DRIVER: "s3" });
  assert.ok(result.missing.includes("TWEETSMS_API_KEY"));
  assert.ok(result.missing.includes("S3_PUBLIC_BASE_URL"));
  assert.ok(!result.missing.includes("AZURE_STORAGE_ACCOUNT_NAME"));
});

test("redaction removes every environment value, including list items", () => {
  assert.equal(redact("Invalid CORS origin: http://admin.example.test", { CORS_ORIGIN: "https://a.example.test, http://admin.example.test" }), "Invalid CORS origin: [redacted]");
});
