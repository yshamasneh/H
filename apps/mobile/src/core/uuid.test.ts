import assert from "node:assert/strict";
import { test } from "node:test";
import { newUuid } from "./uuid";

const v4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("newUuid produces a valid RFC-4122 v4 UUID", () => {
  const value = newUuid();
  assert.match(value, v4Pattern);
});

test("newUuid values are unique across calls", () => {
  const keys = new Set(Array.from({ length: 1_000 }, () => newUuid()));
  assert.equal(keys.size, 1_000, "no collisions in 1000 keys");
});
