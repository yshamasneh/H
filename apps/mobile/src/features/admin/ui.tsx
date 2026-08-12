import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import i18n from "../../i18n";
import { colors, radius, shadow, spacing, statusFamily, statusPalette } from "../../theme/tokens";
import { text } from "../../theme/typography";

const brandMarkSource = require("../../../assets/logo/jovo-mark.png");

export function AdminPage(props: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation(["common"]);
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={colors.surface} barStyle="dark-content" />
      <View style={styles.header}>
        {props.onBack ? (
          <Pressable onPress={props.onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>{t("back")}</Text>
          </Pressable>
        ) : (
          <View style={styles.brandMark}>
            <Image
              accessibilityLabel="JOVO"
              resizeMode="contain"
              source={brandMarkSource}
              style={styles.brandMarkImage}
            />
          </View>
        )}
        <View style={styles.headerText}>
          <Text style={styles.title}>{props.title}</Text>
          {props.subtitle ? <Text style={styles.subtitle}>{props.subtitle}</Text> : null}
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {props.children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card(props: { children: ReactNode; onPress?: () => void }) {
  if (props.onPress) {
    return (
      <Pressable onPress={props.onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        {props.children}
      </Pressable>
    );
  }
  return <View style={styles.card}>{props.children}</View>;
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.cardTitle}>{children}</Text>;
}

export function Meta({ children }: { children: ReactNode }) {
  return <Text style={styles.meta}>{children}</Text>;
}

export function KeyValue(props: { label: string; value: string }) {
  return (
    <View style={styles.keyValue}>
      <Text style={styles.key}>{props.label}</Text>
      <Text style={styles.value}>{props.value}</Text>
    </View>
  );
}

export function StatusPill({ status }: { status: string }) {
  const { t } = useTranslation(["common"]);
  const palette = statusPalette[statusFamily(status)];
  return (
    <View style={[styles.pill, { backgroundColor: palette.background }]}>
      <Text style={[styles.pillText, { color: palette.foreground }]}>{t(`status.${status}`, status.replace(/_/g, " "))}</Text>
    </View>
  );
}

export function ActionButton(props: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "danger" | "secondary";
  disabled?: boolean;
  loading?: boolean;
}) {
  const variant = props.variant ?? "primary";
  return (
    <Pressable
      disabled={props.disabled || props.loading}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.actionButton,
        variant === "primary" && styles.primaryButton,
        variant === "danger" && styles.dangerButton,
        variant === "secondary" && styles.secondaryButton,
        (pressed || props.disabled || props.loading) && styles.pressed
      ]}
    >
      {props.loading ? (
        <ActivityIndicator color={variant === "secondary" ? colors.text : colors.textInverse} />
      ) : (
        <Text style={[styles.actionText, variant === "secondary" && styles.secondaryText]}>{props.label}</Text>
      )}
    </Pressable>
  );
}

export function ActionRow({ children }: { children: ReactNode }) {
  return <View style={styles.actionRow}>{children}</View>;
}

export function Input(props: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  return (
    <TextInput
      multiline={props.multiline}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      placeholderTextColor={colors.textMuted}
      style={[styles.input, props.multiline && styles.multilineInput]}
      value={props.value}
    />
  );
}

export function FilterChips<T extends string>(props: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
      {props.options.map((option) => (
        <Pressable
          key={option.value}
          onPress={() => props.onChange(option.value)}
          style={[styles.chip, props.value === option.value && styles.chipSelected]}
        >
          <Text style={[styles.chipText, props.value === option.value && styles.chipTextSelected]}>
            {option.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function LoadingState() {
  return (
    <View style={styles.stateBox}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <Text style={styles.empty}>{message}</Text>;
}

export function ErrorBanner({ message }: { message: string | null }) {
  return message ? <Text style={styles.error}>{message}</Text> : null;
}

export function formatMoney(minor: number): string {
  return `${(minor / 100).toFixed(2)} ILS`;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

export function readAdminError(error: unknown): string {
  return error instanceof Error ? error.message : i18n.t("common:genericError");
}

export const adminStyles = StyleSheet.create({
  sectionTitle: { ...text("h3", "bold"), color: colors.text, marginBottom: spacing[3], marginTop: spacing[3] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[3] },
  statCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    minWidth: 145,
    padding: spacing[4],
    flexGrow: 1,
    ...shadow[1]
  },
  statValue: { ...text("display", "heavy"), color: colors.text },
  statLabel: { ...text("label", "medium"), color: colors.textMuted, marginTop: spacing[1] },
  rowBetween: { alignItems: "center", flexDirection: "row", gap: spacing[3], justifyContent: "space-between" },
  reasonBox: { backgroundColor: colors.surfaceSunk, borderRadius: radius.md, marginTop: spacing[3], padding: spacing[3] }
});

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.surfaceSunk, flex: 1 },
  header: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4]
  },
  headerText: { flex: 1 },
  brandMark: {
    alignItems: "center",
    backgroundColor: colors.surfaceSunk,
    borderRadius: radius.md,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  brandMarkImage: { height: 22, width: 22 },
  title: { ...text("h2", "bold"), color: colors.text },
  subtitle: { ...text("caption"), color: colors.textMuted, marginTop: spacing[1] },
  backButton: {
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  backButtonText: { ...text("caption", "semibold"), color: colors.text },
  content: { gap: spacing[3], padding: spacing[5], paddingBottom: spacing[9] },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, padding: spacing[4], ...shadow[1] },
  cardTitle: { ...text("h3", "semibold"), color: colors.text },
  meta: { ...text("bodySm"), color: colors.textMuted, marginTop: spacing[1] },
  keyValue: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing[3],
    justifyContent: "space-between",
    paddingVertical: spacing[2]
  },
  key: { ...text("bodySm"), color: colors.textMuted, flex: 1 },
  value: { ...text("bodySm", "semibold"), color: colors.text, flex: 1, textAlign: "auto" },
  pill: { alignSelf: "flex-start", borderRadius: radius.pill, marginTop: spacing[2], paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
  pillText: { ...text("label", "medium") },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2], marginTop: spacing[3] },
  actionButton: { alignItems: "center", borderRadius: radius.sm, justifyContent: "center", minHeight: 44, minWidth: 100, paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  primaryButton: { backgroundColor: colors.primary },
  dangerButton: { backgroundColor: colors.error },
  secondaryButton: { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1 },
  actionText: { ...text("bodySm", "semibold"), color: colors.textInverse },
  secondaryText: { color: colors.text },
  pressed: { opacity: 0.62 },
  input: { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderRadius: radius.sm, borderWidth: 1, color: colors.text, ...text("bodySm"), paddingHorizontal: spacing[3], paddingVertical: spacing[3] },
  multilineInput: { minHeight: 78, textAlignVertical: "top" },
  chips: { flexGrow: 0 },
  chip: { backgroundColor: colors.surfaceSunk, borderRadius: radius.pill, marginEnd: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  chipSelected: { backgroundColor: colors.primary },
  chipText: { ...text("caption", "medium"), color: colors.textMuted },
  chipTextSelected: { color: colors.textInverse },
  stateBox: { alignItems: "center", justifyContent: "center", paddingVertical: spacing[9] },
  empty: { ...text("bodySm"), color: colors.textMuted, padding: spacing[7], textAlign: "center" },
  error: { backgroundColor: colors.errorSubtle, borderRadius: radius.sm, color: colors.error, padding: spacing[3], ...text("bodySm") }
});
