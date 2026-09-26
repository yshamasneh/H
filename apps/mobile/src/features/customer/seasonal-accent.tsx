import { StyleSheet, View } from "react-native";
import type { CustomerTheme } from "./theme";

/** Small, static ornament with its own space; never overlays imagery or controls. */
export function SeasonalAccent({ theme, background, color = theme.decoration.accent }: {
  theme: CustomerTheme; background: string; color?: string;
}) {
  if (theme.preset === "normal") return null;
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.frame}>
      {theme.preset === "ramadan" ? (
        <View style={[styles.moon, { backgroundColor: color }]}>
          <View style={[styles.cutout, { backgroundColor: background }]} />
        </View>
      ) : (
        <>
          <View style={[styles.confetti, { backgroundColor: color, top: 3, start: 4, transform: [{ rotate: "-25deg" }] }]} />
          <View style={[styles.confetti, { backgroundColor: theme.colors.primary, top: 15, start: 14, transform: [{ rotate: "30deg" }] }]} />
          <View style={[styles.confetti, { backgroundColor: color, top: 2, start: 24, transform: [{ rotate: "40deg" }] }]} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: 34, height: 30, flexShrink: 0, overflow: "hidden" },
  moon: { width: 25, height: 25, borderRadius: 13, top: 2, start: 3, overflow: "hidden" },
  cutout: { width: 23, height: 23, borderRadius: 12, position: "absolute", top: -4, start: 8 },
  confetti: { width: 3, height: 9, borderRadius: 1, position: "absolute" }
});
