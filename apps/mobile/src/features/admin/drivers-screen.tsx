import { useEffect, useState } from "react";
import { View } from "react-native";
import {
  approveAdminDriver,
  listAdminDrivers,
  reactivateAdminDriver,
  rejectAdminDriver,
  suspendAdminDriver,
  type AdminDriver
} from "../../core/api";
import { getAccessToken } from "../../core/session";
import {
  ActionButton,
  ActionRow,
  AdminPage,
  Card,
  CardTitle,
  EmptyState,
  ErrorBanner,
  Input,
  KeyValue,
  LoadingState,
  Meta,
  StatusPill,
  adminStyles,
  formatDate,
  readAdminError
} from "./ui";

export function AdminDriversScreen({ onBack }: { onBack: () => void }) {
  const [drivers, setDrivers] = useState<AdminDriver[] | null>(null);
  const [reasonAction, setReasonAction] = useState<{ userId: string; kind: "reject" | "suspend" } | null>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setDrivers(await listAdminDrivers(await requireToken()));
      setError(null);
    } catch (requestError) {
      setError(readAdminError(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function act(userId: string, action: (token: string) => Promise<unknown>) {
    setBusyId(userId);
    try {
      await action(await requireToken());
      setReasonAction(null);
      setReason("");
      await load();
    } catch (requestError) {
      setError(readAdminError(requestError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AdminPage onBack={onBack} subtitle="Approvals and delivery availability" title="Drivers">
      <ErrorBanner message={error} />
      {drivers === null ? (
        <LoadingState />
      ) : drivers.length === 0 ? (
        <EmptyState message="No driver accounts yet." />
      ) : (
        drivers.map((driver) => {
          const selected = reasonAction?.userId === driver.userId ? reasonAction : null;
          return (
            <Card key={driver.userId}>
              <View style={adminStyles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <CardTitle>{driver.fullName}</CardTitle>
                  <Meta>{driver.phone}</Meta>
                </View>
                <StatusPill status={driver.status} />
              </View>
              <KeyValue label="Online" value={driver.isOnline ? "Yes" : "No"} />
              <KeyValue label="Completed deliveries" value={String(driver.completedDeliveriesCount)} />
              <KeyValue label="Created" value={formatDate(driver.createdAt)} />

              {selected ? (
                <View style={adminStyles.reasonBox}>
                  <Input
                    multiline
                    onChangeText={setReason}
                    placeholder={`Required ${selected.kind} reason`}
                    value={reason}
                  />
                  <ActionButton
                    disabled={!reason.trim()}
                    label={`Confirm ${selected.kind}`}
                    loading={busyId === driver.userId}
                    onPress={() =>
                      void act(driver.userId, (token) =>
                        selected.kind === "reject"
                          ? rejectAdminDriver(token, driver.userId, reason.trim())
                          : suspendAdminDriver(token, driver.userId, reason.trim())
                      )
                    }
                    variant="danger"
                  />
                </View>
              ) : null}

              <ActionRow>
                {driver.status === "PENDING" ? (
                  <>
                    <ActionButton label="Approve" loading={busyId === driver.userId} onPress={() => void act(driver.userId, (token) => approveAdminDriver(token, driver.userId))} />
                    <ActionButton label="Reject" onPress={() => setReasonAction({ userId: driver.userId, kind: "reject" })} variant="danger" />
                  </>
                ) : null}
                {driver.status === "APPROVED" ? (
                  <ActionButton label="Suspend" onPress={() => setReasonAction({ userId: driver.userId, kind: "suspend" })} variant="danger" />
                ) : null}
                {driver.status === "SUSPENDED" ? (
                  <ActionButton label="Reactivate" loading={busyId === driver.userId} onPress={() => void act(driver.userId, (token) => reactivateAdminDriver(token, driver.userId))} />
                ) : null}
                {selected ? <ActionButton label="Close" onPress={() => setReasonAction(null)} variant="secondary" /> : null}
              </ActionRow>
            </Card>
          );
        })
      )}
    </AdminPage>
  );
}

async function requireToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error("Your session has expired. Please log in again.");
  return token;
}
