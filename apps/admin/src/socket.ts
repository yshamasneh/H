import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { apiBaseUrl, getAccessToken } from "./api";

let socket: Socket | null = null;

/**
 * REST stays the source of truth. Socket events are only ever used as a "something changed,
 * go re-fetch" signal, never trusted as the final state on their own — matching the pattern
 * documented in apps/api's architecture.md and already used by the mobile app.
 */
export function getSocket(): Socket | null {
  const token = getAccessToken();
  if (!token) return null;
  if (socket && socket.connected) return socket;
  if (socket) {
    socket.disconnect();
  }
  socket = io(apiBaseUrl, { auth: { token }, transports: ["websocket", "polling"] });
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

export function useRealtimeEvent(event: string, handler: (payload: unknown) => void): void {
  useEffect(() => {
    const activeSocket = getSocket();
    if (!activeSocket) return;
    activeSocket.on(event, handler);
    return () => {
      activeSocket.off(event, handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);
}

/**
 * Keeps a live view fresh through every path a signal can arrive or fail to arrive.
 *
 * A socket is the fast path, not the reliable one: a dropped connection would otherwise silently
 * stop new orders appearing, which on a kitchen screen is indistinguishable from a quiet evening.
 * So the refresh is also triggered on reconnect and on tab focus, and polled regardless. At this
 * volume the poll costs one small request per tab per interval and converts "the socket died and
 * nobody noticed" into a delay measured in seconds.
 */
export function useLiveRefresh(
  events: string[],
  refresh: () => void,
  pollIntervalMs = 30_000
): void {
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    const run = () => latest.current();
    const activeSocket = getSocket();

    for (const event of events) activeSocket?.on(event, run);
    activeSocket?.on("connect", run);

    const onFocus = () => run();
    const onVisibility = () => {
      if (document.visibilityState === "visible") run();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(run, pollIntervalMs);

    return () => {
      for (const event of events) activeSocket?.off(event, run);
      activeSocket?.off("connect", run);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.join(","), pollIntervalMs]);
}
