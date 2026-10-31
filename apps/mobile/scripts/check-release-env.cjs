#!/usr/bin/env node
/**
 * Build-time guard for store builds (store audit B5).
 *
 * EAS runs the `eas-build-pre-install` npm script at the start of every cloud or local EAS build,
 * with the EAS environment's variables already in process.env. For the `production` profile this
 * refuses to continue unless EXPO_PUBLIC_API_URL is exactly the production API, so a build can never
 * be produced against ngrok, localhost, plain HTTP or a staging host.
 *
 * Only the URL's host is printed — never the value of any other variable.
 *
 * Usage outside EAS: `node scripts/check-release-env.cjs --profile production`
 */
const productionApiUrl = "https://api.jovops.com";

function argProfile() {
  const index = process.argv.indexOf("--profile");
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const profile = argProfile() ?? process.env.EAS_BUILD_PROFILE;
if (profile !== "production") {
  console.log(`[check-release-env] profile "${profile ?? "none"}": no production API pin enforced.`);
  process.exit(0);
}

const configured = (process.env.EXPO_PUBLIC_API_URL ?? "").trim().replace(/\/+$/, "");
let host = "(unset)";
try {
  if (configured) host = new URL(configured).host;
} catch {
  host = "(invalid URL)";
}

if (configured !== productionApiUrl) {
  console.error(
    `[check-release-env] FAIL: production builds must set EXPO_PUBLIC_API_URL=${productionApiUrl} ` +
      `in the EAS "production" environment (found host: ${host}).`
  );
  process.exit(1);
}
console.log(`[check-release-env] OK: production build uses ${productionApiUrl}.`);
