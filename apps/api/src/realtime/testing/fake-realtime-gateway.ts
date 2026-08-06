export type EmittedEvent = { room: string; event: string; payload: unknown };

/** A no-op stand-in for RealtimeGateway so domain-service unit tests never need a real socket.io server. */
export class FakeRealtimeGateway {
  readonly emitted: EmittedEvent[] = [];

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.emitted.push({ room: `user:${userId}`, event, payload });
  }

  emitToRestaurant(restaurantId: string, event: string, payload: unknown): void {
    this.emitted.push({ room: `restaurant:${restaurantId}`, event, payload });
  }

  emitToOrder(orderId: string, event: string, payload: unknown): void {
    this.emitted.push({ room: `order:${orderId}`, event, payload });
  }

  emitToAdmins(event: string, payload: unknown): void {
    this.emitted.push({ room: "admins", event, payload });
  }
}
