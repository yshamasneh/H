import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { listAdminAuditLog, type AdminAuditLogEntry } from "../../core/api";
import { getAccessToken } from "../../core/session";
import i18n from "../../i18n";
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
  const { t } = useTranslation(["admin"]);
  const [entries, setEntries] = useState<AdminAuditLogEntry[] | null>(null);
  const [action, setAction] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const token = await getAccessToken();
      if (!token) throw new Error(i18n.t("common:sessionExpired"));
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
    <AdminPage onBack={onBack} subtitle={t("auditLog.subtitle")} title={t("auditLog.title")}>
      <View style={adminStyles.reasonBox}>
        <Input onChangeText={setAction} placeholder={t("auditLog.filterPlaceholder")} value={action} />
        <ActionButton label={t("auditLog.filterButton")} onPress={() => void load()} />
      </View>
      <ErrorBanner message={error} />
      {entries === null ? (
        <LoadingState />
      ) : entries.length === 0 ? (
        <EmptyState message={t("auditLog.empty")} />
      ) : (
        entries.map((entry) => (
          <Card key={entry.id}>
            <CardTitle>{entry.action.replace(/_/g, " ")}</CardTitle>
            <Meta>{formatDate(entry.createdAt)}</Meta>
            <KeyValue label={t("auditLog.administratorLabel")} value={entry.actorFullName} />
            <KeyValue label={t("auditLog.entityLabel")} value={`${entry.entityType} (${entry.entityId.slice(0, 8)})`} />
            <KeyValue label={t("auditLog.reasonLabel")} value={entry.reason ?? t("auditLog.noReason")} />
          </Card>
        ))
      )}
    </AdminPage>
  );
}
