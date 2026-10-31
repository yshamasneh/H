const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");

const script = path.join(__dirname, "check-release-env.cjs");
function run(env, args = []) {
  const clean = { ...process.env };
  delete clean.EXPO_PUBLIC_API_URL;
  delete clean.EAS_BUILD_PROFILE;
  return spawnSync(process.execPath, [script, ...args], { env: { ...clean, ...env }, encoding: "utf8" });
}

test("a production build fails loudly without the exact production API URL", () => {
  for (const value of [undefined, "", "http://api.jovops.com", "https://abc.ngrok-free.app", "https://staging.jovops.com", "https://api.jovops.com.evil.test"]) {
    const result = run(value === undefined ? { EAS_BUILD_PROFILE: "production" } : { EAS_BUILD_PROFILE: "production", EXPO_PUBLIC_API_URL: value });
    assert.equal(result.status, 1, `accepted ${value}`);
    assert.match(result.stderr, /FAIL/);
  }
});

test("the exact production URL (with or without a trailing slash) passes", () => {
  assert.equal(run({ EAS_BUILD_PROFILE: "production", EXPO_PUBLIC_API_URL: "https://api.jovops.com" }).status, 0);
  assert.equal(run({ EAS_BUILD_PROFILE: "production", EXPO_PUBLIC_API_URL: "https://api.jovops.com/" }).status, 0);
  assert.equal(run({ EXPO_PUBLIC_API_URL: "https://api.jovops.com" }, ["--profile", "production"]).status, 0);
});

test("non-production profiles are not pinned", () => {
  assert.equal(run({ EAS_BUILD_PROFILE: "preview", EXPO_PUBLIC_API_URL: "https://abc.ngrok-free.app" }).status, 0);
});
