import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { corsAllowedMethods } from "./cors-methods";

/**
 * A route whose verb is not in the CORS list is unreachable from every browser client: the
 * preflight refuses it and the request never arrives, so nothing server-side reports the failure.
 * That is exactly how `PUT /driver/me/presence` — the driver presence heartbeat — was silently
 * blocked while curl kept working. This walks the controllers and fails if any verb they declare
 * is missing from the list.
 */
function controllerFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return entry === "generated" || entry === "node_modules" ? [] : controllerFiles(path);
    }
    return path.endsWith(".controller.ts") ? [path] : [];
  });
}

test("every HTTP verb the controllers declare is allowed through CORS", () => {
  const sourceRoot = join(__dirname, "..");
  const declared = new Set<string>();
  for (const file of controllerFiles(sourceRoot)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/@(Get|Post|Put|Patch|Delete|Head|Options)\s*\(/g)) {
      declared.add(match[1]!.toUpperCase());
    }
  }

  assert.ok(declared.size > 0, "no controller verbs were found — the scan is broken, not the config");
  assert.ok(declared.has("PUT"), "expected at least one PUT route (the driver presence heartbeat)");

  const allowed = new Set<string>(corsAllowedMethods);
  const missing = [...declared].filter((method) => !allowed.has(method)).sort();
  assert.deepEqual(missing, [], `these verbs are served but blocked by CORS: ${missing.join(", ")}`);
});
