import assert from "node:assert/strict";
import { test } from "node:test";
import { telUrl } from "./tel";

test("a registered number becomes a tel: link with the real number", () => {
  assert.equal(telUrl("+970591112233"), "tel:+970591112233");
});

test("spaces, dashes and brackets are dropped so the URL cannot be altered by formatting", () => {
  assert.equal(telUrl(" +970 (59) 111-2233 "), "tel:+970591112233");
  assert.equal(telUrl("0591112233"), "tel:0591112233");
});

test("anything that is not a usable number yields no link", () => {
  for (const bad of [null, undefined, "", "   ", "abc", "12", "+"]) {
    assert.equal(telUrl(bad), null, String(bad));
  }
});

test("characters that could smuggle in another scheme or command are removed", () => {
  assert.equal(telUrl("javascript:alert(1)"), null);
});
