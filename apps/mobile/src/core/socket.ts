import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";
import { apiBaseUrl } from "./api";
import { getAccessToken } from "./session";
import { attachOrderSubscription } from "./order-subscription";

let socket: Socket | null = null;
let socketToken: string | null = null;

/**
 * REST stays the source of truth (see docs/architecture.md). A socket event only ever means
 * "something changed, go re-fetch" - screens never trust the event payload as final state.
 */
async function connect(): Promise<Socket | null> {
  const token = await getAccessToken();
  if (!token) return null;
  if (socket && socket.connected && socketToken === token) return socket;
  if (socket) socket.disconnect();
  socketToken = token;
  socket = io(apiBaseUrl, { auth: { token }, transports: ["websocket"] });
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
  socketToken = null;
}

export function useRealtimeEvent(event: string, handler: (payload: unknown) => void): void {
  useEffect(() => {
    let activeSocket: Socket | null = null;
    let cancelled = false;

    connect().then((instance) => {
      if (cancelled || !instance) return;
      activeSocket = instance;
      instance.on(event, handler);
    });

    return () => {
      cancelled = true;
      activeSocket?.off(event, handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);
}

export function useOrderRealtime(orderId: string, onChange: (payload: unknown) => void): void {
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    connect().then((instance) => {
      if (cancelled || !instance) return;
      cleanup = attachOrderSubscription(instance, orderId, onChange);
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // The screen owns the refresh callback; resubscription is required only when the order changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);
}
