import i18n from "../i18n";
import { ApiError } from "./api";

/**
 * The one place a request failure becomes user-facing copy. Every screen
 * used to do `error.message` directly, which is the raw English string
 * apps/api sends — correct in English, wrong (silently) inside the Arabic
 * UI. `ApiError.code` is stable and language-independent, so it is looked up
 * in the `errors` namespace first; a code not yet catalogued there falls
 * back to the server's own message rather than a dead end, and anything
 * that isn't an ApiError at all (network failure, thrown `Error`) falls back
 * further to a localized generic message.
 */
export function readError(error: unknown): string {
  if (error instanceof ApiError) {
    // A validation failure ("VALIDATION_ERROR") carries a generic top-level `message` and the real,
    // field-level reasons in `details` as `[{ field, messages }]`. Those specifics are the most
    // useful thing to show; only when there are none do we fall back to a translated code, then the
    // server's own message.
    const detail = validationDetail(error.details);
    if (detail) return detail;
    const translated = i18n.t(`errors:${error.code}`, { defaultValue: "" });
    return translated || error.message;
  }
  if (error instanceof Error) return error.message;
  return i18n.t("common:requestFailed");
}

/** The joined field-level messages of a validation error, or null when the error has none. */
function validationDetail(details: unknown): string | null {
  if (!Array.isArray(details)) return null;
  const messages: string[] = [];
  for (const entry of details) {
    if (entry && typeof entry === "object" && Array.isArray((entry as { messages?: unknown }).messages)) {
      for (const message of (entry as { messages: unknown[] }).messages) {
        if (typeof message === "string" && message.trim()) messages.push(message.trim());
      }
    }
  }
  return messages.length > 0 ? messages.join(" ") : null;
}
