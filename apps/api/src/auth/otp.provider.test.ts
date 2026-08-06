import assert from "node:assert/strict";
import test from "node:test";
import { WebhookOtpProvider } from "./otp.provider";

test("webhook OTP provider sends the expected authenticated payload", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const provider = new WebhookOtpProvider(
    "https://messaging.example.com/otp",
    "secret-token",
    2_000,
    (async (url, init) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 202 } as Response;
    }) as typeof fetch
  );

  await provider.send({ phone: "+970590000000", purpose: "CUSTOMER_SIGNUP", code: "123456" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://messaging.example.com/otp");
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer secret-token");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    phone: "+970590000000",
    purpose: "CUSTOMER_SIGNUP",
    code: "123456"
  });
});

test("webhook OTP provider returns a sanitized error", async () => {
  const provider = new WebhookOtpProvider(
    "https://messaging.example.com/otp",
    "secret-token",
    2_000,
    (async () => ({ ok: false, status: 503 }) as Response) as typeof fetch
  );

  await assert.rejects(
    provider.send({ phone: "+970590000000", purpose: "PASSWORD_RESET", code: "987654" }),
    (error: Error) => error.message === "The OTP delivery service rejected the request with status 503."
  );
});
