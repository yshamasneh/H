import assert from "node:assert/strict";
import test from "node:test";
import { Logger } from "@nestjs/common";
import { OtpDeliveryError } from "./otp.provider";
import {
  TWEETSMS_DEFAULT_BASE_URL,
  TWEETSMS_DEFAULT_MESSAGE_TEMPLATE,
  TweetSmsOtpProvider,
  formatTweetSmsRecipient,
  interpretTweetSmsResponse,
  renderTweetSmsMessage,
  tweetSmsFailureReasons,
  type TweetSmsOptions
} from "./tweetsms.provider";

const API_KEY = "test-api-key-value";

const baseOptions: TweetSmsOptions = {
  baseUrl: TWEETSMS_DEFAULT_BASE_URL,
  apiKey: API_KEY,
  sender: "JOVO",
  timeoutMs: 8_000,
  recipientFormat: "digits",
  messageTemplate: TWEETSMS_DEFAULT_MESSAGE_TEMPLATE,
  includeOptionalFields: false
};

const delivery = { phone: "+970591234567", purpose: "CUSTOMER_SIGNUP", code: "483921" } as const;

type Call = { url: string; init?: RequestInit };

/** Every test drives the adapter through this stub; no test reaches the real gateway. */
function stubProvider(
  respond: (call: Call) => Promise<{ status: number; body: string }>,
  overrides: Partial<TweetSmsOptions> = {}
) {
  const calls: Call[] = [];
  const provider = new TweetSmsOtpProvider({ ...baseOptions, ...overrides }, (async (url, init) => {
    const call = { url: String(url), init };
    calls.push(call);
    const { status, body } = await respond(call);
    return { status, ok: status >= 200 && status < 300, text: async () => body } as Response;
  }) as typeof fetch);
  return { provider, calls };
}

function respondWith(status: number, body: string) {
  return async () => ({ status, body });
}

function bodyOf(call: Call): URLSearchParams {
  return new URLSearchParams(String(call.init?.body));
}

/** Captures what the adapter writes through the Nest logger, so log content can be asserted. */
async function captureLogs(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const levels = ["log", "warn", "error"] as const;
  const prototype = Logger.prototype as unknown as Record<string, unknown>;
  const originals = levels.map((level) => prototype[level]);
  for (const level of levels) {
    prototype[level] = function (message: unknown) {
      lines.push(String(message));
    };
  }
  try {
    await run();
  } finally {
    levels.forEach((level, index) => {
      prototype[level] = originals[index];
    });
  }
  return lines;
}

function expectDeliveryError(
  error: unknown,
  expected: { outcome: "REFUSED" | "UNCONFIRMED"; reason: string; providerCode?: string }
): boolean {
  assert.ok(error instanceof OtpDeliveryError, `expected an OtpDeliveryError, got ${String(error)}`);
  assert.equal(error.outcome, expected.outcome);
  assert.equal(error.reason, expected.reason);
  if (expected.providerCode !== undefined) assert.equal(error.providerCode, expected.providerCode);
  return true;
}

test("a send posts the documented form fields to the TweetSMS endpoint", async () => {
  const { provider, calls } = stubProvider(respondWith(200, JSON.stringify({ status: "success", code: 999 })));

  await provider.send(delivery);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, TWEETSMS_DEFAULT_BASE_URL);
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(
    (calls[0].init?.headers as Record<string, string>)["Content-Type"],
    "application/x-www-form-urlencoded"
  );

  const body = bodyOf(calls[0]);
  assert.equal(body.get("api_key"), API_KEY);
  assert.equal(body.get("sender"), "JOVO");
  assert.equal(body.get("to"), "970591234567");
  assert.equal(body.get("message"), "JOVO verification code: 483921. Do not share it.");
  // The optional fields stay out of the request until an operator asks for them.
  assert.equal(body.has("groups"), false);
  assert.equal(body.has("date"), false);
  assert.equal(body.has("time"), false);
});

test("the optional groups/date/time fields are sent only when configuration asks for them", async () => {
  const { provider, calls } = stubProvider(respondWith(200, JSON.stringify({ code: 999 })), {
    includeOptionalFields: true
  });

  await provider.send(delivery);

  const body = bodyOf(calls[0]);
  assert.equal(body.get("groups"), "");
  assert.equal(body.get("date"), "");
  assert.equal(body.get("time"), "");
});

test("code 999 as a string is still a successful send", async () => {
  const { provider } = stubProvider(respondWith(200, JSON.stringify({ status: "success", code: "999" })));
  await provider.send(delivery);
});

/*
 * Classification.
 *
 * Only the one rejection we have evidence for — code -110, the observed
 * {"status":"error","code":-110,"msg":"User name and password Wrong"} — is read as "nothing was
 * queued". Everything else is UNCONFIRMED, because we cannot see the gateway's queue or its billing.
 */

test("the observed authentication failure is the one evidenced refusal", async () => {
  const { provider, calls } = stubProvider(
    respondWith(200, JSON.stringify({ status: "error", code: -110, msg: "User name and password Wrong" }))
  );

  await assert.rejects(provider.send(delivery), (error: unknown) => {
    expectDeliveryError(error, { outcome: "REFUSED", reason: "AUTH_REJECTED", providerCode: "-110" });
    const payload = (error as OtpDeliveryError).getResponse() as {
      code?: string;
      message?: string;
      details?: unknown;
    };
    assert.equal(payload.code, "OTP_DELIVERY_FAILED");
    assert.equal(payload.details, null);
    // No provider wording, no credential, and no OTP reaches the client.
    assert.doesNotMatch(String(payload.message), /password|api_key|test-api-key-value|483921/i);
    return true;
  });

  assert.equal(calls.length, 1, "a failed send is never retried automatically");
});

test("another negative code is NOT treated as proof that nothing was queued", async () => {
  // We have no code list from TweetSMS. A different negative number could as easily mean the message
  // was queued and then dropped, so it stays unknown.
  const { provider } = stubProvider(respondWith(200, JSON.stringify({ status: "error", code: -3 })));
  await assert.rejects(provider.send(delivery), (error: unknown) =>
    expectDeliveryError(error, {
      outcome: "UNCONFIRMED",
      reason: "PROVIDER_ERROR_STATUS",
      providerCode: "-3"
    })
  );
});

test("a bare error status with no code stays unconfirmed", async () => {
  const { provider } = stubProvider(respondWith(200, JSON.stringify({ status: "error", msg: "Failed" })));
  await assert.rejects(provider.send(delivery), (error: unknown) =>
    expectDeliveryError(error, {
      outcome: "UNCONFIRMED",
      reason: "PROVIDER_ERROR_STATUS",
      providerCode: "NONE"
    })
  );
});

test("an HTTP 4xx is not proof that nothing was queued", async () => {
  // A 4xx can come from a proxy, a WAF, or from the gateway after it had already handed the message
  // on. It bounds nothing to assume otherwise.
  for (const status of [400, 401, 403, 429]) {
    const { provider } = stubProvider(respondWith(status, JSON.stringify({ msg: "Rejected" })));
    await assert.rejects(provider.send(delivery), (error: unknown) =>
      expectDeliveryError(error, { outcome: "UNCONFIRMED", reason: "HTTP_ERROR" })
    );
  }
});

test("a 5xx is unconfirmed, and still only one attempt", async () => {
  const { provider, calls } = stubProvider(respondWith(503, "upstream unavailable"));
  await assert.rejects(provider.send(delivery), (error: unknown) =>
    expectDeliveryError(error, { outcome: "UNCONFIRMED", reason: "HTTP_ERROR" })
  );
  assert.equal(calls.length, 1);
});

test("the evidenced refusal is recognised even on a non-2xx response", async () => {
  const { provider } = stubProvider(respondWith(401, JSON.stringify({ status: "error", code: -110 })));
  await assert.rejects(provider.send(delivery), (error: unknown) =>
    expectDeliveryError(error, { outcome: "REFUSED", reason: "AUTH_REJECTED" })
  );
});

test("HTTP 200 with an unrecognized provider code is a failure, not a send", async () => {
  const { provider } = stubProvider(respondWith(200, JSON.stringify({ status: "success", code: 1 })));
  await assert.rejects(provider.send(delivery), (error: unknown) =>
    expectDeliveryError(error, { outcome: "UNCONFIRMED", reason: "UNEXPECTED_CODE", providerCode: "1" })
  );
});

test("HTTP 200 with no code at all is a failure", async () => {
  const { provider } = stubProvider(respondWith(200, JSON.stringify({ status: "success", message_id: "abc" })));
  await assert.rejects(provider.send(delivery), (error: unknown) =>
    expectDeliveryError(error, { outcome: "UNCONFIRMED", reason: "MISSING_CODE", providerCode: "NONE" })
  );
});

test("HTTP 200 carrying an HTML error page is a failure", async () => {
  const { provider } = stubProvider(respondWith(200, "<html><body>Service under maintenance</body></html>"));
  await assert.rejects(provider.send(delivery), (error: unknown) =>
    expectDeliveryError(error, { outcome: "UNCONFIRMED", reason: "UNREADABLE_BODY" })
  );
});

test("truncated JSON, and a JSON array body, are failures", async () => {
  for (const body of ['{"status":"success","code":99', "[999]"]) {
    const { provider } = stubProvider(respondWith(200, body));
    await assert.rejects(provider.send(delivery), (error: unknown) =>
      expectDeliveryError(error, { outcome: "UNCONFIRMED", reason: "UNREADABLE_BODY" })
    );
  }
});

test("a body that reports both success code 999 and an error status is not trusted", async () => {
  const { provider } = stubProvider(respondWith(200, JSON.stringify({ status: "error", code: 999 })));
  await assert.rejects(provider.send(delivery), (error: unknown) =>
    expectDeliveryError(error, { outcome: "UNCONFIRMED", reason: "PROVIDER_ERROR_STATUS" })
  );
});

test("code 999 on a 500 response is still not a send", async () => {
  const { provider } = stubProvider(respondWith(500, JSON.stringify({ status: "success", code: 999 })));
  await assert.rejects(provider.send(delivery), (error: unknown) =>
    expectDeliveryError(error, { outcome: "UNCONFIRMED", reason: "HTTP_ERROR" })
  );
});

test("a timeout is unconfirmed and is never retried", async () => {
  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), {
    name: "TimeoutError"
  });
  const calls: string[] = [];
  const provider = new TweetSmsOtpProvider(baseOptions, (async () => {
    calls.push("attempt");
    throw timeout;
  }) as typeof fetch);

  await assert.rejects(provider.send(delivery), (error: unknown) =>
    expectDeliveryError(error, { outcome: "UNCONFIRMED", reason: "TIMEOUT", providerCode: "NONE" })
  );
  assert.equal(calls.length, 1, "the message may already be on its way; we do not send a second");
});

test("a network failure is unconfirmed", async () => {
  const provider = new TweetSmsOtpProvider(baseOptions, (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch);

  await assert.rejects(provider.send(delivery), (error: unknown) =>
    expectDeliveryError(error, { outcome: "UNCONFIRMED", reason: "NETWORK_ERROR" })
  );
});

test("a response body that cannot be read is reported distinctly, and as unconfirmed", async () => {
  const provider = new TweetSmsOtpProvider(baseOptions, (async () =>
    ({
      status: 200,
      ok: true,
      text: async () => {
        throw new Error("stream closed");
      }
    }) as unknown as Response) as typeof fetch);

  await assert.rejects(provider.send(delivery), (error: unknown) =>
    expectDeliveryError(error, { outcome: "UNCONFIRMED", reason: "RESPONSE_READ_FAILED" })
  );
});

/*
 * Logging.
 *
 * Provider-supplied text is not redacted, it is never carried: nothing reads msg/message, so no
 * amount of hostile or unlucky provider wording can put an API key or an OTP in a log line.
 */

test("a hostile provider message cannot put the API key or the OTP into a log line", async () => {
  const echoed = JSON.stringify({
    status: "error",
    code: -110,
    msg: `Rejected api_key=${API_KEY} message="JOVO verification code: ${delivery.code}" to=+970591234567`,
    data: { message: `code ${delivery.code}`, api_key: API_KEY }
  });
  const { provider } = stubProvider(respondWith(200, echoed));

  const lines = await captureLogs(async () => {
    await provider.send(delivery).catch(() => undefined);
  });

  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.doesNotMatch(line, new RegExp(API_KEY));
  assert.doesNotMatch(line, new RegExp(delivery.code));
  assert.doesNotMatch(line, /Rejected|msg|api_key/);
  // The full phone number never appears either — only the mask.
  assert.doesNotMatch(line, /\+970591234567/);

  const logged = JSON.parse(line) as Record<string, unknown>;
  assert.deepEqual(Object.keys(logged).sort(), [
    "event",
    "httpStatus",
    "outcome",
    "phone",
    "providerCode",
    "purpose",
    "reason"
  ]);
  assert.equal(logged.providerCode, "-110");
  assert.equal(logged.reason, "AUTH_REJECTED");
  assert.equal(logged.phone, "+970***567");
});

test("every logged reason comes from the closed set, and every logged code is numeric or NONE", async () => {
  const bodies = [
    JSON.stringify({ status: "error", code: -110 }),
    JSON.stringify({ status: "error", code: "-3", msg: "whatever <script>" }),
    JSON.stringify({ code: 12345, msg: "surprise" }),
    JSON.stringify({ status: "success" }),
    "not json at all"
  ];

  for (const body of bodies) {
    const { provider } = stubProvider(respondWith(200, body));
    const lines = await captureLogs(async () => {
      await provider.send(delivery).catch(() => undefined);
    });
    const logged = JSON.parse(lines[0]) as { reason: string; providerCode: string };
    assert.ok(
      (tweetSmsFailureReasons as readonly string[]).includes(logged.reason),
      `unexpected reason ${logged.reason}`
    );
    assert.match(logged.providerCode, /^(?:-?\d{1,9}|NONE)$/);
  }
});

test("a successful send logs the status and the code, and nothing else", async () => {
  const { provider } = stubProvider(respondWith(200, JSON.stringify({ status: "success", code: 999 })));
  const lines = await captureLogs(async () => {
    await provider.send(delivery);
  });

  const logged = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.deepEqual(Object.keys(logged).sort(), [
    "event",
    "httpStatus",
    "phone",
    "providerCode",
    "purpose"
  ]);
  assert.equal(logged.providerCode, "999");
  assert.doesNotMatch(lines[0], new RegExp(delivery.code));
});

/* Request shaping and configuration. */

test("recipient formats cover the three shapes the gateway might want", () => {
  assert.equal(formatTweetSmsRecipient("+970591234567", "digits"), "970591234567");
  assert.equal(formatTweetSmsRecipient("+970591234567", "e164"), "+970591234567");
  assert.equal(formatTweetSmsRecipient("+970591234567", "local"), "0591234567");
  assert.equal(formatTweetSmsRecipient("+972591234567", "local"), "0591234567");
});

test("the default recipient format survives form encoding without a stray plus", async () => {
  const { provider, calls } = stubProvider(respondWith(200, JSON.stringify({ code: 999 })));
  await provider.send(delivery);
  assert.doesNotMatch(String(calls[0].init?.body), /to=\+/);

  const e164 = stubProvider(respondWith(200, JSON.stringify({ code: 999 })), { recipientFormat: "e164" });
  await e164.provider.send(delivery);
  // Percent-encoded, so a decoding gateway sees the plus and a naive one cannot mistake it for a space.
  assert.match(String(e164.calls[0].init?.body), /to=%2B970591234567/);
});

test("the message template must carry the code, and must fit one message", () => {
  assert.equal(renderTweetSmsMessage("code {{code}} only", "123456"), "code 123456 only");
  assert.throws(
    () => new TweetSmsOtpProvider({ ...baseOptions, messageTemplate: "No placeholder here" }),
    /\{\{code\}\}/
  );
  assert.throws(
    () => new TweetSmsOtpProvider({ ...baseOptions, messageTemplate: `{{code}} ${"x".repeat(200)}` }),
    /within 160/
  );
});

test("an unusable configuration fails at construction, before any request is possible", () => {
  assert.throws(() => new TweetSmsOtpProvider({ ...baseOptions, baseUrl: "http://tweetsms.ps/api.php" }), /HTTPS/);
  assert.throws(() => new TweetSmsOtpProvider({ ...baseOptions, apiKey: "   " }), /TWEETSMS_API_KEY/);
  assert.throws(() => new TweetSmsOtpProvider({ ...baseOptions, sender: "" }), /TWEETSMS_SENDER/);
  assert.throws(() => new TweetSmsOtpProvider({ ...baseOptions, timeoutMs: 0 }), /TWEETSMS_TIMEOUT_MS/);
});

test("interpretTweetSmsResponse carries no provider-supplied text at all", () => {
  const verdict = interpretTweetSmsResponse(
    200,
    JSON.stringify({ status: "error", code: -110, msg: `secret ${API_KEY} and code ${delivery.code}` })
  );
  assert.equal(verdict.accepted, false);
  assert.doesNotMatch(JSON.stringify(verdict), new RegExp(API_KEY));
  assert.doesNotMatch(JSON.stringify(verdict), new RegExp(delivery.code));
  assert.deepEqual(Object.keys(verdict).sort(), ["accepted", "outcome", "providerCode", "reason"]);
});

test("describeRequest is safe to print: no key, no code", () => {
  const { provider } = stubProvider(respondWith(200, JSON.stringify({ code: 999 })));
  const described = provider.describeRequest(delivery.phone);
  assert.equal(described.api_key, "[redacted]");
  assert.equal(described.to, "970591234567");
  assert.doesNotMatch(JSON.stringify(described), new RegExp(API_KEY));
});
