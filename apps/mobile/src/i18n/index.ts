import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { getStoredLanguage, setStoredLanguage, supportedLanguages, type SupportedLanguage } from "../core/language";
import arAdmin from "./locales/ar/admin.json";
import arAuth from "./locales/ar/auth.json";
import arCart from "./locales/ar/cart.json";
import arCommon from "./locales/ar/common.json";
import arCustomer from "./locales/ar/customer.json";
import arDriver from "./locales/ar/driver.json";
import arNotifications from "./locales/ar/notifications.json";
import arRestaurantOps from "./locales/ar/restaurantOps.json";
import enAdmin from "./locales/en/admin.json";
import enAuth from "./locales/en/auth.json";
import enCart from "./locales/en/cart.json";
import enCommon from "./locales/en/common.json";
import enCustomer from "./locales/en/customer.json";
import enDriver from "./locales/en/driver.json";
import enNotifications from "./locales/en/notifications.json";
import enRestaurantOps from "./locales/en/restaurantOps.json";

export { supportedLanguages, type SupportedLanguage };

const defaultLanguage: SupportedLanguage = "ar";

void i18n.use(initReactI18next).init({
  resources: {
    ar: {
      common: arCommon,
      admin: arAdmin,
      auth: arAuth,
      customer: arCustomer,
      cart: arCart,
      restaurantOps: arRestaurantOps,
      driver: arDriver,
      notifications: arNotifications
    },
    en: {
      common: enCommon,
      admin: enAdmin,
      auth: enAuth,
      customer: enCustomer,
      cart: enCart,
      restaurantOps: enRestaurantOps,
      driver: enDriver,
      notifications: enNotifications
    }
  },
  lng: defaultLanguage,
  fallbackLng: "ar",
  defaultNS: "common",
  interpolation: { escapeValue: false }
});

/**
 * Resolves which language the app should be running as: the user's stored
 * choice if one exists, otherwise Arabic. Does not touch I18nManager —
 * callers combine this with `reconcileRTL` during boot.
 */
export async function resolveInitialLanguage(): Promise<SupportedLanguage> {
  const stored = await getStoredLanguage();
  return stored ?? defaultLanguage;
}

export async function changeLanguage(language: SupportedLanguage): Promise<void> {
  await setStoredLanguage(language);
  await i18n.changeLanguage(language);
}

export default i18n;
