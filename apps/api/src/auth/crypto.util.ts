import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import type { OtpPurpose } from "../generated/prisma/enums";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1
  });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function hashOtp(
  secret: string,
  challengeId: string,
  phone: string,
  purpose: OtpPurpose,
  code: string
): string {
  return createHmac("sha256", secret)
    .update(`${challengeId}:${phone}:${purpose}:${code}`)
    .digest("hex");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) {
    return false;
  }
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
