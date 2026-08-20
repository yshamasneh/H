import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { AuthResult, PublicUser } from "./api";
import { createCartRepository } from "./cart-storage";
import { kvStore } from "./kv-storage";

export const accessTokenStorageKey = "wasel_access_token";
export const refreshTokenStorageKey = "wasel_refresh_token";
export const cachedUserStorageKey = "wasel_cached_user";

/**
 * Persistent cart storage (M-3). Kept next to the token helpers because it shares the same
 * platform-aware backing store and the same "clear on logout" lifecycle.
 */
export const cartRepository = createCartRepository(kvStore, (message, detail) => {
  console.warn(`[cart] ${message}`, detail);
});

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
    await saveCachedUser(result.user);
    return;
  }
  await Promise.all([
    SecureStore.setItemAsync(accessTokenStorageKey, result.accessToken),
    SecureStore.setItemAsync(refreshTokenStorageKey, result.refreshToken),
    saveCachedUser(result.user)
  ]);
}

export async function clearTokens(): Promise<void> {
  // A logout / dead session must not leave the cart or the cached identity behind.
  await Promise.all([cartRepository.clear(), clearCachedUser()]);
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

/**
 * The last authenticated user, cached locally so a launch that cannot reach the server
 * (airplane mode, backend outage) can still show the user their home instead of logging
 * them out. It is identity-only (id/name/phone/role) — never a credential.
 */
export async function saveCachedUser(user: PublicUser): Promise<void> {
  const value = JSON.stringify(user);
  if (Platform.OS === "web") {
    writeWebToken(cachedUserStorageKey, value);
    return;
  }
  await SecureStore.setItemAsync(cachedUserStorageKey, value);
}

export async function getCachedUser(): Promise<PublicUser | null> {
  const raw = Platform.OS === "web"
    ? readWebToken(cachedUserStorageKey)
    : await SecureStore.getItemAsync(cachedUserStorageKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PublicUser;
    return parsed && typeof parsed.id === "string" && typeof parsed.role === "string" ? parsed : null;
  } catch {
    return null;
  }
}

async function clearCachedUser(): Promise<void> {
  if (Platform.OS === "web") {
    deleteWebToken(cachedUserStorageKey);
    return;
  }
  await SecureStore.deleteItemAsync(cachedUserStorageKey);
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
