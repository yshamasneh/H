import type { PublicUser } from "./api";
import {
  goToAdminOrderDetail,
  goToDriverHome,
  goToOrderDetail,
  goToRestaurantOrderDetail,
  type AppScreen
} from "../navigation/navigation";

const defaultActionIdentifier = "expo.modules.notifications.actions.DEFAULT";
const orderNotificationTypes = new Set([
  "ORDER_PLACED",
  "ORDER_STATUS_CHANGED",
  "DELIVERY_ASSIGNED",
  "DELIVERY_STATUS_CHANGED"
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type NotificationResponseLike = {
  actionIdentifier?: unknown;
  notification?: {
    request?: {
      identifier?: unknown;
      content?: { data?: unknown };
    };
  };
};

type ParsedOrderNotification = {
  responseId: string;
  orderId: string;
  /** A delivery alert opens the driver's home (where the waiting deliveries are) instead of an order. */
  kind?: "delivery-alert";
};

export function parseOrderNotificationResponse(response: NotificationResponseLike): ParsedOrderNotification | null {
  if (response.actionIdentifier !== defaultActionIdentifier) return null;
  const request = response.notification?.request;
  if (!request || typeof request.identifier !== "string" || request.identifier.length === 0) return null;
  if (request.identifier.length > 300) return null;
  if (!isRecord(request.content?.data)) return null;

  const type = request.content.data.type;
  const relatedEntityId = request.content.data.relatedEntityId;
  if (type === "DELIVERY_AVAILABLE") {
    // The related id is the delivery, not an order, and the driver may no longer be able to accept it
    // (someone else was faster), so the target is the list of waiting deliveries, not the delivery.
    if (typeof relatedEntityId !== "string" || !uuidPattern.test(relatedEntityId)) return null;
    return { responseId: request.identifier, orderId: relatedEntityId, kind: "delivery-alert" };
  }
  if (typeof type !== "string" || !orderNotificationTypes.has(type)) return null;
  if (typeof relatedEntityId !== "string" || !uuidPattern.test(relatedEntityId)) return null;
  return { responseId: request.identifier, orderId: relatedEntityId };
}

export type AuthenticatedNotificationSession = {
  accessToken: string;
  user: PublicUser;
};

type NotificationOrderNavigatorDeps = {
  canAccessOrder: (session: AuthenticatedNotificationSession, orderId: string) => Promise<boolean>;
  navigate: (screen: AppScreen) => void;
  showUnavailable: () => void;
};

export type NotificationNavigationResult =
  | "navigated"
  | "queued"
  | "ignored"
  | "duplicate"
  | "logged-out"
  | "unavailable";

/**
 * Coordinates both cold-start and live notification responses with asynchronous session restore.
 * `undefined` means restoration is still running; `null` means it completed without a user.
 */
export class NotificationOrderNavigator {
  private session: AuthenticatedNotificationSession | null | undefined;
  private readonly pending = new Map<string, ParsedOrderNotification>();
  private readonly processed = new Set<string>();

  constructor(private readonly deps: NotificationOrderNavigatorDeps) {}

  async handleResponse(response: NotificationResponseLike): Promise<NotificationNavigationResult> {
    const parsed = parseOrderNotificationResponse(response);
    if (!parsed) return "ignored";
    if (this.processed.has(parsed.responseId) || this.pending.has(parsed.responseId)) return "duplicate";

    if (this.session === undefined) {
      this.pending.set(parsed.responseId, parsed);
      return "queued";
    }
    if (this.session === null) {
      this.processed.add(parsed.responseId);
      return "logged-out";
    }
    return this.openOrder(this.session, parsed);
  }

  async setSession(session: AuthenticatedNotificationSession | null): Promise<void> {
    this.session = session;
    const pending = [...this.pending.values()];
    this.pending.clear();
    if (!session) {
      for (const item of pending) this.processed.add(item.responseId);
      return;
    }
    for (const item of pending) await this.openOrder(session, item);
  }

  private async openOrder(
    session: AuthenticatedNotificationSession,
    parsed: ParsedOrderNotification
  ): Promise<NotificationNavigationResult> {
    if (this.processed.has(parsed.responseId)) return "duplicate";
    this.processed.add(parsed.responseId);

    if (parsed.kind === "delivery-alert") {
      if (session.user.role !== "DRIVER") return "ignored";
      this.deps.navigate(goToDriverHome(session.user));
      return "navigated";
    }

    const screen = orderScreenForUser(session.user, parsed.orderId);
    if (!screen) {
      this.deps.showUnavailable();
      return "unavailable";
    }

    let canAccess = false;
    try {
      canAccess = await this.deps.canAccessOrder(session, parsed.orderId);
    } catch {
      canAccess = false;
    }
    if (!canAccess) {
      this.deps.showUnavailable();
      return "unavailable";
    }

    this.deps.navigate(screen);
    return "navigated";
  }
}

export function orderScreenForUser(user: PublicUser, orderId: string): AppScreen | null {
  if (user.role === "CUSTOMER") return goToOrderDetail(user, orderId);
  if (user.role === "RESTAURANT") return goToRestaurantOrderDetail(user, orderId);
  if (user.role === "ADMIN") return goToAdminOrderDetail(user, orderId);
  return null;
}

type NotificationResponseSource = {
  addNotificationResponseReceivedListener: (
    listener: (response: NotificationResponseLike) => void
  ) => { remove: () => void };
  getLastNotificationResponseAsync: () => Promise<NotificationResponseLike | null>;
};

/** Attaches the foreground/background response listener and consumes the cold-start response. */
export function attachNotificationResponseHandlers(
  source: NotificationResponseSource,
  onResponse: (response: NotificationResponseLike) => void | Promise<unknown>
): () => void {
  let active = true;
  const subscription = source.addNotificationResponseReceivedListener((response) => {
    if (active) void onResponse(response);
  });
  void source.getLastNotificationResponseAsync()
    .then((response) => {
      if (active && response) void onResponse(response);
    })
    .catch(() => undefined);

  return () => {
    active = false;
    subscription.remove();
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
