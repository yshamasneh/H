import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { Asset } from "expo-asset";
import { kvStore } from "./kv-storage";

/**
 * The store's in-app new-order sound (assets/sounds/jovo_order.wav, the same file the admin console
 * plays). Push notifications cover a closed app; this covers the app open and in use, which a push
 * does not reliably do.
 *
 * It is driven by server state: the caller passes whether anything is still NEW, so the loop stops
 * the moment the order is accepted on any device. Muting is a per-device choice that survives a
 * restart.
 *
 * - Native: expo-audio, which may start without a gesture, so the alert is on by default.
 *   `playsInSilentMode` keeps it audible on a store phone left on silent.
 * - Web (the app in a browser): browsers block audio until the page has been tapped, so the sound
 *   has to be armed by a tap, and a refused play is reported as "blocked" rather than failing
 *   silently — the same pattern as the admin console.
 */

const mutedKey = "jovo.store-order-sound.muted";
const soundModule = require("../../assets/sounds/jovo_order.wav");

export type OrderSoundState = "on" | "off" | "blocked";

type Engine = { play: () => Promise<boolean>; dispose: () => void };

function nativeEngine(): Engine {
  let player: AudioPlayer | null = null;
  void setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: "mixWithOthers",
    shouldPlayInBackground: false,
    allowsRecording: false,
    shouldRouteThroughEarpiece: false
  }).catch(() => undefined);
  return {
    async play() {
      try {
        player ??= createAudioPlayer(soundModule);
        await player.seekTo(0);
        player.play();
        return true;
      } catch {
        return false;
      }
    },
    dispose() {
      player?.remove();
      player = null;
    }
  };
}

function webEngine(): Engine {
  let audio: HTMLAudioElement | null = null;
  return {
    async play() {
      try {
        audio ??= new Audio(Asset.fromModule(soundModule).uri);
        audio.currentTime = 0;
        await audio.play();
        return true;
      } catch (error) {
        console.warn("[order-alert-sound] web play refused", error);
        return false;
      }
    },
    dispose() {
      audio?.pause();
      audio = null;
    }
  };
}

export function useOrderAlertSound(active: boolean, repeatMs: number): { state: OrderSoundState; arm: () => void; mute: () => void } {
  const isWeb = Platform.OS === "web";
  const engineRef = useRef<Engine | null>(null);
  const [muted, setMuted] = useState<boolean | null>(null);
  // Web only: whether a tap has unlocked audio in this page, and whether the browser refused.
  const [unlocked, setUnlocked] = useState(!isWeb);
  const [blocked, setBlocked] = useState(false);

  engineRef.current ??= isWeb ? webEngine() : nativeEngine();

  useEffect(() => {
    void kvStore.getItem(mutedKey).then((value) => setMuted(value === "true"), () => setMuted(false));
    return () => engineRef.current?.dispose();
  }, []);

  useEffect(() => {
    if (muted !== false || !unlocked || !active) return;
    let cancelled = false;
    const ring = async () => {
      const ok = await engineRef.current!.play();
      if (!cancelled && isWeb) setBlocked(!ok);
    };
    void ring();
    const timer = setInterval(() => void ring(), repeatMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [muted, unlocked, active, repeatMs, isWeb]);

  function arm() {
    setMuted(false);
    void kvStore.setItem(mutedKey, "false");
    if (isWeb) {
      // Inside the tap handler: this play is what the browser accepts as the unlocking gesture.
      void engineRef.current!.play().then((ok) => {
        setUnlocked(ok);
        setBlocked(!ok);
      });
    }
  }

  function mute() {
    setMuted(true);
    void kvStore.setItem(mutedKey, "true");
  }

  const state: OrderSoundState = muted !== false ? "off" : blocked ? "blocked" : !unlocked ? "off" : "on";
  return { state, arm, mute };
}
