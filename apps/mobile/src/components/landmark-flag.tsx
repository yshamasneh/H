import { StyleSheet, Text, View } from "react-native";

/**
 * The native (iOS + Android) landmark marker: a compact orange flag with the
 * landmark's name in a persistent label beside it. Deliberately a different
 * shape from the user's own location pin — which stays a teardrop/dot — so the
 * two read as different kinds of marker even though they now share the brand
 * orange. The name label is always visible (the marker itself is only rendered
 * once the map is zoomed in), so users don't have to tap to read it.
 *
 * Web uses an equivalent inline-SVG flag in location-map.web.tsx; this component
 * keeps iOS and Android identical without pulling in an SVG dependency.
 */
export function LandmarkFlag({ color, name }: { color: string; name: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.flag}>
        <View style={[styles.pennant, { backgroundColor: color }]} />
        <View style={[styles.pole, { backgroundColor: color }]} />
      </View>
      <View style={styles.label}>
        <Text numberOfLines={1} style={styles.labelText}>
          {name}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "flex-end", flexDirection: "row" },
  flag: { alignItems: "flex-start" },
  pennant: { borderColor: "#FFFFFF", borderWidth: 1, height: 8, width: 11 },
  pole: { height: 12, width: 2 },
  label: {
    backgroundColor: "#FFFFFF",
    borderColor: "rgba(0,0,0,0.12)",
    borderRadius: 4,
    borderWidth: 1,
    marginBottom: -1,
    marginLeft: 3,
    maxWidth: 150,
    paddingHorizontal: 5,
    paddingVertical: 1
  },
  labelText: { color: "#1A1A1A", fontSize: 10, fontWeight: "600" }
});
