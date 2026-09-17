import type { RealtimeGateway } from "./realtime.gateway";

/** The emit surface a domain service needs while it is inside a transaction. */
export type RealtimeEmitter = Pick<
  RealtimeGateway,
  "emitToUser" | "emitToRestaurant" | "emitToOrder" | "emitToAdmins"
>;

/**
 * Buffers realtime emits so they only reach clients once the surrounding transaction has
 * committed. Emitting from inside `$transaction` means a later rollback leaves clients holding a
 * "something changed, go re-fetch" signal for a row that never existed — they re-fetch and see
 * nothing. Queue during the transaction, then `flush()` after it resolves; if the transaction
 * throws, `flush()` is never reached and the queued events are correctly discarded.
 */
export class DeferredEmitter implements RealtimeEmitter {
  private readonly queued: (() => void)[] = [];

  constructor(private readonly gateway: RealtimeEmitter) {}

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.queued.push(() => this.gateway.emitToUser(userId, event, payload));
  }

  emitToRestaurant(restaurantId: string, event: string, payload: unknown): void {
    this.queued.push(() => this.gateway.emitToRestaurant(restaurantId, event, payload));
  }

  emitToOrder(orderId: string, event: string, payload: unknown): void {
    this.queued.push(() => this.gateway.emitToOrder(orderId, event, payload));
  }

  emitToAdmins(event: string, payload: unknown): void {
    this.queued.push(() => this.gateway.emitToAdmins(event, payload));
  }

  flush(): void {
    for (const emit of this.queued.splice(0)) emit();
  }
}
