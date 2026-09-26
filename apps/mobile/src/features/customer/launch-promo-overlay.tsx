import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Animated, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { displayableImageUri, RemoteImage } from "../../components/remote-image";
import type { RestaurantOffer } from "../../core/api";
import { motionDuration, motionEasing, useReducedMotion } from "../../theme/motion";
import { radius, spacing, withAlpha, type ThemeColors } from "../../theme/tokens";
import { useTheme } from "../../theme/theme-context";
import { text } from "../../theme/typography";
import { offerLabel } from "./home-screen";
import { useCustomerTheme } from "./theme";

/** How long the promo stays up before it auto-dismisses into the home screen. */
export const launchPromoDurationMs = 2000;

/**
 * A brief full-screen call-out for the admin's one featured offer, shown once at launch in the gap
 * between the JS splash (a static logo — see App.tsx) and the customer home screen mounting. The
 * native splash configured in app.json can only ever show that same static logo, so this is the
 * earliest point a live, server-driven offer can appear at all.
 *
 * The caller (App.tsx) only renders this when a featured offer actually exists; there is no
 * "no offer" state to design for here — an absent offer means this component is never mounted.
 *
 * The card sits on a fixed JOVO-orange surface regardless of the active light/dark mode (a launch
 * promo is brand colour, not a themable page), so its foreground reuses `textInverse` — the same
 * "text on a coloured/dark surface" token primary buttons and hero panels already use — rather than
 * a literal white.
 */
export function LaunchPromoOverlay(props: { offer: RestaurantOffer; onDone: () => void }) {
  const { t } = useTranslation(["customer"]);
  const { colors } = useTheme();
  const theme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(reducedMotion ? 1 : 0.92)).current;
  const { offer, onDone } = props;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  // A ref, not just the effect's own closure: dismissByTap and the timeout must cancel the exact
  // same pending call, and a manual tap has to stop the timeout from also firing onDone later —
  // App.tsx unmounting this on the first call would make that redundant, but the overlay must not
  // rely on that; it guards its own single-fire guarantee.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: motionDuration.base, easing: motionEasing, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: motionDuration.slow, easing: motionEasing, useNativeDriver: true })
    ]).start();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      doneRef.current();
    }, launchPromoDurationMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // Intentionally fires once per mount: the overlay is mounted exactly once at launch and
    // App.tsx never re-renders it with a different offer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismissByTap() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    onDone();
  }

  const imageUri = displayableImageUri(offer.imageUrl);

  return (
    <Pressable
      accessibilityHint={t("home.launchPromoHint")}
      onPress={dismissByTap}
      style={[styles.screen, { backgroundColor: theme.colors.primary }]}
      testID="launch-promo-overlay"
    >
      <SafeAreaView style={styles.safeArea}>
        <StatusBar backgroundColor={theme.colors.primary} barStyle="light-content" />
        <Animated.View style={[styles.card, { opacity, transform: [{ scale }] }]}>
          {imageUri ? (
            <RemoteImage resizeMode="cover" style={styles.image} uri={imageUri} />
          ) : null}
          <Text style={styles.eyebrow}>{t("home.featuredOfferEyebrow")}</Text>
          <Text numberOfLines={2} style={styles.title}>{offer.title}</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{offerLabel(offer, t)}</Text>
          </View>
          <Text style={styles.hint}>{t("home.launchPromoHint")}</Text>
        </Animated.View>
      </SafeAreaView>
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1 },
    safeArea: { alignItems: "center", flex: 1, justifyContent: "center", padding: spacing[6] },
    card: { alignItems: "center", maxWidth: 420, width: "100%" },
    image: { aspectRatio: 16 / 9, borderRadius: radius.lg, marginBottom: spacing[5], width: "100%" },
    eyebrow: { ...text("label", "bold"), color: withAlpha(colors.textInverse, 0.8), textAlign: "center" },
    title: { ...text("display", "bold"), color: colors.textInverse, marginTop: spacing[2], textAlign: "center" },
    badge: {
      backgroundColor: colors.surface,
      borderRadius: radius.pill,
      marginTop: spacing[4],
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2]
    },
    badgeText: { ...text("body", "bold"), color: colors.text },
    hint: { ...text("bodySm"), color: withAlpha(colors.textInverse, 0.72), marginTop: spacing[6], textAlign: "center" }
  });
}
