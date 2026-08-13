import { Component, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import i18n from "../i18n";
import { colors, radius, spacing } from "../theme/tokens";
import { text } from "../theme/typography";

type Props = {
  children: ReactNode;
  /** Called when the user asks to recover, so the host can reset navigation. */
  onReset?: () => void;
};

type State = { error: Error | null };

/**
 * Without a boundary, any render-time throw unmounts the entire React tree.
 * On a release Android build that reads to the user as the app closing itself
 * with no message at all -- the JS error never reaches a red box, because
 * release builds have none. That is the "app kicked me out" class of bug.
 *
 * This boundary keeps the process alive, shows what actually failed, and
 * offers a way back. The message stays on screen (rather than being logged
 * and swallowed) specifically so a crash on a real device is diagnosable
 * without a USB cable and a logcat session.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Keep the native console path too, so wireless logcat still captures it.
    console.error("[ErrorBoundary]", error?.message, info?.componentStack ?? "");
  }

  handleReset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // i18n may itself be the thing that failed, so every string here falls
    // back to a literal rather than assuming the translation layer is healthy.
    const tr = (key: string, fallback: string) => {
      try {
        const value = i18n.t(key);
        return !value || value === key ? fallback : value;
      } catch {
        return fallback;
      }
    };

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.icon}>
            <Text style={styles.iconText}>!</Text>
          </View>
          <Text style={styles.title}>{tr("common:unexpectedErrorTitle", "Something went wrong")}</Text>
          <Text style={styles.body}>
            {tr(
              "common:unexpectedErrorBody",
              "The app hit an unexpected problem on this screen. Your account and any placed order are safe."
            )}
          </Text>
          <View style={styles.detailCard}>
            <Text style={styles.detailText}>{error?.message ?? String(error)}</Text>
          </View>
          <Pressable onPress={this.handleReset} style={styles.button}>
            <Text style={styles.buttonText}>{tr("common:backToHome", "Back to home")}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.surface, flex: 1 },
  content: { flexGrow: 1, gap: spacing[4], justifyContent: "center", padding: spacing[6] },
  icon: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: colors.errorSubtle,
    borderRadius: radius.pill,
    height: 64,
    justifyContent: "center",
    width: 64
  },
  iconText: { ...text("h1", "bold"), color: colors.error },
  title: { ...text("h2", "bold"), color: colors.text, textAlign: "center" },
  body: { ...text("body"), color: colors.textMuted, textAlign: "center" },
  detailCard: {
    backgroundColor: colors.surfaceSunk,
    borderRadius: radius.md,
    padding: spacing[4]
  },
  detailText: { ...text("caption"), color: colors.textMuted },
  button: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing[4]
  },
  buttonText: { ...text("body", "bold"), color: colors.textInverse }
});
