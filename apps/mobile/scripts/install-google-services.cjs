#!/usr/bin/env node
/**
 * Store audit H3: Android push (FCM) wiring that never breaks a build.
 *
 * If the EAS file variable GOOGLE_SERVICES_JSON is set (EAS gives file variables to the build as a
 * path), the file is copied to android/app/google-services.json, where android/app/build.gradle
 * applies the Google Services plugin only when that file exists. With no variable and no file the
 * build continues exactly as before (push stays unavailable on Android, as today).
 *
 * Never prints the file's contents. Only checks that it is JSON for the expected package name.
 *
 * Owner steps: docs/release-readiness/technical-analyses.md#h3 and owner-action-items.md.
 */
const fs = require("node:fs");
const path = require("node:path");

const expectedPackage = "com.jovo.app";
const target = path.join(__dirname, "..", "android", "app", "google-services.json");

function main() {
  const source = (process.env.GOOGLE_SERVICES_JSON ?? "").trim();
  if (!source) {
    console.log(
      fs.existsSync(target)
        ? "[google-services] using the existing android/app/google-services.json."
        : "[google-services] GOOGLE_SERVICES_JSON is not set: building without Firebase (Android push disabled)."
    );
    return 0;
  }
  if (!fs.existsSync(source)) {
    console.error("[google-services] GOOGLE_SERVICES_JSON points to a file that does not exist.");
    return 1;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(source, "utf8"));
  } catch {
    console.error("[google-services] GOOGLE_SERVICES_JSON is not valid JSON.");
    return 1;
  }
  const packages = (parsed.client ?? []).map((client) => client?.client_info?.android_client_info?.package_name);
  if (!packages.includes(expectedPackage)) {
    console.error(`[google-services] the file has no Android client for ${expectedPackage}.`);
    return 1;
  }
  fs.copyFileSync(source, target);
  console.log(`[google-services] installed for ${expectedPackage}.`);
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { main, target, expectedPackage };
