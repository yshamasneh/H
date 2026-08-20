/**
 * Pure, injectable reload decision (M-4). Extracted so the "which reload path, and what if
 * it isn't available?" logic can be unit-tested without the native `expo-updates` module —
 * rtl.ts wires this to `Updates.reloadAsync()` and `window.location.reload()`.
 */
export type ReloadDeps = {
  platformOS: string;
  /** Web reload (synchronous page reload). */
  reloadWeb: () => void;
  /** Native reload — `Updates.reloadAsync()`. May reject when OTA/updates aren't available. */
  reloadNative: () => Promise<void>;
};

/**
 * Reloads the app so a just-applied RTL/direction change actually re-mirrors the UI.
 * Returns `true` if a reload was initiated (on native the process restarts, so code after
 * the call never runs), or `false` if no reload mechanism was available — the caller then
 * asks the user to restart manually rather than leaving the UI half-mirrored silently.
 */
export async function performReload(deps: ReloadDeps): Promise<boolean> {
  if (deps.platformOS === "web") {
    deps.reloadWeb();
    return true;
  }
  try {
    await deps.reloadNative();
    return true;
  } catch {
    return false;
  }
}
