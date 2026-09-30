/**
 * Prints the request the TweetSMS adapter would send, without sending anything.
 *
 * Run it before the single live test so a typo in the sender, the endpoint or the number format
 * costs nothing: `npm run otp:tweetsms:preflight --workspace @wasel/api -- +970591234567`.
 *
 * This script performs no network request of any kind. It loads the same environment validation the
 * API boots with, builds the same form body the adapter builds, and prints it with the API key and
 * the code redacted. If it prints a request you are happy with, the configuration is consistent;
 * whether TweetSMS accepts it is still only knowable from one real send.
 */
import { config as loadEnvironmentFile } from "dotenv";
import { validateEnvironment } from "../src/config/environment";
import { normalizePhoneNumber } from "../src/auth/phone.util";
import {
  TWEETSMS_DEFAULT_BASE_URL,
  TWEETSMS_DEFAULT_MESSAGE_TEMPLATE,
  TweetSmsOtpProvider,
  type TweetSmsRecipientFormat
} from "../src/auth/tweetsms.provider";

// Same path the other apps/api scripts use, so it reads the repository's own .env.
loadEnvironmentFile({ path: "../../.env" });

function fail(message: string): never {
  console.error(`tweetsms-preflight: ${message}`);
  process.exit(1);
}

const rawPhone = process.argv[2];
if (!rawPhone) {
  fail("pass the destination number, for example +970591234567");
}

const environment = validateEnvironment({ ...process.env });
if (environment.OTP_PROVIDER !== "tweetsms") {
  fail(`OTP_PROVIDER is "${String(environment.OTP_PROVIDER)}"; set it to tweetsms to check this adapter`);
}

const countryCode = rawPhone.startsWith("+972") ? "+972" : "+970";
const phone = normalizePhoneNumber(countryCode, rawPhone);

// Never given a real code: the placeholder below is what appears in the printed message.
const provider = new TweetSmsOtpProvider(
  {
    baseUrl: String(environment.TWEETSMS_BASE_URL ?? TWEETSMS_DEFAULT_BASE_URL),
    apiKey: String(environment.TWEETSMS_API_KEY),
    sender: String(environment.TWEETSMS_SENDER),
    timeoutMs: Number(environment.TWEETSMS_TIMEOUT_MS ?? 8_000),
    recipientFormat: (environment.TWEETSMS_RECIPIENT_FORMAT ?? "digits") as TweetSmsRecipientFormat,
    messageTemplate: String(environment.TWEETSMS_MESSAGE_TEMPLATE ?? TWEETSMS_DEFAULT_MESSAGE_TEMPLATE),
    includeOptionalFields: environment.TWEETSMS_SEND_OPTIONAL_FIELDS === true
  },
  (async () => {
    throw new Error("tweetsms-preflight must never send");
  }) as typeof fetch
);

console.log("TweetSMS preflight — nothing was sent.\n");
console.log(`normalized number : ${phone}`);
for (const [field, value] of Object.entries(provider.describeRequest(phone))) {
  console.log(`${field.padEnd(18)}: ${value}`);
}
console.log(
  "\nA send is only ever counted as successful on a 2xx response whose JSON body carries code 999."
);
