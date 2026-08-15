import { useEffect, useState } from "react";
import { AccessibilityInfo, Easing } from "react-native";
import { motion } from "./tokens";

/**
 * The one place that reads the OS/browser reduced-motion preference.
 * `AccessibilityInfo.isReduceMotionEnabled` is backed by `prefers-reduced-motion`
 * on web (react-native-web) and the platform accessibility setting on native,
 * so this single hook is correct on both without a separate media-query path.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => mounted && setReduced(value))
      .catch(() => {
        // Treat an unavailable API as "no preference" rather than blocking motion.
      });
    const subscription = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (value) => setReduced(value));
    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, []);

  return reduced;
}

/** The shared easing curve, ready for `Animated.timing`. */
export const motionEasing = Easing.bezier(...motion.easingPoints);

export const motionDuration = {
  fast: motion.durationFast,
  base: motion.durationBase,
  slow: motion.durationSlow
} as const;
