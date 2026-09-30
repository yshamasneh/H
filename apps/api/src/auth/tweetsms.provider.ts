/**
 * TweetSMS (tweetsms.ps) adapter.
 *
 * What is known about this gateway, and what is not, is spelled out in
 * docs/tweetsms-otp-readiness.md. The short version, because it shapes every decision below:
 *
 *  - Taken from the provider's own Postman collection: the endpoint is a POST of
 *    application/x-www-form-urlencoded fields api_key, sender, message, to, groups, date, time,
 *    and response code 999 means the message was accepted for sending.
 *  - Taken from a real response: an authentication failure comes back as
 *    {"status":"error","code":-110,"msg":"User name and password Wrong"}.
 *  - NOT verified: the exact shape of a successful response beyond code 999, whether
 *    groups/date/time may be omitted, which recipient number format the gateway wants, and
 *    whether non-ASCII message text survives. Each of those is a single named option here, so a
 *    correction is a configuration change rather than a code change.
 *
 * Two rules hold regardless of what the provider turns out to do: HTTP 200 on its own is never
 * treated as a successful send, and a send is never retried automatically — a retry after an
 * ambiguous failure is how one customer receives two codes and the platform pays for both.
 */

import { Logger } from "@nestjs/common";
import {
  OtpDeliveryError,
  maskPhoneForLogs,
  type OtpDelivery,
  type OtpDeliveryOutcome,
  type OtpProvider
} from "./otp.provider";
import { splitE164Phone } from "./phone.util";
import {
  TWEETSMS_SUCCESS_CODE,
  assertUsableTweetSmsOptions,
  renderTweetSmsMessage,
  type TweetSmsOptions,
  type TweetSmsRecipientFormat
} from "./tweetsms.contract";

// Re-exported so callers have one import for the adapter and its contract.
export {
  TWEETSMS_DEFAULT_BASE_URL,
  TWEETSMS_DEFAULT_MESSAGE_TEMPLATE,
  TWEETSMS_MESSAGE_MAX_LENGTH,
  TWEETSMS_SUCCESS_CODE,
  assertUsableTweetSmsOptions,
  renderTweetSmsMessage,
  tweetSmsRecipientFormats,
  type TweetSmsOptions,
  type TweetSmsRecipientFormat
} from "./tweetsms.contract";

/**
 * Every failure this adapter can report, as a closed set.
 *
 * Nothing a gateway sends us becomes one of these. The provider's own `msg`/`message` text is read
 * by nothing and logged by nothing: a gateway that echoes the submitted message back would be
 * echoing the OTP, and one that quotes the request would be quoting the API key. Redacting such a
 * string is guesswork, so it is never carried in the first place.
 */
export const tweetSmsFailureReasons = [
  /** The one rejection with provider evidence behind it: code -110, credentials not accepted. */
  "AUTH_REJECTED",
  /** The body named an error but no code we recognise. */
  "PROVIDER_ERROR_STATUS",
  /** A numeric code that is not the documented success code and is not a known rejection. */
  "UNEXPECTED_CODE",
  /** A parseable body with no numeric code in it at all. */
  "MISSING_CODE",
  /** The body was not JSON we could read — an HTML error page, truncated output. */
  "UNREADABLE_BODY",
  /** A non-2xx HTTP status. */
  "HTTP_ERROR",
  /** The request completed but its response body could not be read. */
  "RESPONSE_READ_FAILED",
  "TIMEOUT",
  "NETWORK_ERROR"
] as const;
export type TweetSmsFailureReason = (typeof tweetSmsFailureReasons)[number];

export type TweetSmsVerdict =
  | { accepted: true; providerCode: string }
  | {
      accepted: false;
      outcome: OtpDeliveryOutcome;
      /** Strictly numeric as a string, or "NONE". Never free text. */
      providerCode: string;
      reason: TweetSmsFailureReason;
    };

type FetchImplementation = typeof fetch;

export class TweetSmsOtpProvider implements OtpProvider {
  private readonly logger = new Logger("TweetSmsOtpProvider");

  constructor(
    private readonly options: TweetSmsOptions,
    private readonly fetchImplementation: FetchImplementation = fetch
  ) {
    assertUsableTweetSmsOptions(options);
  }

  async send(delivery: OtpDelivery): Promise<void> {
    const body = this.requestBody(delivery);

    // Exactly one request. Not retried, deliberately: after a timeout the message may already be on
    // its way, so a second POST would deliver a second copy and be billed twice. The customer
    // retries by hand, past the resend cooldown, if nothing arrives.
    let response: Response;
    try {
      response = await this.fetchImplementation(this.options.baseUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs)
      });
    } catch (error) {
      throw this.fail(delivery, "UNCONFIRMED", isTimeout(error) ? "TIMEOUT" : "NETWORK_ERROR");
    }

    const httpStatus = response.status;
    let responseBody: string;
    try {
      responseBody = await response.text();
    } catch {
      throw this.fail(delivery, "UNCONFIRMED", "RESPONSE_READ_FAILED", { httpStatus });
    }

    const verdict = interpretTweetSmsResponse(httpStatus, responseBody);
    if (!verdict.accepted) {
      throw this.fail(delivery, verdict.outcome, verdict.reason, {
        httpStatus,
        providerCode: verdict.providerCode
      });
    }

    this.log("log", delivery, { httpStatus, providerCode: verdict.providerCode });
  }

  /** Logs the failure from controlled values only, and returns the error to throw. */
  private fail(
    delivery: OtpDelivery,
    outcome: OtpDeliveryOutcome,
    reason: TweetSmsFailureReason,
    context: { httpStatus?: number; providerCode?: string } = {}
  ): OtpDeliveryError {
    const providerCode = context.providerCode ?? "NONE";
    this.log("error", delivery, { ...context, providerCode, reason, outcome });
    return new OtpDeliveryError(outcome, reason, providerCode);
  }

  /**
   * The exact form body. Also used by the preflight script, so an operator can check the request
   * without sending it. The API key is a value here and never a log line or a returned string.
   */
  requestBody(delivery: OtpDelivery): string {
    const form = new URLSearchParams();
    form.set("api_key", this.options.apiKey);
    form.set("sender", this.options.sender);
    form.set("message", renderTweetSmsMessage(this.options.messageTemplate, delivery.code));
    form.set("to", formatTweetSmsRecipient(delivery.phone, this.options.recipientFormat));
    if (this.options.includeOptionalFields) {
      form.set("groups", "");
      form.set("date", "");
      form.set("time", "");
    }
    return form.toString();
  }

  /** The request with the key and the code removed, for the preflight script and for support. */
  describeRequest(phone: string): Record<string, string> {
    return {
      url: this.options.baseUrl,
      api_key: "[redacted]",
      sender: this.options.sender,
      message: renderTweetSmsMessage(this.options.messageTemplate, "######"),
      to: formatTweetSmsRecipient(phone, this.options.recipientFormat),
      optionalFields: this.options.includeOptionalFields ? "groups,date,time (sent empty)" : "omitted"
    };
  }

  /**
   * The only place this adapter writes a log line, and every field in it is controlled by us: the
   * purpose, a masked phone number, the HTTP status, the provider's strictly numeric status code,
   * and a closed-set reason. The OTP, the full number, the API key and any provider-supplied text
   * have no route into this object.
   */
  private log(
    level: "log" | "warn" | "error",
    delivery: OtpDelivery,
    details: { httpStatus?: number; providerCode?: string; reason?: string; outcome?: string }
  ): void {
    this.logger[level](
      JSON.stringify({
        event: "tweetsms_send",
        purpose: delivery.purpose,
        phone: maskPhoneForLogs(delivery.phone),
        ...details
      })
    );
  }
}

/**
 * Decides whether a code actually left the gateway.
 *
 * Success is the narrowest thing the evidence supports: a 2xx response whose parseable JSON body
 * carries the documented code 999 and does not simultaneously report an error. A 200 with an HTML
 * error page, a 200 with a different code, a 200 with no code at all — all failures. The synthetic
 * message_id/data/cost fields from the Postman examples are never consulted, because they were
 * never observed coming from the real service.
 */
export function interpretTweetSmsResponse(httpStatus: number, body: string): TweetSmsVerdict {
  const parsed = parseJsonObject(body);
  const providerStatus = typeof parsed?.status === "string" ? parsed.status.trim().toLowerCase() : null;
  const numericCode = parsed ? readNumericCode(parsed.code) : null;
  const providerCode = numericCode !== null ? String(numericCode) : "NONE";
  const httpAccepted = httpStatus >= 200 && httpStatus < 300;

  if (httpAccepted && numericCode === TWEETSMS_SUCCESS_CODE && providerStatus !== "error") {
    return { accepted: true, providerCode };
  }

  const reason = failureReason(httpAccepted, parsed !== null, providerStatus, numericCode);
  return {
    accepted: false,
    outcome: reason === "AUTH_REJECTED" ? "REFUSED" : "UNCONFIRMED",
    providerCode,
    reason
  };
}

/**
 * The rejections we have actual evidence for, and nothing else.
 *
 * One response has been observed from this gateway:
 * `{"status":"error","code":-110,"msg":"User name and password Wrong"}`. Credentials the gateway
 * refuses to authenticate cannot have produced a queued message, so that code — and only that code —
 * is read as a refusal.
 *
 * Everything else stays UNCONFIRMED on purpose. We have no code list from the provider, so another
 * negative number could as easily mean "queued but the recipient is on a blocklist", and we cannot
 * see the gateway's billing either way. A bare `status: "error"` names no code at all. And an HTTP
 * 4xx is our request being rejected by *something* — a proxy, a WAF, the app after it had already
 * handed the message on. Treating any of those as proof that nothing was queued or charged would be
 * asserting more than the evidence supports; extend this map only when the provider documents a
 * code, or when a live response shows one.
 */
const evidencedRefusals = new Map<number, TweetSmsFailureReason>([[-110, "AUTH_REJECTED"]]);

function failureReason(
  httpAccepted: boolean,
  parseable: boolean,
  providerStatus: string | null,
  numericCode: number | null
): TweetSmsFailureReason {
  const evidenced = numericCode !== null ? evidencedRefusals.get(numericCode) : undefined;
  if (evidenced) return evidenced;
  if (!httpAccepted) return "HTTP_ERROR";
  if (!parseable) return "UNREADABLE_BODY";
  if (providerStatus === "error") return "PROVIDER_ERROR_STATUS";
  return numericCode === null ? "MISSING_CODE" : "UNEXPECTED_CODE";
}

export function formatTweetSmsRecipient(phone: string, format: TweetSmsRecipientFormat): string {
  if (format === "e164") return phone;
  if (format === "digits") return phone.replace(/^\+/, "");
  const { phoneNumber } = splitE164Phone(phone);
  return `0${phoneNumber}`;
}

function parseJsonObject(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readNumericCode(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d{1,9}$/.test(value.trim())) return Number(value.trim());
  return null;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
