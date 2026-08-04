const requiredSecrets = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "OTP_HASH_SECRET"] as const;

export function validateEnvironment(input: Record<string, unknown>): Record<string, unknown> {
  const environment = { ...input };
  const nodeEnv = readString(environment, "NODE_ENV", "development");
  const otpProvider = readString(environment, "OTP_PROVIDER", "development");

  if (!readString(environment, "DATABASE_URL", "")) {
    throw new Error("DATABASE_URL is required");
  }

  for (const key of requiredSecrets) {
    const value = readString(environment, key, "");
    if (value.length < 32) {
      throw new Error(`${key} must contain at least 32 characters`);
    }
  }

  if (nodeEnv === "production" && otpProvider === "development") {
    throw new Error("OTP_PROVIDER=development is forbidden when NODE_ENV=production");
  }

  if (otpProvider !== "development") {
    throw new Error(`Unsupported OTP_PROVIDER: ${otpProvider}`);
  }

  environment.NODE_ENV = nodeEnv;
  environment.OTP_PROVIDER = otpProvider;
  environment.PORT = readPositiveInteger(environment, "PORT", 3000);
  environment.JWT_ACCESS_EXPIRATION_SECONDS = readPositiveInteger(environment, "JWT_ACCESS_EXPIRATION_SECONDS", 900);
  environment.JWT_REFRESH_EXPIRATION_DAYS = readPositiveInteger(environment, "JWT_REFRESH_EXPIRATION_DAYS", 30);
  environment.OTP_EXPIRATION_MINUTES = readPositiveInteger(environment, "OTP_EXPIRATION_MINUTES", 5);
  environment.OTP_RESEND_COOLDOWN_SECONDS = readPositiveInteger(environment, "OTP_RESEND_COOLDOWN_SECONDS", 60);
  environment.OTP_MAX_ATTEMPTS = readPositiveInteger(environment, "OTP_MAX_ATTEMPTS", 5);
  environment.PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES = readPositiveInteger(
    environment,
    "PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES",
    10
  );
  return environment;
}

function readString(input: Record<string, unknown>, key: string, fallback: string): string {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readPositiveInteger(input: Record<string, unknown>, key: string, fallback: number): number {
  const rawValue = input[key];
  const value = typeof rawValue === "number" ? rawValue : Number(rawValue ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}
