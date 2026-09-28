import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import i18n from "../../i18n";
import {
  approveAdminDriver,
  fetchAdminAccess,
  listAdminDriverCash,
  listAdminDrivers,
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
  PhoneNumber,
  StatusPill,
  useAdminStyles,
  readAdminError
} from "./ui";
import { matchesDriverFilter, selectDrivers, visibleDriverFilters, type DriverFilter } from "./drivers.rules";
import { formatMinorExact } from "./users.rules";

export { matchesDriverFilter } from "./drivers.rules";

/**
 * Drivers on the phone: find one by name or number, see who is on shift, call them, receive the
 * cash they hold, and add a new driver account — the only way a driver account is made.
 * Opening a driver shows the account controls (edit, new password, suspend).
 */
export function AdminDriversScreen({
  onBack,
  initialFilter,
  onOpenCash,
  onOpenDriver,
  onAddDriver,
  tabRoot
}: {
  onBack?: () => void;
  initialFilter?: DriverFilter;
  onOpenCash?: (driverUserId: string) => void;
  onOpenDriver?: (driverUserId: string) => void;
  onAddDriver?: () => void;
  tabRoot?: boolean;
}) {
  const adminStyles = useAdminStyles();
  const { t } = useTranslation(["admin", "common"]);
  const [drivers, setDrivers] = useState<AdminDriver[] | null>(null);
  const [filter, setFilter] = useState<DriverFilter>(initialFilter ?? "ALL");
  const [search, setSearch] = useState("");
  // Cash held per driver, when the account can read the books; otherwise the badge is just absent.
  const [cashHeld, setCashHeld] = useState<Map<string, number>>(new Map());
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

  async function approve(userId: string) {
    setBusyId(userId);
    try {
      await approveAdminDriver(await requireToken(), userId);
      await load();
    } catch (requestError) {
      setError(readAdminError(requestError));
    } finally {
      setBusyId(null);
    }
  }

  const rows = useMemo(() => selectDrivers(drivers ?? [], filter, search), [drivers, filter, search]);
  const filters = visibleDriverFilters(drivers ?? [], filter);

  return (
    <AdminPage
      headerAction={onAddDriver ? <ActionButton label={t("drivers.add")} onPress={onAddDriver} /> : undefined}
      onBack={onBack}
      subtitle={t("drivers.subtitle")}
      tabRoot={tabRoot}
      title={t("drivers.title")}
    >
      {drivers && drivers.length > 0 ? (
        <Input onChangeText={setSearch} placeholder={t("drivers.searchPlaceholder")} value={search} />
      ) : null}
      <FilterChips
        onChange={setFilter}
        options={filters.map((value) => ({
          value,
          label: `${t(`drivers.filters.${value}`)}${drivers ? ` (${drivers.filter((driver) => matchesDriverFilter(driver, value)).length})` : ""}`
        }))}
        value={filter}
      />
      <ErrorBanner message={error} />
      {drivers === null ? (
        <LoadingState />
      ) : drivers.length === 0 ? (
        <View style={{ gap: 12 }}>
          <EmptyState message={t("drivers.emptyFirst")} />
          {onAddDriver ? <ActionButton label={t("drivers.add")} onPress={onAddDriver} /> : null}
        </View>
      ) : rows.length === 0 ? (
        <EmptyState message={t("drivers.empty")} />
      ) : (
        rows.map((driver) => (
          <Card key={driver.userId} onPress={onOpenDriver ? () => onOpenDriver(driver.userId) : undefined}>
            <View style={adminStyles.rowBetween}>
              <View style={{ flex: 1 }}>
                <CardTitle>{driver.fullName}</CardTitle>
                <PhoneNumber phone={driver.phone} />
              </View>
              <StatusPill status={driver.status === "APPROVED" && driver.isOnline ? "ONLINE" : driver.status} />
            </View>
            <KeyValue label={t("drivers.completedDeliveriesLabel")} value={String(driver.completedDeliveriesCount)} />
            {driver.activeDeliveryId ? <KeyValue label={t("drivers.deliveringNow")} value={t("common:yes")} /> : null}
            {cashHeld.has(driver.userId) ? (
              <View style={adminStyles.rowBetween}>
                <KeyValue label={t("drivers.cashHeldLabel")} value={formatMinorExact(cashHeld.get(driver.userId)!)} />
                {onOpenCash ? (
                  <ActionButton label={t("drivers.receiveCash")} onPress={() => onOpenCash(driver.userId)} variant="secondary" />
                ) : null}
              </View>
            ) : null}
            {driver.status === "PENDING" ? (
              <ActionRow>
                <ActionButton label={t("common:approve")} loading={busyId === driver.userId} onPress={() => void approve(driver.userId)} />
              </ActionRow>
            ) : null}
          </Card>
        ))
      )}
    </AdminPage>
  );
}

async function requireToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error(i18n.t("common:sessionExpired"));
  return token;
}
