import * as SecureStore from "expo-secure-store";
import type { AuthResult } from "./api";

export const accessTokenStorageKey = "wasel_access_token";
export const refreshTokenStorageKey = "wasel_refresh_token";

export function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(accessTokenStorageKey);
}

export function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(refreshTokenStorageKey);
}

export async function saveTokens(result: AuthResult): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(accessTokenStorageKey, result.accessToken),
    SecureStore.setItemAsync(refreshTokenStorageKey, result.refreshToken)
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(accessTokenStorageKey),
    SecureStore.deleteItemAsync(refreshTokenStorageKey)
  ]);
}
