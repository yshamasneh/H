import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { DevelopmentOtpProvider, WebhookOtpProvider, type OtpProvider } from "./otp.provider";
import {
  TWEETSMS_DEFAULT_BASE_URL,
  TWEETSMS_DEFAULT_MESSAGE_TEMPLATE,
  TweetSmsOtpProvider,
  type TweetSmsRecipientFormat
} from "./tweetsms.provider";

/**
 * Chooses the OTP provider from configuration, and fails closed.
 *
 * Extracted from AuthModule so the choice is directly testable: which provider a given configuration
 * produces, and — more importantly — that a broken configuration produces *no* provider rather than
 * quietly falling back to the log-only development one. There is no default branch and no rescue: a
 * value this function does not understand throws, and the API does not boot.
 *
 * On the development provider and deployed environments, read `isDeployedEnvironment` in
 * config/environment.ts. NODE_ENV alone does not identify a deployment here — the Azure trial runs
 * with NODE_ENV=development on purpose — so the check is broader than that, and
 * OTP_REQUIRE_REAL_PROVIDER turns the warning it emits into a refusal to boot.
 */
export function createOtpProvider(config: ConfigService): OtpProvider {
  const logger = new Logger("OtpProviderFactory");
  const provider = config.get<string>("OTP_PROVIDER", "development");

  if (provider === "tweetsms") {
    // Every value is required or validated. getOrThrow covers the credentials; the adapter's own
    // constructor re-checks the endpoint, the sender, the timeout and the message template. A
    // failure here is a boot failure, which is the point: a deployment that asked for real SMS and
    // cannot have it must stop, not send codes to a log file instead.
    return new TweetSmsOtpProvider({
      baseUrl: config.get<string>("TWEETSMS_BASE_URL", TWEETSMS_DEFAULT_BASE_URL),
      apiKey: config.getOrThrow<string>("TWEETSMS_API_KEY"),
      sender: config.getOrThrow<string>("TWEETSMS_SENDER"),
      timeoutMs: Number(config.get<number>("TWEETSMS_TIMEOUT_MS", 8_000)),
      recipientFormat: config.get<TweetSmsRecipientFormat>("TWEETSMS_RECIPIENT_FORMAT", "digits"),
      messageTemplate: config.get<string>("TWEETSMS_MESSAGE_TEMPLATE", TWEETSMS_DEFAULT_MESSAGE_TEMPLATE),
      includeOptionalFields: config.get<boolean>("TWEETSMS_SEND_OPTIONAL_FIELDS", false) === true
    });
  }

  if (provider === "webhook") {
    return new WebhookOtpProvider(
      config.getOrThrow<string>("OTP_WEBHOOK_URL"),
      config.getOrThrow<string>("OTP_WEBHOOK_TOKEN"),
      config.get<number>("OTP_WEBHOOK_TIMEOUT_MS", 5_000)
    );
  }

  if (provider === "development") {
    const nodeEnv = config.get<string>("NODE_ENV", "development");
    if (nodeEnv === "production") {
      throw new Error("OTP_PROVIDER=development cannot be used with NODE_ENV=production");
    }

    // The development provider writes each code to the application log. On anything reachable from
    // the internet that means whoever can read the logs can sign in as anybody who has a phone
    // number on file.
    if (config.get<boolean>("IS_DEPLOYED", false) === true) {
      if (config.get<boolean>("OTP_REQUIRE_REAL_PROVIDER", false) === true) {
        throw new Error(
          "OTP_PROVIDER=development is refused on a deployed environment while OTP_REQUIRE_REAL_PROVIDER=true. Configure OTP_PROVIDER=tweetsms."
        );
      }
      logger.warn(
        JSON.stringify({
          event: "otp_development_provider_on_deployed_environment",
          deploymentEnv: config.get<string>("DEPLOYMENT_ENV", "local"),
          nodeEnv,
          detail:
            "Verification codes are only written to this log, not sent by SMS. Anyone who can read these logs can sign in as any user. Set OTP_PROVIDER=tweetsms, and OTP_REQUIRE_REAL_PROVIDER=true to make this a boot failure."
        })
      );
    }
    return new DevelopmentOtpProvider();
  }

  throw new Error(`Unsupported OTP provider "${provider}"`);
}
