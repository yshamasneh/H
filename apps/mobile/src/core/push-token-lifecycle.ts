export type PushPlatform = "android" | "ios" | "web";

export type PushReconciliationDeps = {
  isPushEnabled: () => Promise<boolean>;
  getDevicePushToken: () => Promise<string>;
  registerPushToken: (accessToken: string, token: string, platform: PushPlatform) => Promise<unknown>;
  storePushAssociation: (token: string, userId: string) => Promise<void>;
};

export async function reconcilePushTokenForUser(
  accessToken: string,
  userId: string,
  platform: PushPlatform,
  deps: PushReconciliationDeps
): Promise<boolean> {
  if (!(await deps.isPushEnabled())) return false;

  const token = await deps.getDevicePushToken();
  await deps.registerPushToken(accessToken, token, platform);
  await deps.storePushAssociation(token, userId);
  return true;
}

export type LogoutWithPushCleanupDeps = {
  getAccessToken: () => Promise<string | null>;
  getStoredPushToken: () => Promise<string | null>;
  unregisterPushToken: (accessToken: string, token: string) => Promise<unknown>;
  logoutRemote: (accessToken: string) => Promise<unknown>;
  clearPushAssociation: () => Promise<void>;
  clearSession: () => Promise<void>;
};

/**
 * Removes the current installation from the authenticated account before revoking the session.
 * Both network operations are best-effort: local credentials and local push ownership are always
 * cleared, so an offline API cannot trap a user in the signed-in state.
 */
export async function logoutWithPushCleanup(deps: LogoutWithPushCleanupDeps): Promise<void> {
  const accessToken = await deps.getAccessToken().catch(() => null);
  const pushToken = await deps.getStoredPushToken().catch(() => null);

  if (accessToken && pushToken) {
    await deps.unregisterPushToken(accessToken, pushToken).catch(() => undefined);
  }
  if (accessToken) {
    await deps.logoutRemote(accessToken).catch(() => undefined);
  }

  await deps.clearPushAssociation().catch(() => undefined);
  await deps.clearSession();
}
