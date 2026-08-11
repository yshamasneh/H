import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { listAdminUsers, type AdminUser, type UserRole } from "../../core/api";
import { getAccessToken } from "../../core/session";
import i18n from "../../i18n";
import {
  ActionButton,
  AdminPage,
  Card,
  CardTitle,
  EmptyState,
  ErrorBanner,
  FilterChips,
  Input,
  KeyValue,
  LoadingState,
  Meta,
  StatusPill,
  adminStyles,
  formatDate,
  readAdminError
} from "./ui";

type RoleFilter = "ALL" | UserRole;

const roleValues: RoleFilter[] = ["ALL", "CUSTOMER", "RESTAURANT", "DRIVER", "ADMIN"];

export function AdminUsersScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation(["admin", "common"]);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [role, setRole] = useState<RoleFilter>("ALL");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const roles = roleValues.map((value) => ({
    value,
    label: value === "ALL" ? t("users.filterAll") : t(`common:role.${value}`)
  }));

  async function load() {
    try {
      const token = await getAccessToken();
      if (!token) throw new Error(i18n.t("common:sessionExpired"));
      const page = await listAdminUsers(token, {
        role: role === "ALL" ? undefined : role,
        search: search.trim() || undefined
      });
      setUsers(page.items);
      setError(null);
    } catch (requestError) {
      setError(readAdminError(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, [role]);

  return (
    <AdminPage onBack={onBack} subtitle={t("users.subtitle")} title={t("users.title")}>
      <FilterChips onChange={setRole} options={roles} value={role} />
      <View style={adminStyles.reasonBox}>
        <Input onChangeText={setSearch} placeholder={t("users.searchPlaceholder")} value={search} />
        <ActionButton label={t("common:search")} onPress={() => void load()} />
      </View>
      <ErrorBanner message={error} />
      {users === null ? (
        <LoadingState />
      ) : users.length === 0 ? (
        <EmptyState message={t("users.empty")} />
      ) : (
        users.map((user) => (
          <Card key={user.id}>
            <View style={adminStyles.rowBetween}>
              <View style={{ flex: 1 }}>
                <CardTitle>{user.fullName}</CardTitle>
                <Meta>{user.phone}</Meta>
              </View>
              <StatusPill status={user.isActive ? "ACTIVE" : "INACTIVE"} />
            </View>
            <KeyValue label={t("users.roleLabel")} value={t(`common:role.${user.role}`)} />
            <KeyValue label={t("users.phoneVerifiedLabel")} value={user.phoneVerifiedAt ? t("common:yes") : t("common:no")} />
            <KeyValue label={t("users.createdLabel")} value={formatDate(user.createdAt)} />
          </Card>
        ))
      )}
    </AdminPage>
  );
}
