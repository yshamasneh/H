import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { AuthResult } from "./api";

export const accessTokenStorageKey = "wasel_access_token";
export const refreshTokenStorageKey = "wasel_refresh_token";

export function getAccessToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return Promise.resolve(readWebToken(accessTokenStorageKey));
  }
  return SecureStore.getItemAsync(accessTokenStorageKey);
}

export function getRefreshToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return Promise.resolve(readWebToken(refreshTokenStorageKey));
  }
  return SecureStore.getItemAsync(refreshTokenStorageKey);
}

export async function saveTokens(result: AuthResult): Promise<void> {
  if (Platform.OS === "web") {
    writeWebToken(accessTokenStorageKey, result.accessToken);
    writeWebToken(refreshTokenStorageKey, result.refreshToken);
    return;
  }
  await Promise.all([
    SecureStore.setItemAsync(accessTokenStorageKey, result.accessToken),
    SecureStore.setItemAsync(refreshTokenStorageKey, result.refreshToken)
  ]);
}

export async function clearTokens(): Promise<void> {
  if (Platform.OS === "web") {
    deleteWebToken(accessTokenStorageKey);
    deleteWebToken(refreshTokenStorageKey);
    return;
  }
  await Promise.all([
    SecureStore.deleteItemAsync(accessTokenStorageKey),
    SecureStore.deleteItemAsync(refreshTokenStorageKey)
  ]);
}

function readWebToken(key: string): string | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(key);
}

function writeWebToken(key: string, value: string): void {
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(key, value);
}

function deleteWebToken(key: string): void {
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(key);
}
