import assert from "node:assert/strict";
import { test } from "node:test";
import {
  logoutWithPushCleanup,
  reconcilePushTokenForUser,
  type LogoutWithPushCleanupDeps,
  type PushReconciliationDeps
} from "./push-token-lifecycle";

test("reconciliation registers the installation for the authenticated user", async () => {
  const registrations: Array<{ accessToken: string; token: string; platform: string }> = [];
  const associations: Array<{ token: string; userId: string }> = [];
  const deps: PushReconciliationDeps = {
    isPushEnabled: async () => true,
    getDevicePushToken: async () => "ExponentPushToken[installation-1]",
    registerPushToken: async (accessToken, token, platform) => {
      registrations.push({ accessToken, token, platform });
    },
    storePushAssociation: async (token, userId) => {
      associations.push({ token, userId });
    }
  };

  assert.equal(await reconcilePushTokenForUser("access-b", "user-b", "android", deps), true);
  assert.deepEqual(registrations, [
    { accessToken: "access-b", token: "ExponentPushToken[installation-1]", platform: "android" }
  ]);
  assert.deepEqual(associations, [
    { token: "ExponentPushToken[installation-1]", userId: "user-b" }
  ]);
});

test("reconciliation does nothing when notifications were not enabled on this installation", async () => {
  let calls = 0;
  const deps: PushReconciliationDeps = {
    isPushEnabled: async () => false,
    getDevicePushToken: async () => {
      calls += 1;
      return "unused";
    },
    registerPushToken: async () => {
      calls += 1;
    },
    storePushAssociation: async () => {
      calls += 1;
    }
  };

  assert.equal(await reconcilePushTokenForUser("access", "user", "ios", deps), false);
  assert.equal(calls, 0);
});

test("an unregister network failure never prevents remote or local logout cleanup", async () => {
  const calls: string[] = [];
  const deps: LogoutWithPushCleanupDeps = {
    getAccessToken: async () => "access-a",
    getStoredPushToken: async () => "ExponentPushToken[installation-1]",
    unregisterPushToken: async () => {
      calls.push("unregister");
      throw new Error("offline");
    },
    logoutRemote: async () => {
      calls.push("remote-logout");
      throw new Error("still offline");
    },
    clearPushAssociation: async () => {
      calls.push("clear-push-association");
    },
    clearSession: async () => {
      calls.push("clear-session");
    }
  };

  await logoutWithPushCleanup(deps);
  assert.deepEqual(calls, ["unregister", "remote-logout", "clear-push-association", "clear-session"]);
});

test("logout unregisters the current token before revoking the authenticated session", async () => {
  const calls: string[] = [];
  await logoutWithPushCleanup({
    getAccessToken: async () => "access-a",
    getStoredPushToken: async () => "ExponentPushToken[installation-1]",
    unregisterPushToken: async () => {
      calls.push("unregister");
    },
    logoutRemote: async () => {
      calls.push("remote-logout");
    },
    clearPushAssociation: async () => {
      calls.push("clear-push-association");
    },
    clearSession: async () => {
      calls.push("clear-session");
    }
  });

  assert.deepEqual(calls, ["unregister", "remote-logout", "clear-push-association", "clear-session"]);
});
