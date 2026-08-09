import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ar from "./locales/ar.json";
import en from "./locales/en.json";

export const supportedLanguages = ["ar", "en"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

const storageKey = "wasel-admin-language";
const defaultLanguage: SupportedLanguage = "ar";

function readStoredLanguage(): SupportedLanguage {
  const stored = window.localStorage.getItem(storageKey);
  return stored === "ar" || stored === "en" ? stored : defaultLanguage;
}

export function applyDirection(language: SupportedLanguage) {
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
}

export function setLanguage(language: SupportedLanguage) {
  window.localStorage.setItem(storageKey, language);
  void i18n.changeLanguage(language);
  applyDirection(language);
}

const initialLanguage = readStoredLanguage();
applyDirection(initialLanguage);

void i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en }
  },
  lng: initialLanguage,
  fallbackLng: "ar",
  interpolation: { escapeValue: false }
});

export default i18n;
