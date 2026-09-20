/**
 * Validation for an image URL supplied by a person or a file (a product, a logo, an offer).
 *
 * A picture may come from two places, and both are first-class:
 *  - the application's own upload service (an Azure blob URL), or
 *  - a plain external URL, which is how a catalogue of thousands of products with pictures
 *    already hosted elsewhere gets imported without uploading them one by one.
 *
 * So the rule is about the URL being *safe to hand to a customer's phone*, not about where it came
 * from. It has to be an https URL (a customer app will not, and should not, load mixed content),
 * carry no embedded credentials, and have a real host name. This does not fetch the URL: whether
 * the picture actually loads is the client's business, and every place that renders one already
 * falls back to a placeholder when it does not.
 */

import { ApiException } from "./api.exception";

export const maxImageUrlLength = 2048;

export type ImageUrlProblem = "TOO_LONG" | "NOT_A_URL" | "NOT_HTTPS" | "HAS_CREDENTIALS" | "BAD_HOST" | "SIGNED_URL";

const problemMessages: Record<ImageUrlProblem, string> = {
  TOO_LONG: `The image URL is longer than ${maxImageUrlLength} characters.`,
  NOT_A_URL: "The image URL is not a valid URL.",
  NOT_HTTPS: "The image URL must start with https://.",
  HAS_CREDENTIALS: "The image URL must not contain a username or password.",
  BAD_HOST: "The image URL must point to a real host name.",
  SIGNED_URL:
    "The image URL is a temporary signed link (it carries a secret and will stop working). Use the permanent public URL instead."
};

export function imageUrlProblemMessage(problem: ImageUrlProblem): string {
  return problemMessages[problem];
}

/** Null when the URL is acceptable, otherwise why it is not. Empty input is the caller's business. */
export function checkImageUrl(value: string): ImageUrlProblem | null {
  const url = value.trim();
  if (url.length > maxImageUrlLength) return "TOO_LONG";
  // Whitespace or control characters inside a URL are never legitimate and are how header/markup
  // injection gets smuggled through a "URL" field.
  if (/[\s\u0000-\u001f\u007f]/.test(url)) return "NOT_A_URL";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "NOT_A_URL";
  }
  if (parsed.protocol !== "https:") return "NOT_HTTPS";
  if (parsed.username || parsed.password) return "HAS_CREDENTIALS";
  // A dotted name, or an IP literal. Bare names such as "localhost" or "intranet" are not something
  // a customer's phone can reach.
  const host = parsed.hostname;
  const isIpLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
  if (!host || (!host.includes(".") && !isIpLiteral) || host.startsWith(".") || host.endsWith(".")) return "BAD_HOST";
  if (isSignedUrl(parsed)) return "SIGNED_URL";
  return null;
}

/**
 * A signed link (Azure SAS, S3/CloudFront presigned) embeds a credential in its query string and
 * expires. Persisting one would both leak the credential to every customer and leave the product
 * with a picture that silently dies.
 */
function isSignedUrl(url: URL): boolean {
  const names = new Set([...url.searchParams.keys()].map((name) => name.toLowerCase()));
  return (
    (names.has("sig") && (names.has("sv") || names.has("se") || names.has("sp") || names.has("sr"))) ||
    names.has("x-amz-signature") ||
    names.has("x-goog-signature") ||
    (names.has("signature") && (names.has("expires") || names.has("keyid") || names.has("key-pair-id")))
  );
}

/**
 * Validate an image URL that a person or file is setting on a product, logo or offer.
 *
 * Uploaded pictures and plain external URLs are both accepted, whether or not managed storage is
 * configured: a catalogue of thousands of products whose pictures are already hosted elsewhere has
 * to be importable by URL, and refusing a URL merely because it did not come from the uploader
 * would make that impossible. Only `checkImageUrl`'s safety rules apply.
 *
 * Clearing the field, and re-saving the URL a record already has, are always allowed, so an older
 * record whose URL predates these rules can still be edited for unrelated reasons.
 * `purpose` / `restaurantId` are accepted and ignored: the call sites pass them from the time when
 * ownership was decided here (it still is, for *deleting* a stored blob, in `assertOwnedUrl`).
 */
export function assertAllowedImageUrl(input: {
  previousUrl?: string | null;
  nextUrl?: string | null;
  purpose?: unknown;
  restaurantId?: unknown;
}): void {
  const next = input.nextUrl?.trim() || null;
  const previous = input.previousUrl?.trim() || null;
  if (!next || next === previous) return;
  const problem = checkImageUrl(next);
  if (problem) throw new ApiException(400, "INVALID_IMAGE_URL", imageUrlProblemMessage(problem), { problem });
}
