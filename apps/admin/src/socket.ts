import { useEffect } from "react";
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
