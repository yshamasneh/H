import { useEffect, useRef, useState } from "react";
import orderSoundUrl from "./assets/sounds/jovo_order.wav";

/**
 * The new-order alert.
 *
 * Three things make this correct rather than merely noisy:
 *
 * 1. It is driven by server state. The caller passes how many orders are currently unaccepted, so
 *    the loop stops because the order left PLACED — whoever accepted it, on whichever device. It is
 *    never gated on this browser having clicked something, which is what makes the two-employee
 *    case work.
 * 2. It has to be armed by a user gesture. Browsers refuse to start audio otherwise, so a tablet
 *    that reloads overnight would sit silent with no indication. Arming is explicit and its state
 *    is visible. Once armed, the next tap anywhere on the page after a reload re-arms it, so a
 *    reload costs one tap rather than a trip to a settings button.
 * 3. It plays the JOVO store sound (apps/admin/src/assets/sounds/jovo_order.wav, byte-identical to
 *    the mobile app's). If that file cannot be decoded the alert falls back to a synthesised tone
 *    rather than going silent.
 */

const storageKey = "wasel-admin-alert-armed";

export type AlertState = {
  isArmed: boolean;
  isBlocked: boolean;
  arm: () => Promise<void>;
  disarm: () => void;
};

function readArmed(): boolean {
  try {
    return window.localStorage.getItem(storageKey) === "true";
  } catch {
    return false;
  }
}

function writeArmed(value: boolean): void {
  try {
    window.localStorage.setItem(storageKey, String(value));
  } catch {
    // Private mode: the preference just does not survive a reload.
  }
}

export function useNewOrderAlert(unhandledCount: number, repeatMs: number): AlertState {
  const [isArmed, setIsArmed] = useState<boolean>(readArmed);
  const [isBlocked, setIsBlocked] = useState(false);
  // The loop waits until the sound is decoded (or has failed to), so the first alert is the real
  // sound rather than the fallback tone.
  const [soundReady, setSoundReady] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const timerRef = useRef<number | null>(null);

  function ensureContext(): AudioContext | null {
    const Constructor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return null;
    contextRef.current ??= new Constructor();
    return contextRef.current;
  }

  const loadingRef = useRef<Promise<void> | null>(null);
  function loadSound(context: AudioContext): Promise<void> {
    loadingRef.current ??= (async () => {
      try {
        const response = await fetch(orderSoundUrl);
        bufferRef.current = await context.decodeAudioData(await response.arrayBuffer());
      } catch {
        bufferRef.current = null;
      } finally {
        setSoundReady(true);
      }
    })();
    return loadingRef.current;
  }

  function play(): void {
    const context = contextRef.current;
    if (!context || context.state !== "running") return;
    if (bufferRef.current) {
      const source = context.createBufferSource();
      source.buffer = bufferRef.current;
      source.connect(context.destination);
      source.start();
      return;
    }
    fallbackTone(context);
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
      writeArmed(true);
      setIsArmed(true);
      setIsBlocked(context.state !== "running");
      await loadSound(context);
      // Only a confirmation beep if nothing is waiting; otherwise the loop below starts right away.
      if (unhandledCount <= 0) play();
    } catch {
      setIsBlocked(true);
    }
  }

  function disarm(): void {
    writeArmed(false);
    setIsArmed(false);
  }

  // A previously armed tab still needs a gesture after a reload. Try at once (some browsers allow it
  // for a site the person uses often); otherwise the first tap anywhere on the page resumes audio.
  useEffect(() => {
    if (!isArmed) return;
    const context = ensureContext();
    if (!context) {
      setIsBlocked(true);
      return;
    }
    void loadSound(context);
    const sync = () => setIsBlocked(context.state !== "running");
    if (context.state !== "running") {
      void context.resume().then(sync, () => setIsBlocked(true));
    }
    const onGesture = () => {
      if (context.state === "running") return;
      void context.resume().then(sync, () => setIsBlocked(true));
    };
    context.addEventListener("statechange", sync);
    document.addEventListener("pointerdown", onGesture, true);
    document.addEventListener("keydown", onGesture, true);
    sync();
    return () => {
      context.removeEventListener("statechange", sync);
      document.removeEventListener("pointerdown", onGesture, true);
      document.removeEventListener("keydown", onGesture, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isArmed]);

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!isArmed || isBlocked || !soundReady || unhandledCount <= 0) return;

    play();
    timerRef.current = window.setInterval(play, repeatMs);
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
    // A new order arriving while others wait restarts the cycle, so it is heard immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isArmed, isBlocked, soundReady, unhandledCount, repeatMs]);

  return { isArmed, isBlocked, arm, disarm };
}

/** Two short tones — used only if the bundled sound could not be decoded. */
function fallbackTone(context: AudioContext): void {
  const now = context.currentTime;
  for (const [offset, frequency] of [[0, 1_318], [0.22, 880]] as const) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.3, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.4);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now + offset);
    oscillator.stop(now + offset + 0.42);
  }
}
