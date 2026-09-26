/**
 * Normalizes Arabic text so cosmetic letter-form and diacritic differences never cause a real
 * match to be missed by the trigram search (see restaurants.service.ts's getSupermarketCatalog).
 * Applied identically on both sides: once here, on the user's typed search term, and once at
 * index-build/query time by the matching SQL function `jovo_normalize_arabic_text()` created in
 * the pg_trgm migration — the two must never drift apart, or a term normalized one way here would
 * stop matching text normalized a different way in Postgres.
 *
 * - Unifies every alef form (أ إ آ ٱ) to the bare alef (ا): a customer typing the easy/bare form
 *   must still find products whose name was entered with the hamza'd/madda form, and vice versa.
 * - Normalizes taa marbuta (ة) to haa (ه): the two are pronounced identically and are routinely
 *   swapped by typists. This is a deliberate, one-way choice (not a reversible transliteration) —
 *   applied consistently, it just means the two letters are never distinguished for matching.
 * - Strips tashkeel (diacritics: fatha, damma, kasra, shadda, sukun, tanween, superscript alef) —
 *   marks almost never typed into a search box but sometimes present in seeded product names.
 * - Lower-cases the result too, so a mixed Arabic/Latin name (a common brand-name pattern) keeps
 *   the case-insensitive matching the old `contains(..., mode: "insensitive")` search provided,
 *   now that a raw-SQL trigram comparison is doing the matching instead.
 */
const tashkeel = /[ً-ْٰ]/g;
const alefForms = /[أإآٱ]/g;
const taaMarbuta = /ة/g;

export function normalizeArabicText(input: string): string {
  return input
    .replace(tashkeel, "")
    .replace(alefForms, "ا")
    .replace(taaMarbuta, "ه")
    .toLowerCase();
}
