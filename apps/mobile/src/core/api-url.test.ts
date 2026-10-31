import assert from "node:assert/strict";
import { test } from "node:test";
import { productionApiUrl, resolveApiBaseUrl } from "./api-url";

test("development bundles fall back to the local API per platform", () => {
  assert.equal(resolveApiBaseUrl({ configured: undefined, isDev: true, platform: "android" }), "http://10.0.2.2:3000");
  assert.equal(resolveApiBaseUrl({ configured: undefined, isDev: true, platform: "ios" }), "http://localhost:3000");
  assert.equal(resolveApiBaseUrl({ configured: "http://192.168.1.5:3000/", isDev: true, platform: "android" }), "http://192.168.1.5:3000");
});

test("a native release bundle accepts only the production API", () => {
  assert.equal(resolveApiBaseUrl({ configured: "https://api.jovops.com", isDev: false, platform: "android" }), productionApiUrl);
  assert.equal(resolveApiBaseUrl({ configured: "https://api.jovops.com/", isDev: false, platform: "ios" }), productionApiUrl);
  assert.throws(
    () => resolveApiBaseUrl({ configured: "https://staging.example.com", isDev: false, platform: "android" }),
    /Store builds must use https:\/\/api\.jovops\.com/
  );
});

test("a release bundle refuses missing, plain-HTTP, tunnel and local API URLs", () => {
  for (const platform of ["android", "ios", "web"]) {
    assert.throws(() => resolveApiBaseUrl({ configured: undefined, isDev: false, platform }), /HTTPS/);
    assert.throws(() => resolveApiBaseUrl({ configured: "http://api.jovops.com", isDev: false, platform }), /HTTPS/);
    assert.throws(() => resolveApiBaseUrl({ configured: "https://abc123.ngrok-free.app", isDev: false, platform }), /tunnel or local/);
    assert.throws(() => resolveApiBaseUrl({ configured: "https://localhost:3000", isDev: false, platform }), /tunnel or local/);
  }
});

test("the release web bundle keeps the HTTPS-only rule without pinning the host", () => {
  // CI builds the web bundle against a placeholder host; the web app is deployed separately.
  assert.equal(resolveApiBaseUrl({ configured: "https://app.example.test", isDev: false, platform: "web" }), "https://app.example.test");
});
