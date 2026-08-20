/**
 * RFC-4122 v4 UUID. Prefers a cryptographic source (`crypto.getRandomValues`) when the
 * runtime provides one and falls back to `Math.random` otherwise — adequate for an
 * idempotency key, whose only requirement is uniqueness per checkout attempt (not
 * unpredictability). Kept dependency-free so it works on Hermes without a native module.
 */
export function newUuid(): string {
  const bytes = new Uint8Array(16);
  const cryptoObj = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let index = 0; index < 16; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC-4122 variant
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return (
    `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}` +
    `-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`
  );
}
