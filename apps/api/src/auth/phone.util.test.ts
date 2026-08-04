import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiException } from "../common/api.exception";
import { normalizePhoneNumber } from "./phone.util";

test("accepts and normalizes a valid +970 number", () => {
  assert.equal(normalizePhoneNumber("+970", "0591234567"), "+970591234567");
});

test("accepts and normalizes a valid +972 number", () => {
  assert.equal(normalizePhoneNumber("+972", "0591234567"), "+972591234567");
});

test("rejects unsupported country codes", () => {
  assert.throws(() => normalizePhoneNumber("+1", "2025550100"), hasCode("UNSUPPORTED_COUNTRY_CODE"));
});

test("removes exactly one leading local zero", () => {
  assert.equal(normalizePhoneNumber("+970", "0590000000"), "+970590000000");
});

test("rejects invalid phone numbers", () => {
  assert.throws(() => normalizePhoneNumber("+970", "123"), hasCode("INVALID_PHONE_NUMBER"));
  assert.throws(() => normalizePhoneNumber("+972", "phone"), hasCode("INVALID_PHONE_NUMBER"));
});

test("normalizes equivalent written forms to the same E.164 value", () => {
  const variants = ["059 123 4567", "059-123-4567", "+970591234567", "970591234567"];
  assert.deepEqual(
    variants.map((value) => normalizePhoneNumber("+970", value)),
    variants.map(() => "+970591234567")
  );
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) =>
    error instanceof ApiException &&
    (error.getResponse() as { code?: string }).code === code;
}
