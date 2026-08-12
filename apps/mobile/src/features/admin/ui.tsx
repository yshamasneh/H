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
      <StatusBar backgroundColor="#0F172A" barStyle="light-content" />
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
  const palette = statusPalette(status);
  return (
    <View style={[styles.pill, { backgroundColor: palette.background }]}>
      <Text style={[styles.pillText, { color: palette.text }]}>{t(`status.${status}`, status.replace(/_/g, " "))}</Text>
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
        <ActivityIndicator color={variant === "secondary" ? "#0F766E" : "#FFFFFF"} />
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
      placeholderTextColor="#94A3B8"
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
      <ActivityIndicator color="#0F766E" size="large" />
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

function statusPalette(status: string): { background: string; text: string } {
  if (["APPROVED", "DELIVERED", "ACTIVE", "ONLINE"].includes(status)) {
    return { background: "#DCFCE7", text: "#166534" };
  }
  if (["REJECTED", "CANCELLED", "SUSPENDED", "INACTIVE"].includes(status)) {
    return { background: "#FEE2E2", text: "#991B1B" };
  }
  if (["PENDING", "PLACED", "PENDING_ASSIGNMENT"].includes(status)) {
    return { background: "#FEF3C7", text: "#92400E" };
  }
  return { background: "#DBEAFE", text: "#1E40AF" };
}

export const adminStyles = StyleSheet.create({
  sectionTitle: { color: "#0F172A", fontSize: 18, fontWeight: "800", marginBottom: 10, marginTop: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard: { backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", borderRadius: 14, borderWidth: 1, minWidth: 145, padding: 16, flexGrow: 1 },
  statValue: { color: "#0F766E", fontSize: 25, fontWeight: "900" },
  statLabel: { color: "#475569", fontSize: 13, fontWeight: "700", marginTop: 5 },
  rowBetween: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  reasonBox: { backgroundColor: "#F8FAFC", borderRadius: 12, marginTop: 10, padding: 10 }
});

const styles = StyleSheet.create({
  screen: { backgroundColor: "#F5F7FB", flex: 1 },
  header: { alignItems: "center", backgroundColor: "#0F172A", flexDirection: "row", gap: 12, paddingHorizontal: 18, paddingVertical: 16 },
  headerText: { flex: 1 },
  brandMark: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 11, height: 42, justifyContent: "center", width: 42 },
  brandMarkImage: { height: 22, width: 22 },
  title: { color: "#F8FAFC", fontSize: 21, fontWeight: "900" },
  subtitle: { color: "#94A3B8", fontSize: 12, marginTop: 2 },
  backButton: { borderColor: "#475569", borderRadius: 9, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  backButtonText: { color: "#E2E8F0", fontSize: 13, fontWeight: "700" },
  content: { gap: 12, padding: 18, paddingBottom: 50 },
  card: { backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", borderRadius: 14, borderWidth: 1, padding: 16 },
  cardTitle: { color: "#0F172A", fontSize: 16, fontWeight: "800" },
  meta: { color: "#64748B", fontSize: 13, lineHeight: 19, marginTop: 5 },
  keyValue: { borderBottomColor: "#F1F5F9", borderBottomWidth: 1, flexDirection: "row", gap: 10, justifyContent: "space-between", paddingVertical: 9 },
  key: { color: "#64748B", flex: 1, fontSize: 13 },
  value: { color: "#0F172A", flex: 1, fontSize: 13, fontWeight: "700", textAlign: "auto" },
  pill: { alignSelf: "flex-start", borderRadius: 999, marginTop: 8, paddingHorizontal: 10, paddingVertical: 5 },
  pillText: { fontSize: 11, fontWeight: "900" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  actionButton: { alignItems: "center", borderRadius: 10, justifyContent: "center", minHeight: 42, minWidth: 100, paddingHorizontal: 14, paddingVertical: 10 },
  primaryButton: { backgroundColor: "#0F766E" },
  dangerButton: { backgroundColor: "#B91C1C" },
  secondaryButton: { backgroundColor: "#FFFFFF", borderColor: "#99F6E4", borderWidth: 1 },
  actionText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  secondaryText: { color: "#0F766E" },
  pressed: { opacity: 0.62 },
  input: { backgroundColor: "#FFFFFF", borderColor: "#CBD5E1", borderRadius: 10, borderWidth: 1, color: "#0F172A", fontSize: 14, paddingHorizontal: 13, paddingVertical: 11 },
  multilineInput: { minHeight: 78, textAlignVertical: "top" },
  chips: { flexGrow: 0 },
  chip: { backgroundColor: "#E2E8F0", borderRadius: 999, marginEnd: 8, paddingHorizontal: 13, paddingVertical: 8 },
  chipSelected: { backgroundColor: "#0F766E" },
  chipText: { color: "#475569", fontSize: 12, fontWeight: "700" },
  chipTextSelected: { color: "#FFFFFF" },
  stateBox: { alignItems: "center", minHeight: 180, justifyContent: "center" },
  empty: { color: "#64748B", padding: 30, textAlign: "center" },
  error: { backgroundColor: "#FEE2E2", borderRadius: 10, color: "#991B1B", padding: 12 }
});
