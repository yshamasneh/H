import { useEffect } from "react";
import { AppState } from "react-native";
import { reportDriverPresence } from "../../core/api";
import { PresenceSession } from "../../core/presence-session";
import { getAccessToken } from "../../core/session";

async function sendPresence(state: "FOREGROUND" | "BACKGROUND" | "CLOSED"): Promise<void> {
  const accessToken = await getAccessToken();
  if (accessToken) await reportDriverPresence(accessToken, state);
}

// One session for the app, so logout can close exactly the one that is heartbeating.
let activeSession: PresenceSession | null = null;

/**
 * Keeps the server told that a signed-in driver's app is running. Mounted once at the app root with
 * the driver's id (or null for anyone else, which does nothing).
 */
export function useDriverPresence(driverUserId: string | null): void {
  useEffect(() => {
    if (!driverUserId) return;
    const session = new PresenceSession({
      send: sendPresence,
      schedule: (run, everyMs) => setInterval(run, everyMs),
      cancel: (handle) => clearInterval(handle as ReturnType<typeof setInterval>)
    });
    activeSession = session;
    session.onAppState(AppState.currentState);
    const subscription = AppState.addEventListener("change", (state) => session.onAppState(state));
    return () => {
      subscription.remove();
      session.stop();
      if (activeSession === session) activeSession = null;
    };
  }, [driverUserId]);
}

/** Logout: tell the server the app is closed before the session token is thrown away. */
export async function closeDriverPresence(): Promise<void> {
  await activeSession?.close();
}
