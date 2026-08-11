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
 * repaints instantly from the `dir` attribute with no reload needed — and
 * critically, forceRTL's in-memory JS flag does NOT persist across a hard
 * page reload the way native's does, so auto-reloading here would loop.
 * We therefore apply the dir/lang attributes directly and never signal a
 * reload on web.
 */
export function reconcileRTL(language: SupportedLanguage): boolean {
  const desiredRTL = isRTLLanguage(language);

  if (Platform.OS === "web") {
    if (typeof document !== "undefined") {
      document.documentElement.dir = desiredRTL ? "rtl" : "ltr";
      document.documentElement.lang = language;
    }
    I18nManager.allowRTL(desiredRTL);
    I18nManager.forceRTL(desiredRTL);
    return false;
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
