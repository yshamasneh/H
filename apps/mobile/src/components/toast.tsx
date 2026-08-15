import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { motionDuration, motionEasing, useReducedMotion } from "../theme/motion";
import { Icon } from "../theme/icon";
import { colors, radius, spacing, withAlpha } from "../theme/tokens";
import { text } from "../theme/typography";

const displayMs = 2200;

type ToastState = { id: number; message: string };

const ToastContext = createContext<{ showToast: (message: string) => void } | null>(null);

/**
 * A single confirming toast for actions that change state without navigating
 * anywhere — "item added to cart" is the one call site today. Deliberately
 * not used for order placement, which already has its own full confirmation
 * screen; a toast on top of that would be a second, redundant "it worked".
 */
export function ToastProvider(props: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    const id = Date.now();
    setToast({ id, message });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, displayMs);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {props.children}
      <ToastHost toast={toast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within a ToastProvider");
  return context;
}

function ToastHost(props: { toast: ToastState | null }) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const translateY = useRef(new Animated.Value(-40)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!props.toast) return;
    translateY.setValue(reducedMotion ? 0 : -40);
    opacity.setValue(0);
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: motionDuration.base, easing: motionEasing, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: motionDuration.base, easing: motionEasing, useNativeDriver: true })
    ]).start();
  }, [props.toast?.id]);

  if (!props.toast) return null;

  return (
    <View pointerEvents="none" style={[styles.host, { top: insets.top + spacing[3] }]}>
      <Animated.View style={[styles.toast, { opacity, transform: [{ translateY }] }]}>
        <View style={styles.iconSlot}>
          <Icon color={colors.success} name="checkCircle" active size="sm" />
        </View>
        <Text numberOfLines={2} style={styles.message}>{props.toast.message}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { alignItems: "center", end: 0, position: "absolute", start: 0, zIndex: 50 },
  toast: {
    alignItems: "center",
    backgroundColor: colors.surfaceInverse,
    borderRadius: radius.lg,
    flexDirection: "row",
    gap: spacing[3],
    maxWidth: 420,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 6
  },
  iconSlot: {
    alignItems: "center",
    backgroundColor: withAlpha(colors.success, 0.18),
    borderRadius: radius.pill,
    height: 24,
    justifyContent: "center",
    width: 24
  },
  message: { ...text("bodySm", "medium"), color: colors.textInverse, flexShrink: 1 }
});
