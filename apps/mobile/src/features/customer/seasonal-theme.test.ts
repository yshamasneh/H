import assert from "node:assert/strict";
import test from "node:test";
import { customerPresets, resolveCustomerPreset } from "./seasonal-theme";

test("production defaults to normal and ignores every development override", () => {
  for (const preview of customerPresets) {
    assert.equal(resolveCustomerPreset(undefined, preview, false), "normal");
    assert.equal(resolveCustomerPreset("ramadan", preview, false), "ramadan");
  }
  assert.equal(resolveCustomerPreset("Ramadan", "newYear", false), "normal");
});

test("only explicitly valid presets activate; development can preview normal too", () => {
  for (const preset of customerPresets) {
    assert.equal(resolveCustomerPreset(preset, undefined, false), preset);
    assert.equal(resolveCustomerPreset("ramadan", preset, true), preset);
  }
  assert.equal(resolveCustomerPreset(undefined, "invalid", true), "normal");
  assert.equal(resolveCustomerPreset("newYear", "invalid", true), "newYear");
});
