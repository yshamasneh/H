import { createReconnectResync, type ResyncTimers } from "./reconnect-resync";

export type OrderSubscriptionSocket = {
  emit(event: string, payload: unknown): unknown;
  on(event: string, handler: (payload: unknown) => void): unknown;
  off(event: string, handler: (payload: unknown) => void): unknown;
};

export function attachOrderSubscription(
  activeSocket: OrderSubscriptionSocket,
  orderId: string,
  onChange: (payload: unknown) => void,
  options: { resync?: { debounceMs?: number; timers?: ResyncTimers } } = {}
): () => void {
  const orderChanged = (payload: unknown) => {
    if ((payload as { orderId?: string } | null)?.orderId === orderId) onChange(payload);
  };
  const deliveryChanged = (payload: unknown) => onChange(payload);

  activeSocket.emit("order.subscribe", { orderId });
  activeSocket.on("order.status.changed", orderChanged);
  activeSocket.on("order.fulfillment.changed", orderChanged);
  activeSocket.on("delivery.status.changed", deliveryChanged);

  // On reconnect, re-join the room (the socket id changed) and refetch once to reconcile
  // anything missed while disconnected (M-5). Debounced against reconnect flapping; the
  // very first `connect` is skipped since the screen already loaded on mount.
  const resync = createReconnectResync(() => {
    activeSocket.emit("order.subscribe", { orderId });
    onChange({ reason: "reconnect", orderId });
  }, options.resync);
  const onConnect = () => resync.onConnect();
  activeSocket.on("connect", onConnect);

  return () => {
    resync.cancel();
    activeSocket.off("connect", onConnect);
    activeSocket.off("order.status.changed", orderChanged);
    activeSocket.off("order.fulfillment.changed", orderChanged);
    activeSocket.off("delivery.status.changed", deliveryChanged);
  };
}
