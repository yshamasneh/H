import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, RefreshControl, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { listMyNotifications, markNotificationRead, type NotificationView } from "../../core/api";
import { readError } from "../../core/errors";
import { getAccessToken } from "../../core/session";
import { useRealtimeEvent } from "../../core/socket";
import { Skeleton } from "../../components/skeleton";
import { Icon, backIconName } from "../../theme/icon";
import { colors, radius, spacing } from "../../theme/tokens";
import { text } from "../../theme/typography";

function NotificationListSkeleton() {
  return (
    <View style={styles.listContent}>
      {[1, 2, 3, 4].map((row) => (
        <View key={row} style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Skeleton height={13} width="55%" />
            <Skeleton height={10} radius={5} width={10} />
          </View>
          <Skeleton height={11} style={styles.skeletonBodyLine} width="85%" />
          <Skeleton height={9} style={styles.skeletonDateLine} width="30%" />
        </View>
      ))}
    </View>
  );
}

type NotificationInboxScreenProps = {
  onBack: () => void;
};

export function NotificationInboxScreen(props: NotificationInboxScreenProps) {
  const { t } = useTranslation(["notifications", "common"]);
  const [notifications, setNotifications] = useState<NotificationView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError(t("common:sessionExpired"));
        return;
      }
      const page = await listMyNotifications(accessToken, 1, 30);
      setNotifications(page.items);
    } catch (requestError) {
      setError(readError(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useRealtimeEvent("notification.created", () => void load());

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function markRead(notification: NotificationView) {
    if (notification.isRead) return;
    setNotifications((current) =>
      current ? current.map((item) => (item.id === notification.id ? { ...item, isRead: true } : item)) : current
    );
    try {
      const accessToken = await getAccessToken();
      if (accessToken) await markNotificationRead(accessToken, notification.id);
    } catch {
      // The list will self-correct on the next load; not worth surfacing a transient error here.
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={colors.surfaceSunk} barStyle="dark-content" />
      <View style={styles.header}>
        <Pressable accessibilityLabel={t("common:back")} accessibilityRole="button" onPress={props.onBack} style={styles.backButton}>
          <Icon name={backIconName()} size="md" />
        </Pressable>
        <Text style={styles.headerTitle}>{t("inbox.title")}</Text>
        <View style={styles.headerSpacer} />
      </View>
      {notifications === null ? (
        error ? (
          <View style={styles.centered}>
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={load} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>{t("inbox.tryAgain")}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <NotificationListSkeleton />
        )
      ) : notifications.length === 0 ? (
        <View style={styles.centered}>
          <View style={styles.emptyIcon}><Icon color={colors.textMuted} name="notifications" size="lg" /></View>
          <Text style={styles.emptyText}>{t("inbox.emptyText")}</Text>
          <Text style={styles.emptyHint}>{t("inbox.emptyHint")}</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={notifications}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl onRefresh={refresh} refreshing={refreshing} tintColor={colors.primary} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => markRead(item)}
              style={({ pressed }) => [styles.card, !item.isRead && styles.cardUnread, pressed && styles.cardPressed]}
            >
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                {!item.isRead ? <View style={styles.unreadDot} /> : null}
              </View>
              <Text style={styles.cardBody}>{item.body}</Text>
              <Text style={styles.cardDate}>{formatDate(item.createdAt)}</Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

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
  backButton: { alignItems: "center", backgroundColor: colors.surfaceSunk, borderRadius: radius.lg, height: 44, justifyContent: "center", width: 44 },
  headerTitle: { ...text("h2", "bold"), color: colors.text, flex: 1, textAlign: "center" },
  headerSpacer: { width: 44 },
  centered: { alignItems: "center", flex: 1, justifyContent: "center", padding: spacing[6] },
  emptyIcon: {
    alignItems: "center",
    backgroundColor: colors.neutralSubtle,
    borderRadius: radius.pill,
    height: 64,
    justifyContent: "center",
    marginBottom: spacing[4],
    width: 64
  },
  emptyText: { ...text("body", "bold"), color: colors.text, textAlign: "center" },
  emptyHint: { ...text("bodySm"), color: colors.textMuted, marginTop: spacing[1], textAlign: "center" },
  listContent: { padding: spacing[4], paddingBottom: spacing[8] },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing[2],
    padding: spacing[4]
  },
  skeletonBodyLine: { marginTop: spacing[2] },
  skeletonDateLine: { marginTop: spacing[3] },
  cardUnread: { backgroundColor: colors.primarySubtle, borderColor: colors.primary },
  cardPressed: { opacity: 0.85 },
  cardHeaderRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  cardTitle: { ...text("bodySm", "bold"), color: colors.text, flex: 1 },
  unreadDot: { backgroundColor: colors.primary, borderRadius: 5, height: 10, marginStart: spacing[2], width: 10 },
  cardBody: { ...text("caption"), color: colors.textMuted, marginTop: spacing[1] },
  cardDate: { ...text("label"), color: colors.textMuted, marginTop: spacing[2] },
  errorBox: { alignItems: "center" },
  errorText: { ...text("bodySm"), color: colors.error, textAlign: "center" },
  retryButton: {
    borderColor: colors.primary,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing[4],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3]
  },
  retryButtonText: { ...text("bodySm", "bold"), color: colors.primary }
});
