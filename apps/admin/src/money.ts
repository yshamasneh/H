/**
 * Money and percentage handling for every form in the console.
 *
 * Amounts are integer minor units (agorot) everywhere. Parsing is done on the text, digit by digit,
 * never through `Number(text) * 100`: that product is a float, and `1.15 * 100` is `114.99999…`,
 * which is exactly the kind of one-agora drift a ledger cannot afford. Nothing in here can round.
 *
 * Input is forgiving about *script*, not about *meaning*: Arabic-Indic digits and the Arabic
 * decimal separator are accepted because the keyboard in front of an Arabic-language operator
 * produces them, but anything ambiguous (three decimals, two separators, letters) is refused
 * rather than guessed at.
 */

const arabicIndicZero = 0x0660;
const easternArabicIndicZero = 0x06f0;

/** Latin digits and a plain "." — whatever script the operator typed in. */
export function normalizeNumberInput(input: string): string {
  let out = "";
  for (const char of input.trim()) {
    const code = char.codePointAt(0)!;
    if (code >= arabicIndicZero && code <= arabicIndicZero + 9) out += String(code - arabicIndicZero);
    else if (code >= easternArabicIndicZero && code <= easternArabicIndicZero + 9) {
      out += String(code - easternArabicIndicZero);
    } else if (char === "٫" || char === ",") out += ".";
    else if (char === "−") out += "-"; // the typographic minus some keyboards produce
    else if (/\s/.test(char)) continue;
    else out += char;
  }
  return out;
}

/**
 * Parse a decimal with at most `decimals` places into an integer scaled by 10^decimals, or null.
 * `allowNegative` admits a leading "-"; zero is always accepted here and left to the caller.
 */
export function parseScaledDecimal(
  input: string,
  decimals: number,
  options: { allowNegative?: boolean } = {}
): number | null {
  const text = normalizeNumberInput(input);
  const match = /^([+-])?(\d*)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const [, sign, whole = "", fraction = ""] = match;
  if (whole === "" && fraction === "") return null;
  if (fraction.length > decimals) return null;
  if (sign === "-" && !options.allowNegative) return null;
  const scaled = Number(`${whole || "0"}${fraction.padEnd(decimals, "0")}`);
  if (!Number.isSafeInteger(scaled)) return null;
  return sign === "-" ? -scaled : scaled;
}

/** "12.5" -> 1250. Null for anything that is not a plain amount with at most two decimals. */
export function parseMoneyToMinor(input: string, options: { allowNegative?: boolean } = {}): number | null {
  return parseScaledDecimal(input, 2, options);
}

/** A strictly positive amount, or null. The common case: a payout, a cost, a correction line. */
export function parsePositiveMoneyToMinor(input: string): number | null {
  const minor = parseMoneyToMinor(input);
  return minor !== null && minor > 0 ? minor : null;
}

/** "18" -> 1800, "18.5" -> 1850 basis points. Null outside 0..100 or with more than two decimals. */
export function parsePercentToBp(input: string): number | null {
  const bp = parseScaledDecimal(input, 2);
  return bp !== null && bp >= 0 && bp <= 10_000 ? bp : null;
}

/** A whole number of at least `min`, or null. Text like "2.5" or "1e3" is not a whole number. */
export function parseWholeNumber(input: string, min = 0): number | null {
  const text = normalizeNumberInput(input);
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= min ? value : null;
}

/** Minor units to a readable amount. One conversion, at the edge, so nothing rounds twice. */
export function formatMinor(amountMinor: number): string {
  const sign = amountMinor < 0 ? "-" : "";
  const absolute = Math.abs(amountMinor);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

/** Basis points as a percentage, e.g. 2000 -> "20%". */
export function formatBp(bp: number): string {
  const percent = bp / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}

/** The value a text box should start with for a stored amount: 15000 -> "150.00". */
export function toMoneyInput(amountMinor: number): string {
  return formatMinor(amountMinor);
}

/** The value a text box should start with for stored basis points: 1850 -> "18.5", 2000 -> "20". */
export function toPercentInput(bp: number): string {
  const percent = bp / 100;
  return Number.isInteger(percent) ? String(percent) : String(Number(percent.toFixed(2)));
}
