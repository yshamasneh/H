import { useCallback, useRef, useState, type ReactElement } from "react";
import { BackgroundLocationDisclosure } from "../../components/background-location-disclosure";
import {
  currentBackgroundPlan,
  openLocationSettings,
  recordConsent,
  requestBackgroundPermission,
  trackingController
} from "../../core/background-location";

export type BackgroundLocationOutcome = "granted" | "declined" | "denied" | "settings";

/**
 * The permission flow for background location during a delivery.
 *
 * ensure() decides from the stored consent and the OS permission what is needed. If the driver has
 * not yet been told what is collected, it shows the prominent disclosure first and only then the
 * system prompt, exactly in the order Google Play requires. If it is already granted it does
 * nothing. It never asks twice for the same decision: a driver who declined the disclosure is not
 * nagged, and one who denied the system permission is sent to settings, where Android needs them.
 *
 * Render the returned element once in the screen.
 */
export function useBackgroundLocation(): {
  ensure: (options?: { auto?: boolean }) => Promise<BackgroundLocationOutcome>;
  disclosure: ReactElement;
} {
  const [visible, setVisible] = useState(false);
  const answer = useRef<((accepted: boolean) => void) | null>(null);
  // One flow at a time: the delivery screen asks on opening and again before a hand-off, and the
  // second call must join the first rather than stack a second disclosure on top of it.
  const inFlight = useRef<Promise<BackgroundLocationOutcome> | null>(null);

  const ask = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        answer.current = resolve;
        setVisible(true);
      }),
    []
  );

  const run = useCallback(async (auto: boolean): Promise<BackgroundLocationOutcome> => {
    const plan = await currentBackgroundPlan();
    if (plan === "start") return "granted";
    if (plan === "foreground-only") return "declined";
    if (plan === "open-settings") {
      // Sending someone to the settings app is only done when they act (pressing Navigate), never
      // automatically each time a delivery screen opens.
      if (auto) return "denied";
      await openLocationSettings();
      return "settings";
    }
    const accepted = await ask();
    setVisible(false);
    await recordConsent(accepted ? "accepted" : "declined");
    if (!accepted) return "declined";
    const granted = await requestBackgroundPermission();
    // Permission just arrived: a delivery that is already being tracked in the foreground can now
    // start the background task without waiting for the next screen change.
    if (granted) trackingController.retry();
    return granted ? "granted" : "denied";
  }, [ask]);

  const ensure = useCallback((options?: { auto?: boolean }): Promise<BackgroundLocationOutcome> => {
    if (!inFlight.current) {
      inFlight.current = run(options?.auto ?? false).finally(() => {
        inFlight.current = null;
      });
    }
    return inFlight.current;
  }, [run]);

  const disclosure = (
    <BackgroundLocationDisclosure
      onAccept={() => answer.current?.(true)}
      onDecline={() => answer.current?.(false)}
      visible={visible}
    />
  );
  return { ensure, disclosure };
}
