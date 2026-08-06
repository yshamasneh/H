import { useEffect, useState } from "react";
import { View } from "react-native";
import { listAdminAuditLog, type AdminAuditLogEntry } from "../../core/api";
import { getAccessToken } from "../../core/session";
import {
  ActionButton,
  AdminPage,
  Card,
  CardTitle,
  EmptyState,
  ErrorBanner,
  Input,
  KeyValue,
  LoadingState,
  Meta,
  adminStyles,
  formatDate,
  readAdminError
} from "./ui";

export function AdminAuditLogScreen({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<AdminAuditLogEntry[] | null>(null);
  const [action, setAction] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Your session has expired. Please log in again.");
      const page = await listAdminAuditLog(token, { action: action.trim() || undefined });
      setEntries(page.items);
      setError(null);
    } catch (requestError) {
      setError(readAdminError(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <AdminPage onBack={onBack} subtitle="Recorded administrator actions and reasons" title="Audit Log">
      <View style={adminStyles.reasonBox}>
        <Input onChangeText={setAction} placeholder="Action, e.g. RESTAURANT_SUSPENDED" value={action} />
        <ActionButton label="Filter" onPress={() => void load()} />
      </View>
      <ErrorBanner message={error} />
      {entries === null ? (
        <LoadingState />
      ) : entries.length === 0 ? (
        <EmptyState message="No audit entries match this filter." />
      ) : (
        entries.map((entry) => (
          <Card key={entry.id}>
            <CardTitle>{entry.action.replace(/_/g, " ")}</CardTitle>
            <Meta>{formatDate(entry.createdAt)}</Meta>
            <KeyValue label="Administrator" value={entry.actorFullName} />
            <KeyValue label="Entity" value={`${entry.entityType} (${entry.entityId.slice(0, 8)})`} />
            <KeyValue label="Reason" value={entry.reason ?? "—"} />
          </Card>
        ))
      )}
    </AdminPage>
  );
}
