import { StyleSheet, View } from "react-native";

/**
 * A plain coloured location dot for the native maps (iOS + Android), used for
 * always-visible `pins` such as the driver's own position, the pickup store, and
 * the delivery destination. Deliberately simple — the landmark flag (see
 * landmark-flag.tsx) is the only marker that carries a label, so these read as a
 * different kind of marker. A white ring keeps it visible over satellite imagery.
 */
export function MapDot({ color }: { color: string }) {
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  dot: {
    borderColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 3,
    height: 20,
    width: 20
  }
});
