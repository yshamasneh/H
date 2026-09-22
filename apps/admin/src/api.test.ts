import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, readApiError } from "./api";

test("a validation error surfaces its field-level reasons, not the generic top-level message", () => {
  const error = new ApiError(400, "VALIDATION_ERROR", "Please check the submitted information.", [
    { field: "priceMinor", messages: ["priceMinor must not be greater than 100000000"] }
  ]);
  assert.equal(readApiError(error, "fallback"), "priceMinor must not be greater than 100000000");
});

test("multiple field messages are joined into one line", () => {
  const error = new ApiError(400, "VALIDATION_ERROR", "Please check the submitted information.", [
    { field: "name", messages: ["name should not be empty"] },
    { field: "priceMinor", messages: ["priceMinor must be an integer number"] }
  ]);
  assert.equal(
    readApiError(error, "fallback"),
    "name should not be empty priceMinor must be an integer number"
  );
});

test("a coded error without field details keeps its own message", () => {
  const error = new ApiError(409, "CASH_SETTLEMENT_DUPLICATE", "This handover has already been recorded.");
  assert.equal(readApiError(error, "fallback"), "This handover has already been recorded.");
});

test("anything that is not an ApiError uses the caller's localized fallback", () => {
  assert.equal(readApiError(new Error("raw network glitch"), "fallback"), "fallback");
  assert.equal(readApiError({ nope: true }, "fallback"), "fallback");
});
