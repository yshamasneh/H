import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// Store audit H7: restaurants are not part of JOVO v1. No customer-, driver- or store-staff-facing
// string may mention restaurants or meals. The admin namespace is an internal operations tool and
// keeps the accurate "Restaurant" business-type label for businesses of that type.
const root = path.resolve(__dirname, "locales");
const namespaces = ["auth", "cart", "common", "customer", "driver", "errors", "notifications", "restaurantOps"];
const forbidden = /restaurant|مطعم|مطاعم|وجبة|وجبات/i;

function strings(value: unknown, prefix = ""): Array<[string, string]> {
  if (typeof value === "string") return [[prefix, value.replace(/\{\{[^}]+\}\}/g, "")]];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => strings(child, prefix ? `${prefix}.${key}` : key));
}

for (const language of ["en", "ar"]) {
  for (const namespace of namespaces) {
    test(`${language}/${namespace}.json has no restaurant copy`, () => {
      const data = JSON.parse(readFileSync(path.join(root, language, `${namespace}.json`), "utf8"));
      const offending = strings(data).filter(([, value]) => forbidden.test(value)).map(([key]) => key);
      assert.deepEqual(offending, []);
    });
  }
}
