import { useEffect, useRef, useState } from "react";

/**
 * The new-order alert.
 *
 * Two things make this correct rather than merely noisy:
 *
 * 1. It is driven by server state. The caller passes how many orders are currently unaccepted, so
 *    the loop stops because the order left PLACED — whoever accepted it, on whichever device. It is
 *    never gated on this browser having clicked something, which is what makes the two-employee
 *    case work.
 * 2. It has to be armed by a user gesture. Browsers refuse to start audio otherwise, so a tablet
 *    that reloads overnight would sit silent with no indication. Arming is explicit and its state
 *    is visible.
 *
 * The tone is generated with the Web Audio API rather than shipped as an asset: no binary in the
 * repository, no extra request, and nothing to configure.
 */

const storageKey = "wasel-admin-alert-armed";
const beepIntervalMs = 4_000;

export type AlertState = {
  isArmed: boolean;
  isBlocked: boolean;
  arm: () => Promise<void>;
  disarm: () => void;
};

function readArmed(): boolean {
  return window.localStorage.getItem(storageKey) === "true";
}

export function useNewOrderAlert(unhandledCount: number, escalate: boolean): AlertState {
  const [isArmed, setIsArmed] = useState<boolean>(readArmed);
  const [isBlocked, setIsBlocked] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);

  function ensureContext(): AudioContext | null {
    const Constructor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return null;
    contextRef.current ??= new Constructor();
    return contextRef.current;
  }

  function beep(urgent: boolean): void {
    const context = contextRef.current;
    if (!context || context.state !== "running") return;
    const now = context.currentTime;
    // Two short tones when urgent, one otherwise: an audible difference without a volume change.
    const tones = urgent ? [0, 0.28] : [0];
    for (const offset of tones) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = urgent ? 1_050 : 820;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.28, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.24);
    }
  }

  async function arm(): Promise<void> {
    const context = ensureContext();
    if (!context) {
      setIsBlocked(true);
      return;
    }
    try {
      // Must happen inside the click handler for the browser to allow it.
      await context.resume();
      window.localStorage.setItem(storageKey, "true");
      setIsArmed(true);
      setIsBlocked(false);
      beep(false);
    } catch {
      setIsBlocked(true);
    }
  }

  function disarm(): void {
    window.localStorage.setItem(storageKey, "false");
    setIsArmed(false);
  }

  // A previously armed tab still needs a gesture after a reload; surface that rather than hide it.
  useEffect(() => {
    if (!isArmed) return;
    const context = ensureContext();
    if (!context) {
      setIsBlocked(true);
      return;
    }
    if (context.state === "suspended") {
      void context.resume().then(
        () => setIsBlocked(context.state !== "running"),
        () => setIsBlocked(true)
      );
    }
  }, [isArmed]);

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!isArmed || unhandledCount <= 0) return;

    beep(escalate);
    timerRef.current = window.setInterval(() => beep(escalate), beepIntervalMs);
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [isArmed, unhandledCount, escalate]);

  return { isArmed, isBlocked, arm, disarm };
}
