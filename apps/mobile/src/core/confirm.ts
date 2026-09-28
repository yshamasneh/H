import { Alert, Platform } from "react-native";

/**
 * Asks before a destructive action. On the phone it is the native alert; on the web build, where
 * React Native's Alert does nothing, it is the browser's own confirm dialog — the same pattern the
 * settings and packing screens use.
 */
export function confirmDestructive(title: string, body: string, confirmLabel: string, cancelLabel: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(typeof globalThis.confirm === "function" ? globalThis.confirm(`${title}\n\n${body}`) : true);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      body,
      [
        { text: cancelLabel, style: "cancel", onPress: () => resolve(false) },
        { text: confirmLabel, style: "destructive", onPress: () => resolve(true) }
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}
