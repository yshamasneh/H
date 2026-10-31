/**
 * Which API a build talks to, and the release guard around it (store audit B5).
 *
 * Kept free of React Native imports so the plain node test runner can exercise every branch.
 * The value itself is read in api.ts as a plain `process.env.EXPO_PUBLIC_API_URL` member
 * expression, because babel-preset-expo only inlines that exact shape into release bundles.
 */

/** The only API a store (release) build of the native app may talk to. */
export const productionApiUrl = "https://api.jovops.com";

export type ApiUrlInput = {
  /** EXPO_PUBLIC_API_URL as inlined at bundle time (may be undefined). */
  configured: string | undefined;
  /** `__DEV__`: true for Metro/dev-client bundles, false for every release bundle. */
  isDev: boolean;
  /** Platform.OS. The web build is deployed separately and keeps the HTTPS-only rule. */
  platform: string;
};

/** Hosts that must never appear in a release bundle, whatever the platform. */
const forbiddenHostPatterns = [/ngrok/i, /localhost/i, /^127\./, /^10\./, /^192\.168\./, /^0\.0\.0\.0$/];

function developmentFallback(platform: string): string {
  return platform === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000";
}

/**
 * Returns the API base URL, or throws a descriptive error for a release bundle that would ship
 * with a missing, insecure, tunnelled or non-production API.
 *
 * - Development bundles: the configured value, or the local API.
 * - Release web bundles: must be HTTPS and not a tunnel/local host (the web app is hosted on its
 *   own domain and CI builds it against a placeholder host).
 * - Release native bundles (the store apps): must be exactly https://api.jovops.com.
 */
export function resolveApiBaseUrl(input: ApiUrlInput): string {
  const configured = input.configured?.trim().replace(/\/+$/, "") || undefined;
  if (input.isDev) return configured ?? developmentFallback(input.platform);

  if (!configured || !configured.startsWith("https://")) {
    throw new Error("Production builds require an HTTPS EXPO_PUBLIC_API_URL.");
  }
  let host: string;
  try {
    host = new URL(configured).hostname;
  } catch {
    throw new Error("Production builds require a valid EXPO_PUBLIC_API_URL.");
  }
  if (forbiddenHostPatterns.some((pattern) => pattern.test(host))) {
    throw new Error(`Release builds must not use a tunnel or local API host (${host}).`);
  }
  if ((input.platform === "android" || input.platform === "ios") && configured !== productionApiUrl) {
    throw new Error(`Store builds must use ${productionApiUrl} as EXPO_PUBLIC_API_URL (got ${host}).`);
  }
  return configured;
}
