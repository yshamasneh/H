import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AppState, Platform, Pressable, StyleSheet, Text, Vibration, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, getRestaurantLiveOrders, updateOrderStatus, type LiveOrderQueue, type OrderDetail } from "../../core/api";
import { readError } from "../../core/errors";
import { useOrderAlertSound, type OrderSoundState } from "../../core/order-alert-sound";
import { getAccessToken } from "../../core/session";
import { useRealtimeEvent } from "../../core/socket";
import { RemoteImage } from "../../components/remote-image";
import { useToast } from "../../components/toast";
import { Icon } from "../../theme/icon";
import { colors, radius, spacing } from "../../theme/tokens";
import { text } from "../../theme/typography";
import { ageLabel, alertRepeatMs, countItems, escalateAfterMs, oldestAgeMs, popupOrder, pruneSetAside, shortReference } from "./live-queue.rules";

/**
 * The store's live order queue, held once above every business screen.
 *
 * That is what makes a new order impossible to miss while someone is on the catalogue, inventory
 * or another order: the JOVO store sound plays and a popup with Accept appears over whatever screen
 * is open. Both follow the server — `order.status.changed` is broadcast to the business room, so an
 * accept on any phone, tablet or the web console silences every other device at once.
 *
 * Refreshed on socket events, when the app returns to the foreground, and on a 30-second poll as
 * the safety net for a dropped socket.
 */

type StoreLiveQueue = {
  queue: LiveOrderQueue | null;
  now: number;
  reload: () => Promise<void>;
  accept: (order: OrderDetail) => Promise<void>;
  acceptingIds: ReadonlySet<string>;
  sound: { state: OrderSoundState; arm: () => void; mute: () => void };
};

const StoreLiveQueueContext = createContext<StoreLiveQueue | null>(null);

export function useStoreLiveQueue(): StoreLiveQueue | null {
  return useContext(StoreLiveQueueContext);
}

export function StoreLiveQueueProvider(props: {
  /** The signed-in business user, or null for any other role (then this renders only children). */
  userId: string | null;
  /** The order whose detail screen is open: the popup stays out of the way there. */
  viewingOrderId: string | null;
  onOpenOrder: (orderId: string) => void;
  onOpenBoard: () => void;
  children: ReactNode;
}) {
  if (!props.userId) return <>{props.children}</>;
  return <ActiveProvider {...props} key={props.userId} />;
}

function ActiveProvider(props: {
  viewingOrderId: string | null;
  onOpenOrder: (orderId: string) => void;
  onOpenBoard: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation(["restaurantOps", "common"]);
  const { showToast } = useToast();
  const [queue, setQueue] = useState<LiveOrderQueue | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [acceptingIds, setAcceptingIds] = useState<ReadonlySet<string>>(new Set());
  const [setAside, setSetAside] = useState<ReadonlySet<string>>(new Set());
  const requestSeq = useRef(0);
  const seenNewIds = useRef<Set<string> | null>(null);

  async function reload(): Promise<void> {
    if (!enabled) return;
    const seq = ++requestSeq.current;
    try {
      const token = await getAccessToken();
      if (!token) return;
      const next = await getRestaurantLiveOrders(token);
      if (seq !== requestSeq.current) return;
      // A short buzz when an order this phone has not seen yet arrives (not on the first load).
      const known = seenNewIds.current;
      if (known && Platform.OS !== "web" && next.new.some((order) => !known.has(order.id))) Vibration.vibrate([0, 250, 150, 250]);
      seenNewIds.current = new Set(next.new.map((order) => order.id));
      setQueue(next);
      setSetAside((current) => pruneSetAside(current, next.new));
      setNow(Date.now());
    } catch (error) {
      // A staff role without order access: stay silent rather than erroring on every screen.
      if (error instanceof ApiError && error.statusCode === 403) setEnabled(false);
    }
  }

  useEffect(() => {
    void reload();
    const poll = setInterval(() => void reload(), 30_000);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void reload();
    });
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRealtimeEvent("order.created", () => void reload());
  useRealtimeEvent("order.status.changed", () => void reload());
  useRealtimeEvent("order.fulfillment.changed", () => void reload());
  useRealtimeEvent("connect", () => void reload());

  const newOrders = queue?.new ?? [];
  const sound = useOrderAlertSound(enabled && newOrders.length > 0, alertRepeatMs(oldestAgeMs(newOrders, now)));

  async function accept(order: OrderDetail): Promise<void> {
    if (acceptingIds.has(order.id)) return;
    setAcceptingIds((current) => new Set(current).add(order.id));
    try {
      const token = await getAccessToken();
      if (!token) throw new Error(t("common:sessionExpired"));
      const accepted = await updateOrderStatus(token, order.id, "ACCEPTED");
      // Stop the sound here at once; a refresh already in flight predates the accept, so drop it.
      requestSeq.current += 1;
      setQueue((current) =>
        current ? { ...current, new: current.new.filter((entry) => entry.id !== order.id), inProgress: [...current.inProgress, accepted] } : current
      );
      showToast(t("live.acceptedToast", { ref: shortReference(order.id) }));
    } catch (error) {
      showToast(
        error instanceof ApiError && error.statusCode === 409
          ? t("live.alreadyHandled", { ref: shortReference(order.id) })
          : readError(error)
      );
    } finally {
      setAcceptingIds((current) => {
        const next = new Set(current);
        next.delete(order.id);
        return next;
      });
      void reload();
    }
  }

  const value: StoreLiveQueue = { queue, now, reload, accept, acceptingIds, sound };
  const target = popupOrder(newOrders, setAside);
  const showPopup = enabled && target !== null && target.order.id !== props.viewingOrderId;

  return (
    <StoreLiveQueueContext.Provider value={value}>
      <View style={styles.host}>
        {props.children}
        {showPopup && target ? (
          <NewOrderPopup
            accepting={acceptingIds.has(target.order.id)}
            now={now}
            onAccept={() => void accept(target.order)}
            onLater={() => setSetAside((current) => new Set(current).add(target.order.id))}
            onOpen={() => props.onOpenOrder(target.order.id)}
            onOpenBoard={props.onOpenBoard}
            order={target.order}
            othersWaiting={target.othersWaiting}
            soundState={sound.state}
            onArmSound={sound.arm}
          />
        ) : null}
      </View>
    </StoreLiveQueueContext.Provider>
  );
}

/**
 * The popup over whatever screen is open: order number, item count, total, item photos, and Accept
 * as the largest target on screen. It does not block the screen underneath.
 */
function NewOrderPopup(props: {
  order: OrderDetail;
  othersWaiting: number;
  now: number;
  accepting: boolean;
  soundState: OrderSoundState;
  onAccept: () => void;
  onOpen: () => void;
  onLater: () => void;
  onOpenBoard: () => void;
  onArmSound: () => void;
}) {
  const { t } = useTranslation(["restaurantOps", "common"]);
  const insets = useSafeAreaInsets();
  const ageMs = props.now - new Date(props.order.createdAt).getTime();
  const age = ageLabel(ageMs);
  const isLate = ageMs > escalateAfterMs;
  const accent = isLate ? colors.error : colors.primary;

  return (
    <View
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
      pointerEvents="box-none"
      style={[styles.popupWrap, { paddingBottom: Math.max(insets.bottom, spacing[3]) }]}
    >
      <View style={[styles.popup, { borderColor: accent }]}>
        <View style={styles.popupHead}>
          <View style={[styles.dot, { backgroundColor: accent }]} />
          <Text style={[styles.popupTitle, { color: accent }]}>{t("live.popupTitle")}</Text>
          <Text style={styles.popupAge}>{t(age.key, { count: age.count })}</Text>
        </View>
        <View style={styles.popupBody}>
          <View style={styles.popupFacts}>
            <Text style={styles.popupRef}>{shortReference(props.order.id)}</Text>
            <Text style={styles.popupMeta}>{t("live.itemCount", { count: countItems(props.order) })}</Text>
          </View>
          <Text style={styles.popupTotal}>{formatMoney(props.order.totalMinor)}</Text>
        </View>
        <View style={styles.thumbs}>
          {props.order.items.slice(0, 5).map((item) => (
            <RemoteImage key={item.id} style={styles.thumb} uri={item.imageUrl ?? null} />
          ))}
          {props.order.items.length > 5 ? <Text style={styles.popupMeta}>+{props.order.items.length - 5}</Text> : null}
        </View>
        {props.soundState !== "on" && Platform.OS === "web" ? (
          <Pressable accessibilityRole="button" onPress={props.onArmSound} style={styles.armRow}>
            <Icon color={colors.warning} name="volumeOff" size="sm" />
            <Text style={styles.armText}>{t("live.enableSound")}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: props.accepting }}
          disabled={props.accepting}
          onPress={props.onAccept}
          style={({ pressed }) => [styles.acceptButton, pressed && styles.pressed, props.accepting && styles.disabled]}
        >
          <Text style={styles.acceptText}>{props.accepting ? t("live.working") : t("live.accept")}</Text>
        </Pressable>
        <View style={styles.secondaryRow}>
          <Pressable accessibilityRole="button" onPress={props.onOpen} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
            <Text style={styles.secondaryText}>{t("live.openOrder")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={props.onLater} style={({ pressed }) => [styles.laterButton, pressed && styles.pressed]}>
            <Text style={styles.laterText}>{t("live.later")}</Text>
          </Pressable>
        </View>
        {props.othersWaiting > 0 ? (
          <Pressable accessibilityRole="button" onPress={props.onOpenBoard} style={styles.othersRow}>
            <Text style={styles.othersText}>{t("live.othersWaiting", { count: props.othersWaiting })}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** The sound state as a header chip: green on, amber off (tap to turn on), red blocked. */
export function StoreSoundChip() {
  const { t } = useTranslation(["restaurantOps"]);
  const live = useStoreLiveQueue();
  if (!live) return null;
  const { state, arm, mute } = live.sound;
  const palette =
    state === "on"
      ? { bg: colors.successSubtle, fg: colors.success }
      : state === "blocked"
        ? { bg: colors.errorSubtle, fg: colors.error }
        : { bg: colors.warningSubtle, fg: colors.warning };
  return (
    <Pressable
      accessibilityLabel={state === "on" ? t("live.soundOnHint") : t("live.enableSound")}
      accessibilityRole="switch"
      accessibilityState={{ checked: state === "on" }}
      onPress={state === "on" ? mute : arm}
      style={({ pressed }) => [styles.chip, { backgroundColor: palette.bg, borderColor: palette.fg }, pressed && styles.pressed]}
    >
      <Icon color={palette.fg} name={state === "on" ? "volumeOn" : "volumeOff"} size="sm" />
      <Text style={[styles.chipText, { color: palette.fg }]} numberOfLines={1}>
        {state === "on" ? t("live.soundOn") : state === "blocked" ? t("live.soundBlocked") : t("live.soundOff")}
      </Text>
    </Pressable>
  );
}

function formatMoney(minor: number): string {
  return `${(minor / 100).toFixed(2)} ₪`;
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  popupWrap: { bottom: 0, left: 0, paddingHorizontal: spacing[3], position: "absolute", right: 0 },
  popup: {
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 3,
    elevation: 12,
    gap: spacing[3],
    maxWidth: 520,
    padding: spacing[4],
    shadowColor: "#000",
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    width: "100%"
  },
  popupHead: { alignItems: "center", flexDirection: "row", gap: spacing[2] },
  dot: { borderRadius: 7, height: 14, width: 14 },
  popupTitle: { ...text("h2", "heavy"), flex: 1 },
  popupAge: { ...text("caption", "semibold"), color: colors.textMuted },
  popupBody: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between" },
  popupFacts: { alignItems: "flex-start", gap: spacing[1] },
  popupRef: { ...text("h1", "heavy"), color: colors.text },
  popupMeta: { ...text("bodySm", "semibold"), color: colors.textMuted },
  popupTotal: { ...text("h2", "bold"), color: colors.text },
  thumbs: { alignItems: "center", flexDirection: "row", gap: spacing[2] },
  thumb: { backgroundColor: colors.neutralSubtle, borderRadius: radius.sm, height: 44, width: 44 },
  armRow: { alignItems: "center", backgroundColor: colors.warningSubtle, borderRadius: radius.md, flexDirection: "row", gap: spacing[2], minHeight: 44, paddingHorizontal: spacing[3] },
  armText: { ...text("bodySm", "bold"), color: colors.warning },
  acceptButton: { alignItems: "center", backgroundColor: colors.primary, borderRadius: radius.md, justifyContent: "center", minHeight: 56 },
  acceptText: { ...text("h3", "bold"), color: colors.textInverse },
  secondaryRow: { flexDirection: "row", gap: spacing[2] },
  secondaryButton: { alignItems: "center", borderColor: colors.borderStrong, borderRadius: radius.md, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 48 },
  secondaryText: { ...text("bodySm", "bold"), color: colors.text },
  laterButton: { alignItems: "center", justifyContent: "center", minHeight: 48, paddingHorizontal: spacing[4] },
  laterText: { ...text("bodySm", "semibold"), color: colors.textMuted },
  othersRow: { alignItems: "center", backgroundColor: colors.primarySubtle, borderRadius: radius.md, justifyContent: "center", minHeight: 44 },
  othersText: { ...text("bodySm", "bold"), color: colors.primaryPressed },
  chip: { alignItems: "center", borderRadius: radius.pill, borderWidth: 1.5, flexDirection: "row", gap: spacing[1], minHeight: 44, paddingHorizontal: spacing[3] },
  chipText: { ...text("label", "bold") },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.6 }
});
