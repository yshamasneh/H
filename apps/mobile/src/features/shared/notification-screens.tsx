import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError, listMyNotifications, markNotificationRead, type NotificationView } from "../../core/api";
import { getAccessToken } from "../../core/session";
import { useRealtimeEvent } from "../../core/socket";

type NotificationInboxScreenProps = {
  onBack: () => void;
};

export function NotificationInboxScreen(props: NotificationInboxScreenProps) {
  const [notifications, setNotifications] = useState<NotificationView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError("Your session has expired. Please log in again.");
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
      <StatusBar backgroundColor="#F5FAFC" barStyle="dark-content" />
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={props.onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Notifications</Text>
      </View>
      {notifications === null ? (
        <View style={styles.centered}>
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={load} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Try Again</Text>
              </Pressable>
            </View>
          ) : (
            <ActivityIndicator color="#0F766E" size="large" />
          )}
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>You have no notifications yet.</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={notifications}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl onRefresh={refresh} refreshing={refreshing} tintColor="#0F766E" />}
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

function readError(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message;
  }
  return "The request could not be completed. Please try again.";
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#F5FAFC", flex: 1 },
  header: {
    backgroundColor: "#FFFFFF",
    borderBottomColor: "#D9E2EC",
    borderBottomWidth: 1,
    padding: 20,
    paddingTop: 12
  },
  backButton: { alignSelf: "flex-start", marginBottom: 10, paddingVertical: 4 },
  backButtonText: { color: "#0369A1", fontSize: 14, fontWeight: "700" },
  headerTitle: { color: "#0F172A", fontSize: 24, fontWeight: "800" },
  centered: { alignItems: "center", flex: 1, justifyContent: "center", padding: 24 },
  emptyText: { color: "#64748B", fontSize: 15, textAlign: "center" },
  listContent: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    padding: 14
  },
  cardUnread: { backgroundColor: "#F0FDFA", borderColor: "#0F766E" },
  cardPressed: { opacity: 0.85 },
  cardHeaderRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  cardTitle: { color: "#0F172A", flex: 1, fontSize: 15, fontWeight: "700" },
  unreadDot: { backgroundColor: "#0F766E", borderRadius: 5, height: 10, marginLeft: 8, width: 10 },
  cardBody: { color: "#475569", fontSize: 13.5, marginTop: 4 },
  cardDate: { color: "#94A3B8", fontSize: 11.5, marginTop: 8 },
  errorBox: { alignItems: "center" },
  errorText: { color: "#B91C1C", fontSize: 14, lineHeight: 20, textAlign: "center" },
  retryButton: {
    borderColor: "#0F766E",
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10
  },
  retryButtonText: { color: "#0F766E", fontSize: 14, fontWeight: "800" }
});
