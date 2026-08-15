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
    const translated = i18n.t(`errors:${error.code}`, { defaultValue: "" });
    return translated || error.message;
  }
  if (error instanceof Error) return error.message;
  return i18n.t("common:requestFailed");
}
