import { DevSettings, I18nManager, Platform } from "react-native";
import type { SupportedLanguage } from "../core/language";

const rtlLanguages: readonly SupportedLanguage[] = ["ar"];

export function isRTLLanguage(language: SupportedLanguage): boolean {
  return rtlLanguages.includes(language);
}

/**
 * Ensures I18nManager's RTL flag (and, on web, the document's dir/lang
 * attributes) match the given language.
 *
 * On native, I18nManager.forceRTL writes to a native-persisted setting but
 * does NOT re-layout already-created views (Yoga fixes layout direction at
 * view-creation time) — a full app reload is required, and returns true so
 * the caller can trigger one. Because the native setting survives the
 * reload, the fresh JS bundle boots with I18nManager.isRTL already correct
 * *before* any module-level styles evaluate, so this is a one-time cost.
 *
 * On web, react-native-web resolves logical style props (marginStart,
 * flexDirection: 'row', etc.) via the browser's own CSS bidi engine, which
 * repaints instantly from the `dir` attribute — applied here unconditionally
 * so mirroring is correct even during the moment before a reload lands.
 * But theme/typography.ts's `text()` helper also reads direction (via
 * theme/tokens.ts's `isRTL()`), synchronously, inside module-scope
 * StyleSheet.create() calls that every screen evaluates once at import time
 * — a reload is required here too, for the same reason as native: those
 * styles need to be rebuilt against the new direction from a clean module
 * evaluation, not patched live.
 *
 * react-native-web's I18nManager is a stub — allowRTL/forceRTL are no-ops
 * and isRTL is hardcoded to always return false (see
 * node_modules/react-native-web/dist/exports/I18nManager) — so it cannot be
 * used to detect "did the direction actually change" on web the way native
 * does. Comparing against the `dir` attribute's value *before* this call
 * overwrites it serves the same purpose and is what theme/tokens.ts's
 * `isRTL()` reads as its own source of truth on web, so the two stay
 * consistent. (A page reload is safe here because
 * src/i18n/rtl-preset.ts re-derives the correct direction from *stored*
 * language on the very next load, synchronously, before any module
 * evaluates — there is nothing left over from this call that the next load
 * depends on.)
 */
export function reconcileRTL(language: SupportedLanguage): boolean {
  const desiredRTL = isRTLLanguage(language);

  if (Platform.OS === "web") {
    if (typeof document === "undefined") return false;
    const currentRTL = document.documentElement.dir === "rtl";
    document.documentElement.dir = desiredRTL ? "rtl" : "ltr";
    document.documentElement.lang = language;
    return currentRTL !== desiredRTL;
  }

  if (I18nManager.isRTL === desiredRTL) return false;

  I18nManager.allowRTL(desiredRTL);
  I18nManager.forceRTL(desiredRTL);
  return true;
}

/**
 * Reloads the app so a just-applied I18nManager.forceRTL change takes visual
 * effect. On web this is a full page reload (equivalent to admin's instant
 * dir-attribute flip, since react-native-web re-resolves styles on remount).
 * On native this uses React Native's built-in DevSettings.reload(), which
 * Expo's custom dev client wires up in both dev and release-style builds
 * (unlike bare RN release builds, where DevSettings can be a no-op).
 */
export function reloadApp(): void {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.location.reload();
    return;
  }
  DevSettings.reload();
}
