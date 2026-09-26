import { useTranslation } from "react-i18next";
import { useLiveQueue } from "../live-queue";

/**
 * The always-visible answer to "will I hear the next order?". Three states, each a different colour
 * so it can be read from across the shop: on (green), off (grey, tap to turn on), and blocked by the
 * browser (red, tap to fix). Rendered in the sidebar on wide screens and in the top bar on tablets.
 */
export function SoundToggle({ variant }: { variant: "sidebar" | "topbar" }) {
  const { t } = useTranslation();
  const live = useLiveQueue();
  if (!live) return null;
  const { alert } = live;

  const state = !alert.isArmed ? "off" : alert.isBlocked ? "blocked" : "on";
  const label = state === "on" ? t("liveOrders.soundOn") : state === "blocked" ? t("liveOrders.soundBlockedShort") : t("liveOrders.enableSound");
  const hint = state === "on" ? t("liveOrders.soundOnHint") : state === "blocked" ? t("liveOrders.soundBlocked") : t("liveOrders.soundOffWarning");

  return (
    <button
      aria-pressed={state === "on"}
      className={`sound-toggle sound-toggle-${variant} is-${state}`}
      onClick={() => (state === "on" ? alert.disarm() : void alert.arm())}
      title={hint}
      type="button"
    >
      <span aria-hidden="true" className="sound-toggle-icon">
        {state === "on" ? "🔔" : "🔕"}
      </span>
      <span className="sound-toggle-label">{label}</span>
    </button>
  );
}

/** A short confirmation (or error) after an action taken from anywhere in the shell. */
export function FeedbackToast() {
  const live = useLiveQueue();
  if (!live?.feedback) return null;
  return (
    <div className={`feedback-toast is-${live.feedback.tone}`} key={live.feedback.at} role="status">
      {live.feedback.text}
    </div>
  );
}
