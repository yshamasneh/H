import { useEffect, useState } from "react";
import { View } from "react-native";
import { listAdminUsers, type AdminUser, type UserRole } from "../../core/api";
import { getAccessToken } from "../../core/session";
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

const roles: { label: string; value: RoleFilter }[] = [
  { label: "All", value: "ALL" },
  { label: "Customers", value: "CUSTOMER" },
  { label: "Restaurants", value: "RESTAURANT" },
  { label: "Drivers", value: "DRIVER" },
  { label: "Admins", value: "ADMIN" }
];

export function AdminUsersScreen({ onBack }: { onBack: () => void }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [role, setRole] = useState<RoleFilter>("ALL");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Your session has expired. Please log in again.");
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
    <AdminPage onBack={onBack} subtitle="Search accounts by role, name, or phone" title="Users">
      <FilterChips onChange={setRole} options={roles} value={role} />
      <View style={adminStyles.reasonBox}>
        <Input onChangeText={setSearch} placeholder="Name or phone number" value={search} />
        <ActionButton label="Search" onPress={() => void load()} />
      </View>
      <ErrorBanner message={error} />
      {users === null ? (
        <LoadingState />
      ) : users.length === 0 ? (
        <EmptyState message="No users match this search." />
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
            <KeyValue label="Role" value={user.role} />
            <KeyValue label="Phone verified" value={user.phoneVerifiedAt ? "Yes" : "No"} />
            <KeyValue label="Created" value={formatDate(user.createdAt)} />
          </Card>
        ))
      )}
    </AdminPage>
  );
}
