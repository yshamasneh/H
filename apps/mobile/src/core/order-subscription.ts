export type OrderSubscriptionSocket = {
  emit(event: string, payload: unknown): unknown;
  on(event: string, handler: (payload: unknown) => void): unknown;
  off(event: string, handler: (payload: unknown) => void): unknown;
};

export function attachOrderSubscription(
  activeSocket: OrderSubscriptionSocket,
  orderId: string,
  onChange: (payload: unknown) => void
): () => void {
  const orderChanged = (payload: unknown) => {
    if ((payload as { orderId?: string } | null)?.orderId === orderId) onChange(payload);
  };
  const deliveryChanged = (payload: unknown) => onChange(payload);

  activeSocket.emit("order.subscribe", { orderId });
  activeSocket.on("order.status.changed", orderChanged);
  activeSocket.on("order.fulfillment.changed", orderChanged);
  activeSocket.on("delivery.status.changed", deliveryChanged);

  return () => {
    activeSocket.off("order.status.changed", orderChanged);
    activeSocket.off("order.fulfillment.changed", orderChanged);
    activeSocket.off("delivery.status.changed", deliveryChanged);
  };
}
