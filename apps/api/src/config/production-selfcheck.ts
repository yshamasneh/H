import { s3StorageKeys, validateEnvironment } from "./environment";

/**
 * Run 3, task 5: what is still missing before NODE_ENV=production can be switched on.
 *
 * Reports variable NAMES only. Values are never printed: the validator's own error message is
 * passed through `redact`, which removes every current environment value from it.
 */
export type SelfCheck = { missing: string[]; validationError: string | null; readyForProduction: boolean };

const always = ["DATABASE_URL", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "OTP_HASH_SECRET", "CORS_ORIGIN", "MONITORING_TOKEN"];
const azure = ["AZURE_STORAGE_ACCOUNT_NAME", "AZURE_STORAGE_PUBLIC_CONTAINER_NAME", "AZURE_STORAGE_UPLOAD_CONTAINER_NAME"];

function present(env: Record<string, unknown>, key: string): boolean {
  const value = env[key];
  return typeof value === "string" ? value.trim() !== "" : value !== undefined && value !== null;
}

export function requiredProductionNames(env: Record<string, unknown>): string[] {
  const names = [...always];
  const otp = String(env.OTP_PROVIDER ?? "development");
  if (otp === "tweetsms") names.push("TWEETSMS_API_KEY", "TWEETSMS_SENDER");
  else if (otp === "webhook") names.push("OTP_WEBHOOK_URL", "OTP_WEBHOOK_TOKEN");
  else names.push("OTP_PROVIDER (tweetsms or webhook; development is refused)");
  if (!present(env, "APPLICATIONINSIGHTS_CONNECTION_STRING")) names.push("ERROR_TRACKING_WEBHOOK_URL");
  names.push(...(String(env.IMAGE_STORAGE_DRIVER ?? "azure") === "s3" ? [...s3StorageKeys] : azure));
  return names;
}

export function redact(message: string, env: Record<string, unknown>): string {
  let output = message;
  for (const value of Object.values(env)) {
    if (typeof value !== "string" || value.trim().length < 4) continue;
    output = output.split(value).join("[redacted]");
    for (const part of value.split(",").map((item) => item.trim()).filter((item) => item.length >= 4)) {
      output = output.split(part).join("[redacted]");
    }
  }
  return output;
}

export function productionSelfCheck(env: Record<string, unknown>): SelfCheck {
  const missing = requiredProductionNames(env).filter((name) => name.includes(" ") || !present(env, name));
  let validationError: string | null = null;
  try {
    validateEnvironment({ ...env, NODE_ENV: "production" });
  } catch (error) {
    validationError = redact((error as Error).message, env);
  }
  return { missing, validationError, readyForProduction: missing.length === 0 && validationError === null };
}

export function formatSelfCheck(result: SelfCheck): string {
  const lines = ["Production self-check (names only, no values):"];
  if (result.missing.length === 0) lines.push("  All required variables are present.");
  else for (const name of result.missing) lines.push(`  MISSING: ${name}`);
  lines.push(result.validationError ? `  NODE_ENV=production would refuse to start: ${result.validationError}` : "  NODE_ENV=production validation: passes.");
  lines.push(result.readyForProduction ? "  READY to switch NODE_ENV=production." : "  NOT READY to switch NODE_ENV=production.");
  return lines.join("\n");
}
