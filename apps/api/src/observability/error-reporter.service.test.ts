import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ConfigService } from "@nestjs/config";
import { parseAppInsightsConnectionString } from "./app-insights";
import { ErrorReporterService } from "./error-reporter.service";

const connectionString =
  "InstrumentationKey=00000000-1111-2222-3333-444444444444;IngestionEndpoint=https://uaenorth-0.in.applicationinsights.azure.com/;LiveEndpoint=https://uaenorth.livediagnostics.monitor.azure.com/";
const context = { requestId: "req-123", method: "POST", path: "/api/v1/admin/diagnostics/test-error", statusCode: 500 };
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function reporter(settings: Record<string, string>) {
  const config = { get: (key: string, fallback?: unknown) => settings[key] ?? fallback } as unknown as ConfigService;
  return new ErrorReporterService(config);
}

function recordFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return calls;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("a connection string yields the key and a slash-terminated HTTPS ingestion endpoint", () => {
  assert.deepEqual(parseAppInsightsConnectionString(connectionString), {
    instrumentationKey: "00000000-1111-2222-3333-444444444444",
    ingestionEndpoint: "https://uaenorth-0.in.applicationinsights.azure.com/"
  });
  assert.equal(
    parseAppInsightsConnectionString("InstrumentationKey=k;IngestionEndpoint=https://x.example.com")?.ingestionEndpoint,
    "https://x.example.com/"
  );
});

test("a malformed or non-HTTPS connection string counts as not configured", () => {
  for (const value of [undefined, "", "InstrumentationKey=k", "IngestionEndpoint=https://x.example.com/", "InstrumentationKey=k;IngestionEndpoint=http://x.example.com/", "InstrumentationKey=k;IngestionEndpoint=not a url"]) {
    assert.equal(parseAppInsightsConnectionString(value), null, String(value));
  }
});

test("a 5xx is sent to Application Insights as exception telemetry carrying the request id", async () => {
  const calls = recordFetch();
  reporter({ APPLICATIONINSIGHTS_CONNECTION_STRING: connectionString, NODE_ENV: "development", APP_VERSION: "abc123" })
    .capture(new Error("connect failed postgresql://jovo:s3cret-pass@db.example.com/jovo"), context);
  await flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://uaenorth-0.in.applicationinsights.azure.com/v2/track");
  const [envelope] = JSON.parse(String(calls[0].init.body));
  assert.equal(envelope.name, "Microsoft.ApplicationInsights.Exception");
  assert.equal(envelope.iKey, "00000000-1111-2222-3333-444444444444");
  assert.equal(envelope.tags["ai.operation.id"], "req-123");
  assert.equal(envelope.tags["ai.application.ver"], "abc123");
  assert.equal(envelope.data.baseType, "ExceptionData");
  assert.equal(envelope.data.baseData.properties.requestId, "req-123");
  assert.equal(envelope.data.baseData.properties.statusCode, "500");
  assert.doesNotMatch(envelope.data.baseData.exceptions[0].message, /s3cret-pass/, "credentials are redacted exactly as for the webhook");
});

test("both destinations receive the error when both are configured, and neither when none is", async () => {
  const calls = recordFetch();
  reporter({
    APPLICATIONINSIGHTS_CONNECTION_STRING: connectionString,
    ERROR_TRACKING_WEBHOOK_URL: "https://errors.example.com/events",
    ERROR_TRACKING_TOKEN: "token"
  }).capture(new Error("boom"), context);
  await flush();
  assert.deepEqual(calls.map((call) => new URL(call.url).hostname).sort(), ["errors.example.com", "uaenorth-0.in.applicationinsights.azure.com"]);

  calls.length = 0;
  reporter({}).capture(new Error("boom"), context);
  await flush();
  assert.equal(calls.length, 0);
});

test("a tracking outage never throws into the request path", async () => {
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  assert.doesNotThrow(() => reporter({ APPLICATIONINSIGHTS_CONNECTION_STRING: connectionString }).capture(new Error("boom"), context));
  await flush();
});
