import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import i18n from "../../i18n";
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
  const { t } = useTranslation(["admin", "common"]);
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
    <AdminPage onBack={onBack} subtitle={t("drivers.subtitle")} title={t("drivers.title")}>
      <ErrorBanner message={error} />
      {drivers === null ? (
        <LoadingState />
      ) : drivers.length === 0 ? (
        <EmptyState message={t("drivers.empty")} />
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
              <KeyValue label={t("drivers.onlineLabel")} value={driver.isOnline ? t("common:yes") : t("common:no")} />
              <KeyValue label={t("drivers.completedDeliveriesLabel")} value={String(driver.completedDeliveriesCount)} />
              <KeyValue label={t("drivers.createdLabel")} value={formatDate(driver.createdAt)} />

              {selected ? (
                <View style={adminStyles.reasonBox}>
                  <Input
                    multiline
                    onChangeText={setReason}
                    placeholder={t(selected.kind === "reject" ? "drivers.reasonPlaceholderReject" : "drivers.reasonPlaceholderSuspend")}
                    value={reason}
                  />
                  <ActionButton
                    disabled={!reason.trim()}
                    label={t(selected.kind === "reject" ? "drivers.confirmRejectButton" : "drivers.confirmSuspendButton")}
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
                    <ActionButton label={t("common:approve")} loading={busyId === driver.userId} onPress={() => void act(driver.userId, (token) => approveAdminDriver(token, driver.userId))} />
                    <ActionButton label={t("common:reject")} onPress={() => setReasonAction({ userId: driver.userId, kind: "reject" })} variant="danger" />
                  </>
                ) : null}
                {driver.status === "APPROVED" ? (
                  <ActionButton label={t("common:suspend")} onPress={() => setReasonAction({ userId: driver.userId, kind: "suspend" })} variant="danger" />
                ) : null}
                {driver.status === "SUSPENDED" ? (
                  <ActionButton label={t("common:reactivate")} loading={busyId === driver.userId} onPress={() => void act(driver.userId, (token) => reactivateAdminDriver(token, driver.userId))} />
                ) : null}
                {selected ? <ActionButton label={t("common:close")} onPress={() => setReasonAction(null)} variant="secondary" /> : null}
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
  if (!token) throw new Error(i18n.t("common:sessionExpired"));
  return token;
}
