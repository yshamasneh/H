/**
 * The public JOVO pages the stores require the app to link to (store audit B1–B3).
 * One constant so the app, the store listing and the review notes can never disagree.
 * The pages themselves live in docs/store/site/ and are hosted by the owner.
 */
export const legalLinks = {
  privacy: "https://jovops.com/privacy",
  terms: "https://jovops.com/terms",
  deleteAccount: "https://jovops.com/delete-account",
  support: "https://jovops.com/support"
} as const;

export type LegalLinkKey = keyof typeof legalLinks;
