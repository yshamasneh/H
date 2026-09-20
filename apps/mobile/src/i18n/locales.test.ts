import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// Both languages fall back to Arabic and an untranslated key renders as the key itself (see
// i18n/index.ts), so a string added to one language and forgotten in the other shows the driver
// or customer a raw "earnings.owed.label". English and Arabic must define the same keys.
//
// Plural forms differ by language (English has one/other, Arabic six), so a plural family
// ("orders_one", "orders_other", ...) counts as one key.
const root = path.resolve(__dirname, "locales");
const pluralSuffix = /_(zero|one|two|few|many|other)$/;

function keysOf(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix.replace(pluralSuffix, "")];
  return Object.entries(value).flatMap(([key, child]) => keysOf(child, prefix ? `${prefix}.${key}` : key));
}

function namespaces(language: string): string[] {
  return readdirSync(path.join(root, language)).filter((file) => file.endsWith(".json")).sort();
}

test("English and Arabic ship the same set of namespaces", () => {
  assert.deepEqual(namespaces("en"), namespaces("ar"));
});

for (const file of namespaces("en")) {
  test(`${file}: every English key has an Arabic translation, and the reverse`, () => {
    const load = (language: string) =>
      new Set(keysOf(JSON.parse(readFileSync(path.join(root, language, file), "utf8"))));
    const en = load("en");
    const ar = load("ar");
    assert.deepEqual([...en].filter((key) => !ar.has(key)), [], "missing from Arabic");
    assert.deepEqual([...ar].filter((key) => !en.has(key)), [], "missing from English");
  });
}

test("Arabic plural families carry every form the language needs", () => {
  const ar = JSON.parse(readFileSync(path.join(root, "ar", "driver.json"), "utf8"));
  for (const form of ["zero", "one", "two", "few", "many", "other"]) {
    assert.ok(`orders_${form}` in ar.earnings.owed, `earnings.owed.orders_${form} is missing`);
  }
});
