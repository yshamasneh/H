import { I18nManager, Platform } from "react-native";
import { languageStorageKey, supportedLanguages, type SupportedLanguage } from "../core/language";

/**
 * Import this module FIRST, before anything else, in index.ts.
 *
 * theme/typography.ts's `text()` is called inside module-scope
 * `StyleSheet.create()` blocks, which every screen evaluates once at
 * import time — before React ever mounts. `text()` reads `I18nManager.isRTL`
 * synchronously, so whatever that flag is *at import time* is what every
 * screen's font family, line height and letter spacing permanently bake in
 * as, on that page load.
 *
 * On native this is safe: I18nManager's native module syncs `isRTL` from a
 * persisted setting before the JS bundle starts executing at all, so it is
 * already correct by the time any module evaluates (see rtl.ts's
 * `reconcileRTL`, which native relies on the exact same guarantee for).
 *
 * On web there is no such native pre-sync — I18nManager starts at its
 * hardcoded default (false) on every single page load, and is normally only
 * corrected inside App.tsx's boot effect, which runs *after* every screen
 * module has already been imported and its styles already built. The result
 * is silent: layout still mirrors correctly (that's driven by the `dir`
 * attribute, read live by the browser's CSS engine), but every screen's
 * Arabic text renders in Inter instead of Cairo, at English line-height and
 * letter-spacing, forever, without ever throwing an error.
 *
 * This mirrors reconcileRTL's own web branch (same storage key, same
 * "ar" default as src/i18n/index.ts's `defaultLanguage`) but runs
 * synchronously and early enough to matter.
 */
if (Platform.OS === "web") {
  const stored = typeof localStorage === "undefined" ? null : localStorage.getItem(languageStorageKey);
  const language: SupportedLanguage = (supportedLanguages as readonly string[]).includes(stored ?? "")
    ? (stored as SupportedLanguage)
    : "ar";
  const isRTL = language === "ar";

  if (typeof document !== "undefined") {
    document.documentElement.dir = isRTL ? "rtl" : "ltr";
    document.documentElement.lang = language;
  }
  I18nManager.allowRTL(isRTL);
  I18nManager.forceRTL(isRTL);
}
