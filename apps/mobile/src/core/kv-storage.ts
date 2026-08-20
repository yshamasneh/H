import AsyncStorage from "@react-native-async-storage/async-storage";
import type { KeyValueStore } from "./cart-storage";

/**
 * Key-value store for non-secret, potentially-large client state (the cart).
 *
 * Backed by AsyncStorage rather than SecureStore: SecureStore caps a value at ~2KB on
 * Android, which a real grocery basket blows past at ~13-15 items (worse with Arabic
 * names, 2 bytes/char in UTF-8) — it would fail to persist exactly the large carts M-3
 * exists to protect, and silently. AsyncStorage has no such limit (~6MB on Android) and
 * ships a web implementation over localStorage, so one backing store covers every
 * platform. Tokens stay in SecureStore (session.ts); only this non-secret state moved.
 */
export const kvStore: KeyValueStore = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key)
};
