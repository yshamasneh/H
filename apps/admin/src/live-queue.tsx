import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, readApiError } from "./api";
import { getLiveOrders, updateBusinessOrderStatus, type BusinessOrder, type LiveOrderQueue } from "./api.business";
import { useNewOrderAlert, type AlertState } from "./alert-sound";
import { useAuth } from "./auth";
import { alertRepeatMs, oldestAgeMs, pruneSetAside, shortReference } from "./order-queue";
import { parsePackingEvent, withPicked } from "./packChecklist";
import { useLiveRefresh, useRealtimeEvent } from "./socket";

/**
 * The store's live order queue, held once for the whole business shell rather than by one page.
 *
 * That is what lets the new-order sound and popup work on every screen — catalogue, inventory,
 * an order's detail — and not only while the Live Orders board happens to be open. The board reads
 * the same queue from here, so there is one fetch and one source of truth per tab.
 *
 * The queue is refreshed on socket events (`order.created`, and `order.status.changed`, which the
 * API broadcasts to the business room so an accept on another device lands here at once), on
 * reconnect and focus, and on a 30-second poll as the safety net.
 */

export type Feedback = { tone: "success" | "error"; text: string; at: number };

type LiveQueueValue = {
  queue: LiveOrderQueue | null;
  error: string | null;
  lastRefreshAt: Date | null;
  /** Re-rendered every 15 s so elapsed-time badges and escalation stay honest between refreshes. */
  now: number;
  reload: () => Promise<void>;
  alert: AlertState;
  /** Orders being accepted from this tab right now (the button shows progress). */
  acceptingIds: ReadonlySet<string>;
  accept: (order: BusinessOrder) => Promise<void>;
  /** "Later" on the popup: hides the popup for this order on this device only. */
  setAside: ReadonlySet<string>;
  setOrderAside: (orderId: string) => void;
  feedback: Feedback | null;
  showFeedback: (tone: Feedback["tone"], text: string) => void;
};

const LiveQueueContext = createContext<LiveQueueValue | null>(null);

export function useLiveQueue(): LiveQueueValue | null {
  return useContext(LiveQueueContext);
}

export function LiveQueueProvider({ children }: { children: ReactNode }) {
  const { can } = useAuth();
  // A staff role without order access never loads the queue and never rings.
  if (!can("VIEW_ORDERS")) return <>{children}</>;
  return <ActiveLiveQueueProvider>{children}</ActiveLiveQueueProvider>;
}

function ActiveLiveQueueProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<LiveOrderQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [acceptingIds, setAcceptingIds] = useState<ReadonlySet<string>>(new Set());
  const [setAside, setSetAside] = useState<ReadonlySet<string>>(new Set());
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // Responses can arrive out of order (a socket event and a poll a few ms apart); only the newest
  // request is allowed to write, so an older snapshot can never resurrect an accepted order.
  const requestSeq = useRef(0);

  async function reload(): Promise<void> {
    const seq = ++requestSeq.current;
    try {
      const next = await getLiveOrders();
      if (seq !== requestSeq.current) return;
      setQueue(next);
      setSetAside((current) => pruneSetAside(current, next.new));
      setLastRefreshAt(new Date());
      setNow(Date.now());
      setError(null);
    } catch (requestError) {
      if (seq !== requestSeq.current) return;
      setError(readApiError(requestError, t("liveOrders.loadError")));
    }
  }

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLiveRefresh(["order.created", "order.status.changed", "order.fulfillment.changed"], () => void reload());

  // Someone ticked an item on another device: update that ticket's "Packed n/m" as it happens.
  useRealtimeEvent("order.packing.changed", (payload) => {
    const event = parsePackingEvent(payload);
    if (!event) return;
    const apply = (orders: BusinessOrder[]) =>
      orders.map((order) => (order.id === event.orderId ? { ...order, items: withPicked(order.items, event.orderItemId, event.isPicked) } : order));
    setQueue((current) => (current ? { ...current, new: apply(current.new), inProgress: apply(current.inProgress), ready: apply(current.ready) } : current));
  });

  const newOrders = queue?.new ?? [];
  // The alert is driven entirely by how many orders the server still reports as unaccepted.
  const alert = useNewOrderAlert(newOrders.length, alertRepeatMs(oldestAgeMs(newOrders, now)));

  function showFeedback(tone: Feedback["tone"], text: string) {
    setFeedback({ tone, text, at: Date.now() });
  }

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  async function accept(order: BusinessOrder): Promise<void> {
    if (acceptingIds.has(order.id)) return;
    setAcceptingIds((current) => new Set(current).add(order.id));
    try {
      const accepted = await updateBusinessOrderStatus(order.id, "ACCEPTED");
      // Move it locally at once so the sound stops on this device without waiting for the round
      // trip; the reload below then confirms it against the server. Any refresh already in flight
      // was started before the accept and would put the order back (and ring once), so it is
      // invalidated.
      requestSeq.current += 1;
      setQueue((current) =>
        current
          ? { ...current, new: current.new.filter((entry) => entry.id !== order.id), inProgress: [...current.inProgress, accepted] }
          : current
      );
      showFeedback("success", t("liveOrders.acceptedToast", { ref: shortReference(order.id) }));
    } catch (requestError) {
      // 409: someone else got there first (or the customer cancelled). Not an error for this person.
      if (requestError instanceof ApiError && requestError.statusCode === 409) {
        showFeedback("success", t("liveOrders.alreadyHandled", { ref: shortReference(order.id) }));
      } else {
        showFeedback("error", readApiError(requestError, t("common.genericActionError")));
      }
    } finally {
      setAcceptingIds((current) => {
        const next = new Set(current);
        next.delete(order.id);
        return next;
      });
      void reload();
    }
  }

  function setOrderAside(orderId: string) {
    setSetAside((current) => new Set(current).add(orderId));
  }

  return (
    <LiveQueueContext.Provider
      value={{ queue, error, lastRefreshAt, now, reload, alert, acceptingIds, accept, setAside, setOrderAside, feedback, showFeedback }}
    >
      {children}
    </LiveQueueContext.Provider>
  );
}
