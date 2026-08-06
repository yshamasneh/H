import assert from "node:assert/strict";
import test from "node:test";
import { redact, redactText } from "./structured-logger";

test("structured log redaction hides nested secrets without mutating safe metadata", () => {
  const result = redact({
    requestId: "req-1",
    authorization: "Bearer very-secret-token",
    nested: { password: "Secret@123", statusCode: 500 }
  });
  assert.deepEqual(result, {
    requestId: "req-1",
    authorization: "[REDACTED]",
    nested: { password: "[REDACTED]", statusCode: 500 }
  });
});

test("free-text redaction removes bearer credentials and database passwords", () => {
  const result = redactText("Bearer abc.def postgres://user:database-password@db:5432/app\nforged");
  assert.equal(result, "Bearer [REDACTED] postgres://user:[REDACTED]@db:5432/app forged");
});
