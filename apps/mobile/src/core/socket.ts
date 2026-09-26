import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";
import { apiBaseUrl } from "./api";
import { getAccessToken } from "./session";
import { attachOrderSubscription } from "./order-subscription";

let socket: Socket | null = null;

/**
 * REST stays the source of truth (see docs/architecture.md). A socket event only ever means
 * "something changed, go re-fetch" - screens never trust the event payload as final state.
 */
async function connect(): Promise<Socket | null> {
  const token = await getAccessToken();
  if (!token) return null;
  // Reuse a socket that is connected OR still connecting. Checking `connected` alone made the second
  // hook mounting in the same tick (e.g. the store's alert host and the screen under it) tear down
  // the socket the first had just created, orphaning its listeners — the same bug the admin console
  // fixed in its own getSocket(). A rotated access token is not a reason to replace it either: the
  // `auth` callback below already hands every (re)connection the current token. Sign-out calls
  // disconnectSocket().
  if (socket && (socket.connected || socket.active)) return socket;
  if (socket) socket.disconnect();
  // `auth` is a function so socket.io's own automatic reconnects (after an API restart or a network
  // drop) present the current token rather than the one captured here, which may have rotated.
  const created = io(apiBaseUrl, {
    auth: (callback) => {
      void getAccessToken().then((current) => callback({ token: current ?? "" }), () => callback({ token: "" }));
    },
    transports: ["websocket"]
  });
  // A refusal from the server is never retried by socket.io itself; retry with backoff while
  // signed in (the live queue's REST poll refreshes the token in the meantime).
  let retryMs = 2_000;
  created.on("connect", () => {
    retryMs = 2_000;
  });
  created.on("disconnect", (reason) => {
    if (reason !== "io server disconnect") return;
    setTimeout(() => {
      void getAccessToken().then((current) => {
        if (socket === created && current) created.connect();
      });
    }, retryMs);
    retryMs = Math.min(retryMs * 2, 30_000);
  });
  socket = created;
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
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
