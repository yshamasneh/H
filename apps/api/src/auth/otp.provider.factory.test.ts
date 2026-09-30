import assert from "node:assert/strict";
import test from "node:test";
import { ConfigService } from "@nestjs/config";
import { DevelopmentOtpProvider, WebhookOtpProvider } from "./otp.provider";
import { createOtpProvider } from "./otp.provider.factory";
import { TweetSmsOtpProvider } from "./tweetsms.provider";

const tweetSms = {
  OTP_PROVIDER: "tweetsms",
  TWEETSMS_API_KEY: "tweetsms-account-api-key",
  TWEETSMS_SENDER: "JOVO"
};

function factory(settings: Record<string, unknown>) {
  return () => createOtpProvider(new ConfigService(settings));
}

test("a complete TweetSMS configuration produces the TweetSMS adapter", () => {
  assert.ok(factory(tweetSms)() instanceof TweetSmsOtpProvider);
});

/*
 * Choosing tweetsms and getting it wrong must stop the boot.
 *
 * The failure that matters is not an exception — it is the alternative: a deployment that asked for
 * real SMS, could not have it, and quietly started writing verification codes to its log instead.
 * Each case below asserts both that it throws and that nothing resembling the development provider
 * comes back.
 */
test("TweetSMS selected with a missing API key fails closed", () => {
  assert.throws(factory({ OTP_PROVIDER: "tweetsms", TWEETSMS_SENDER: "JOVO" }), /TWEETSMS_API_KEY/);
});

test("TweetSMS selected with a missing sender fails closed", () => {
  assert.throws(
    factory({ OTP_PROVIDER: "tweetsms", TWEETSMS_API_KEY: "tweetsms-account-api-key" }),
    /TWEETSMS_SENDER/
  );
});

test("TweetSMS selected with an unusable endpoint, template or timeout fails closed", () => {
  assert.throws(factory({ ...tweetSms, TWEETSMS_BASE_URL: "http://tweetsms.ps/api.php" }), /HTTPS/);
  assert.throws(factory({ ...tweetSms, TWEETSMS_MESSAGE_TEMPLATE: "no placeholder" }), /\{\{code\}\}/);
  assert.throws(factory({ ...tweetSms, TWEETSMS_TIMEOUT_MS: 0 }), /TWEETSMS_TIMEOUT_MS/);
});

test("a broken TweetSMS configuration never falls back to the development provider", () => {
  for (const settings of [
    { OTP_PROVIDER: "tweetsms" },
    { OTP_PROVIDER: "tweetsms", NODE_ENV: "development" },
    { OTP_PROVIDER: "tweetsms", NODE_ENV: "development", DEPLOYMENT_ENV: "trial" },
    { ...tweetSms, TWEETSMS_MESSAGE_TEMPLATE: "no placeholder" }
  ]) {
    const result = (() => {
      try {
        return createOtpProvider(new ConfigService(settings));
      } catch (error) {
        return error;
      }
    })();
    assert.ok(result instanceof Error, `expected ${JSON.stringify(settings)} to throw`);
    assert.ok(!(result instanceof DevelopmentOtpProvider));
  }
});

test("an unrecognised provider name fails closed", () => {
  assert.throws(factory({ OTP_PROVIDER: "twilio" }), /Unsupported OTP provider/);
});

test("the webhook provider still resolves from its own settings", () => {
  const provider = factory({
    OTP_PROVIDER: "webhook",
    OTP_WEBHOOK_URL: "https://messaging.example.com/otp",
    OTP_WEBHOOK_TOKEN: "otp-delivery-token-that-is-at-least-32-characters"
  })();
  assert.ok(provider instanceof WebhookOtpProvider);
});

test("the log-only development provider is available locally", () => {
  assert.ok(factory({})() instanceof DevelopmentOtpProvider);
  assert.ok(factory({ OTP_PROVIDER: "development", NODE_ENV: "development" })() instanceof DevelopmentOtpProvider);
});

test("the development provider is refused under NODE_ENV=production", () => {
  assert.throws(factory({ OTP_PROVIDER: "development", NODE_ENV: "production" }), /NODE_ENV=production/);
});

test("on a deployed environment the development provider warns, and is refused when required", () => {
  // NODE_ENV=development is what the Azure trial actually runs, so NODE_ENV alone would let this
  // through. IS_DEPLOYED is the signal that covers it, and OTP_REQUIRE_REAL_PROVIDER makes it fatal.
  const deployedTrial = { OTP_PROVIDER: "development", NODE_ENV: "development", IS_DEPLOYED: true };
  assert.ok(
    factory(deployedTrial)() instanceof DevelopmentOtpProvider,
    "still permitted, because refusing outright would stop the existing trial from booting"
  );
  assert.throws(
    factory({ ...deployedTrial, OTP_REQUIRE_REAL_PROVIDER: true }),
    /OTP_REQUIRE_REAL_PROVIDER/
  );
});
