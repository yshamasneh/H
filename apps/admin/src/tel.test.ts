import assert from "node:assert/strict";
import { test } from "node:test";
import { telHref } from "./tel";

test("a registered number becomes a tel: link with the real number", () => {
  assert.equal(telHref("+970591112233"), "tel:+970591112233");
  assert.equal(telHref(" +970 (59) 111-2233 "), "tel:+970591112233");
});

test("anything that is not a usable number yields no link", () => {
  for (const bad of [null, undefined, "", "  ", "abc", "12", "javascript:alert(1)"]) {
    assert.equal(telHref(bad), null, String(bad));
  }
});
