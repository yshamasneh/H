import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import i18n from "../../i18n";
import {
  approveAdminDriver,
  fetchAdminAccess,
  listAdminDriverCash,
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
  FilterChips,
  Input,
  KeyValue,
  LoadingState,
  Meta,
  PhoneNumber,
  StatusPill,
  useAdminStyles,
  formatDate,
  readAdminError
} from "./ui";
import { formatMinorExact } from "./users.rules";

type DriverFilter = "ALL" | "PENDING" | "ONLINE" | "APPROVED" | "SUSPENDED" | "REJECTED";
const driverFilters: DriverFilter[] = ["ALL", "PENDING", "ONLINE", "APPROVED", "SUSPENDED", "REJECTED"];

export function matchesDriverFilter(driver: Pick<AdminDriver, "status" | "isOnline">, filter: DriverFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "ONLINE") return driver.status === "APPROVED" && driver.isOnline;
  return driver.status === filter;
}

/**
 * Drivers on the phone: approvals first when there are any, who is on shift, a call away, and
 * whether they are holding customers' cash (with a way to receive it).
 */
export function AdminDriversScreen({
  onBack,
  initialFilter,
  onOpenCash
}: {
  onBack: () => void;
  initialFilter?: DriverFilter;
  onOpenCash?: (driverUserId: string) => void;
}) {
  const adminStyles = useAdminStyles();
  const { t } = useTranslation(["admin", "common"]);
  const [drivers, setDrivers] = useState<AdminDriver[] | null>(null);
  const [filter, setFilter] = useState<DriverFilter>(initialFilter ?? "ALL");
  // Cash held per driver, when the account can read the books; otherwise the badge is just absent.
  const [cashHeld, setCashHeld] = useState<Map<string, number>>(new Map());
  const [reasonAction, setReasonAction] = useState<{ userId: string; kind: "reject" | "suspend" } | null>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const token = await requireToken();
      setDrivers(await listAdminDrivers(token));
      setError(null);
      const access = await fetchAdminAccess(token).catch(() => null);
      if (access && (access.isSuperAdmin || access.permissions.includes("VIEW_ACCOUNTING"))) {
        const cash = await listAdminDriverCash(token).catch(() => []);
        setCashHeld(new Map(cash.filter((row) => row.outstandingMinor > 0).map((row) => [row.driverUserId, row.outstandingMinor])));
      }
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
      <FilterChips
        onChange={setFilter}
        options={driverFilters.map((value) => ({
          value,
          label: `${t(`drivers.filters.${value}`)}${drivers ? ` (${drivers.filter((driver) => matchesDriverFilter(driver, value)).length})` : ""}`
        }))}
        value={filter}
      />
      <ErrorBanner message={error} />
      {drivers === null ? (
        <LoadingState />
      ) : drivers.filter((driver) => matchesDriverFilter(driver, filter)).length === 0 ? (
        <EmptyState message={t("drivers.empty")} />
      ) : (
        drivers.filter((driver) => matchesDriverFilter(driver, filter)).map((driver) => {
          const selected = reasonAction?.userId === driver.userId ? reasonAction : null;
          return (
            <Card key={driver.userId}>
              <View style={adminStyles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <CardTitle>{driver.fullName}</CardTitle>
                  <PhoneNumber phone={driver.phone} />
                </View>
                <StatusPill status={driver.status} />
              </View>
              <KeyValue label={t("drivers.onlineLabel")} value={driver.isOnline ? t("common:yes") : t("common:no")} />
              <KeyValue label={t("drivers.completedDeliveriesLabel")} value={String(driver.completedDeliveriesCount)} />
              <KeyValue label={t("drivers.createdLabel")} value={formatDate(driver.createdAt)} />
              {cashHeld.has(driver.userId) ? (
                <View style={adminStyles.rowBetween}>
                  <KeyValue label={t("drivers.cashHeldLabel")} value={formatMinorExact(cashHeld.get(driver.userId)!)} />
                  {onOpenCash ? (
                    <ActionButton label={t("drivers.receiveCash")} onPress={() => onOpenCash(driver.userId)} variant="secondary" />
                  ) : null}
                </View>
              ) : null}

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
