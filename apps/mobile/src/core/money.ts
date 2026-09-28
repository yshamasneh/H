/**
 * Typed money, exactly: amounts are integer agorot, parsed digit by digit and formatted from
 * integers, so nothing a manager types can drift by an agora through float arithmetic.
 */

const arabicIndicZero = 0x0660;
const easternArabicIndicZero = 0x06f0;

/**
 * A typed amount ("12.5", "١٢٫٥٠") as agorot, or null. Parsed digit by digit, never via
 * `Number(text) * 100` (1.15 * 100 is 114.99999…). Anything ambiguous is refused, not guessed.
 */
export function parseMoneyToMinor(input: string): number | null {
  let text = "";
  for (const char of input.trim()) {
    const code = char.codePointAt(0)!;
    if (code >= arabicIndicZero && code <= arabicIndicZero + 9) text += String(code - arabicIndicZero);
    else if (code >= easternArabicIndicZero && code <= easternArabicIndicZero + 9) text += String(code - easternArabicIndicZero);
    else if (char === "٫" || char === ",") text += ".";
    else if (/\s/.test(char)) continue;
    else text += char;
  }
  const match = /^(\d*)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const [, whole = "", fraction = ""] = match;
  if (whole === "" && fraction === "") return null;
  if (fraction.length > 2) return null;
  const scaled = Number(`${whole || "0"}${fraction.padEnd(2, "0")}`);
  return Number.isSafeInteger(scaled) ? scaled : null;
}

/** Agorot as a plain editable amount: 32050 -> "320.50". */
export function formatMinorPlain(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const absolute = Math.abs(minor);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}
