/**
 * The parts of the TweetSMS integration that boot-time environment validation needs.
 *
 * This file imports nothing, on purpose. `config/environment.ts` validates the TweetSMS settings
 * with the very same assertion the adapter applies to itself, and it is also loaded on its own by
 * `scripts/release-readiness.mjs` through a bare `tsx --eval` — with no tsconfig and no
 * reflect-metadata. Anything that reaches NestJS or class-validator decorators from here breaks that
 * check, so the adapter's own class, its HTTP handling and its response parsing live next door in
 * tweetsms.provider.ts and import these.
 */

/** The only response code TweetSMS documents as a successful send. */
export const TWEETSMS_SUCCESS_CODE = 999;

export const TWEETSMS_DEFAULT_BASE_URL = "https://tweetsms.ps/api.php/maan/sendsms";

/**
 * ASCII by default and deliberately short. Whether this gateway handles UCS-2/Arabic text, and how
 * it counts the parts of a longer message, is unverified; an operator who wants Arabic copy can set
 * TWEETSMS_MESSAGE_TEMPLATE and confirm it with a single test send.
 */
export const TWEETSMS_DEFAULT_MESSAGE_TEMPLATE = "JOVO verification code: {{code}}. Do not share it.";

/** One GSM-7 part. A longer template is refused at boot rather than silently billed as two. */
export const TWEETSMS_MESSAGE_MAX_LENGTH = 160;

export const tweetSmsRecipientFormats = ["digits", "e164", "local"] as const;
export type TweetSmsRecipientFormat = (typeof tweetSmsRecipientFormats)[number];

export type TweetSmsOptions = {
  baseUrl: string;
  apiKey: string;
  /** The sender name the provider has approved for this account. */
  sender: string;
  timeoutMs: number;
  /**
   * How the destination number is written. Unverified against the live gateway.
   *
   * "digits" (the default) sends 970591234567. It is the default because the body is
   * x-www-form-urlencoded, where a literal "+" is ambiguous with an encoded space: a gateway that
   * reads the raw body instead of decoding it would see " 970591234567". If the provider turns out
   * to want the plus or the local form, switch to "e164" (+970591234567) or "local" (0591234567).
   */
  recipientFormat: TweetSmsRecipientFormat;
  /** Message body; must contain the {{code}} placeholder. */
  messageTemplate: string;
  /**
   * Whether to send the collection's optional groups/date/time fields as empty strings.
   *
   * The collection lists them, but whether the gateway requires them was never confirmed, and an
   * empty "date"/"time" could equally well be read by the gateway as a scheduled send. Off by
   * default; turn it on only if the provider rejects a request that omits them.
   */
  includeOptionalFields: boolean;
};

export function renderTweetSmsMessage(template: string, code: string): string {
  return template.split("{{code}}").join(code);
}

export function assertUsableTweetSmsOptions(options: TweetSmsOptions): void {
  if (!/^https:\/\//i.test(options.baseUrl)) {
    throw new Error("TWEETSMS_BASE_URL must use HTTPS: the API key travels in the request body");
  }
  if (!options.apiKey.trim()) {
    throw new Error("TWEETSMS_API_KEY is required");
  }
  if (!options.sender.trim()) {
    throw new Error("TWEETSMS_SENDER is required");
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("TWEETSMS_TIMEOUT_MS must be a positive integer");
  }
  if (!options.messageTemplate.includes("{{code}}")) {
    throw new Error("TWEETSMS_MESSAGE_TEMPLATE must contain the {{code}} placeholder");
  }
  const rendered = renderTweetSmsMessage(options.messageTemplate, "000000");
  if (rendered.length > TWEETSMS_MESSAGE_MAX_LENGTH) {
    throw new Error(
      `TWEETSMS_MESSAGE_TEMPLATE renders to ${rendered.length} characters; keep it within ${TWEETSMS_MESSAGE_MAX_LENGTH} so one code costs one message`
    );
  }
}
