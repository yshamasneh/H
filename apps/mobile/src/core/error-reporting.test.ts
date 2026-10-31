import assert from "node:assert/strict";
import { test } from "node:test";
import { buildErrorReport, createErrorReporter, isValidReportEndpoint, sanitizeText } from "./error-reporting";

test("without an endpoint nothing is ever sent", () => {
  const sent: unknown[] = [];
  const reporter = createErrorReporter({ endpoint: null, appVersion: "1", platform: "android", send: async (_url, report) => sent.push(report) });
  reporter.report(new Error("boom"));
  assert.equal(reporter.enabled, false);
  assert.equal(sent.length, 0);
  assert.equal(isValidReportEndpoint("http://insecure.example.test"), false);
  assert.equal(isValidReportEndpoint("not a url"), false);
});

test("a configured HTTPS endpoint receives a minimal report", () => {
  const sent: Array<{ url: string; report: unknown }> = [];
  const reporter = createErrorReporter({
    endpoint: "https://errors.example.test/ingest",
    appVersion: "0.17.0",
    platform: "android",
    send: async (url, report) => sent.push({ url, report }),
    now: () => new Date("2026-11-01T00:00:00Z")
  });
  reporter.report(new TypeError("cannot read x"), { fatal: true, context: "checkout" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://errors.example.test/ingest");
  const report = sent[0].report as Record<string, unknown>;
  assert.equal(report.name, "TypeError");
  assert.equal(report.fatal, true);
  assert.equal(report.context, "checkout");
  assert.deepEqual(Object.keys(report).sort(), ["appVersion", "at", "context", "fatal", "message", "name", "platform", "stack"]);
});

test("phone numbers and bearer tokens are masked; the reporter caps itself and never throws", () => {
  assert.equal(sanitizeText("call +970 59 123 4567 now"), "call [number] now");
  assert.equal(sanitizeText("Authorization: Bearer abc.def-123"), "Authorization: Bearer [redacted]");
  const report = buildErrorReport("plain string", { fatal: false, appVersion: "1", platform: "ios", now: new Date(0) });
  assert.equal(report.message, "plain string");
  let calls = 0;
  const reporter = createErrorReporter({
    endpoint: "https://errors.example.test",
    appVersion: "1",
    platform: "web",
    send: async () => {
      calls += 1;
      throw new Error("network down");
    }
  });
  for (let index = 0; index < 50; index += 1) reporter.report(new Error(`e${index}`));
  assert.equal(calls, 20);
});
