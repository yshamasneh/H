/**
 * Restricted-product screening for the JOVO catalogue (store audit H6).
 *
 * Tobacco, nicotine, vaping and alcohol are not part of the launch: Google Play does not allow apps
 * that facilitate the sale of tobacco or nicotine products (Restricted Content policy, with only a
 * narrow age-gated grocery exception) and Apple 1.4.3 forbids encouraging their consumption. This
 * module decides, from a product's or category's text, whether it is:
 *
 *   BLOCKED  an unambiguous restricted product: the API refuses to create or rename it into one;
 *   REVIEW   ambiguous (a word with innocent uses, or an "alcohol-free" claim): it may be saved, but
 *            hidden from customers until a person reviews it and makes it available;
 *   ALLOWED  nothing restricted was found.
 *
 * Matching is by whole word, after normalising Arabic (diacritics, tatweel, alef/yaa/taa-marbuta
 * forms) and stripping common Arabic prefixes (ال، و، ب، ف، ل، ك), so "مدخن" (smoked) or "ginger"
 * never match "دخان" or "gin". It is pure and has no database access.
 */

export type RestrictedVerdict = "ALLOWED" | "REVIEW" | "BLOCKED";
export type RestrictedClassification = { verdict: RestrictedVerdict; matches: string[] };

type TermGroup = { kind: "tobacco" | "alcohol"; terms: string[] };

const blockedGroups: TermGroup[] = [
  {
    kind: "tobacco",
    terms: [
      // English
      "tobacco", "cigarette", "cigarettes", "cigar", "cigars", "cigarillo", "cigarillos", "nicotine",
      "vape", "vapes", "vaping", "vaper", "ecig", "ecigs", "e cig", "e cigarette", "e cigarettes", "eliquid",
      "e liquid", "e juice", "snus", "nicotine pouch", "nicotine pouches", "marlboro", "winston", "lucky strike",
      "pall mall", "rothmans", "dunhill", "gauloises", "iqos", "heets", "terea", "juul", "relx",
      // Arabic
      "دخان", "سجائر", "سجاير", "سيجاره", "سيجار", "سيجارات", "تبغ", "تمباك", "تنباك", "معسل", "نيكوتين",
      "فيب", "فيبات", "سيجاره الكترونيه", "مارلبورو", "وينستون", "ايكوس", "هيتس"
    ]
  },
  {
    kind: "alcohol",
    terms: [
      // English
      "beer", "beers", "lager", "wine", "wines", "vodka", "whisky", "whiskey", "tequila", "brandy", "cognac",
      "liqueur", "champagne", "arak", "arrack", "ouzo", "bourbon", "gin", "alcoholic", "spirits",
      // Arabic
      "نبيذ", "خمر", "خمور", "ويسكي", "فودكا", "كونياك", "شمبانيا", "براندي", "تكيلا", "مشروب كحولي", "مشروبات كحوليه"
    ]
  }
];

/** Words with real innocent uses in a supermarket: never blocked, always sent to a person. */
const reviewTerms = [
  // English
  "alcohol", "rum", "scotch", "malt", "hookah", "shisha", "narghile", "argileh", "davidoff",
  // Arabic: بيرة is also the name of non-alcoholic malt drinks; عرق also means sweat/vein; كحول is
  // also rubbing alcohol and hand sanitiser; شيشة/أرجيلة are the pipe and its charcoal.
  "بيره", "عرق", "كحول", "كحولي", "شيشه", "ارجيله", "نرجيله"
];

/**
 * Common grocery phrases that contain a review word but are known to be harmless: deodorant
 * ("مزيل عرق"), antiperspirant, and the licorice drink ("عرق سوس"). Removed before the review check
 * only; they never hide a blocked term.
 */
const harmlessPhrases = ["مزيل عرق", "مزيلات عرق", "مزيل للعرق", "مضاد للتعرق", "عرق سوس", "عرقسوس"];

/** An explicit alcohol-free claim turns an alcohol match into REVIEW (e.g. "non-alcoholic beer"). */
const alcoholFreePhrases = [
  "non alcoholic", "alcohol free", "zero alcohol", "0 0", "0 alcohol", "without alcohol",
  "بدون كحول", "خالي من الكحول", "خال من الكحول", "غير كحولي", "خالي من الكحول تماما"
];

const arabicPrefixes = ["وال", "بال", "فال", "كال", "لل", "ال", "و", "ب", "ف", "ل", "ك"];

/** Lower-cases, folds Arabic letter variants and removes diacritics/tatweel and punctuation. */
export function normaliseForScreening(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const normalisedGroups = blockedGroups.map((group) => ({
  kind: group.kind,
  terms: group.terms.map(normaliseForScreening)
}));
const normalisedReview = reviewTerms.map(normaliseForScreening);
const normalisedAlcoholFree = alcoholFreePhrases.map(normaliseForScreening);
const normalisedHarmless = harmlessPhrases.map(normaliseForScreening);

function withoutHarmlessPhrases(text: string): string {
  let padded = ` ${text} `;
  for (const phrase of normalisedHarmless) {
    for (const prefix of ["", ...arabicPrefixes]) padded = padded.split(` ${prefix}${phrase} `).join(" ");
  }
  return padded.trim().replace(/\s+/g, " ");
}

/** Each token, plus each Arabic token with one leading prefix removed (when 3+ letters remain). */
function tokenVariants(text: string): Set<string> {
  const variants = new Set<string>();
  for (const token of text.split(" ")) {
    if (!token) continue;
    variants.add(token);
    if (/[؀-ۿ]/.test(token)) {
      for (const prefix of arabicPrefixes) {
        if (token.startsWith(prefix) && token.length - prefix.length >= 3) variants.add(token.slice(prefix.length));
      }
    }
  }
  return variants;
}

function hasTerm(text: string, tokens: Set<string>, term: string): boolean {
  if (!term.includes(" ")) return tokens.has(term);
  // Multi-word phrases match on word boundaries within the normalised text, with and without an
  // Arabic prefix on the first word.
  const padded = ` ${text} `;
  if (padded.includes(` ${term} `)) return true;
  return arabicPrefixes.some((prefix) => padded.includes(` ${prefix}${term} `));
}

/** Classifies a product or category from all of its customer-visible text (name, brand, description...). */
export function classifyRestricted(...fields: Array<string | null | undefined>): RestrictedClassification {
  const text = normaliseForScreening(fields.filter((field): field is string => Boolean(field)).join(" \n "));
  if (!text) return { verdict: "ALLOWED", matches: [] };
  const tokens = tokenVariants(text);
  const alcoholFree = normalisedAlcoholFree.some((phrase) => hasTerm(text, tokens, phrase));

  const blocked: string[] = [];
  const review: string[] = [];
  for (const group of normalisedGroups) {
    for (const term of group.terms) {
      if (!hasTerm(text, tokens, term)) continue;
      if (group.kind === "alcohol" && alcoholFree) review.push(term);
      else blocked.push(term);
    }
  }
  const reviewText = withoutHarmlessPhrases(text);
  const reviewTokens = tokenVariants(reviewText);
  for (const term of normalisedReview) {
    if (hasTerm(reviewText, reviewTokens, term)) review.push(term);
  }

  if (blocked.length > 0) return { verdict: "BLOCKED", matches: unique(blocked) };
  if (review.length > 0) return { verdict: "REVIEW", matches: unique(review) };
  return { verdict: "ALLOWED", matches: [] };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
