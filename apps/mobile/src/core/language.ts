import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const languageStorageKey = "wasel_language";
export const supportedLanguages = ["ar", "en"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export async function getStoredLanguage(): Promise<SupportedLanguage | null> {
  const value = Platform.OS === "web" ? readWebLanguage() : await SecureStore.getItemAsync(languageStorageKey);
  return value === "ar" || value === "en" ? value : null;
}

export async function setStoredLanguage(language: SupportedLanguage): Promise<void> {
  if (Platform.OS === "web") {
    writeWebLanguage(language);
    return;
  }
  await SecureStore.setItemAsync(languageStorageKey, language);
}

function readWebLanguage(): string | null {
  return typeof localStorage === "undefined" ? null : localStorage.getItem(languageStorageKey);
}

function writeWebLanguage(value: string): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(languageStorageKey, value);
}
