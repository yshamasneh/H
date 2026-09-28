import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import {
  assignAdminPlatformRole,
  createAdminAccount,
  fetchAdminAccess,
  listAdminUsers,
  setAdminUserActive,
  type AdminAccess,
  type AdminUser
} from "../../core/api";
import { getAccessToken } from "../../core/session";
import i18n from "../../i18n";
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
  Pager,
  PhoneNumber,
  StatusPill,
  useAdminStyles,
  formatDate,
  readAdminError
} from "./ui";
import {
  canSubmitNewAdmin,
  hasAdminPermission,
  pageCount,
  staffRoleFilters,
  userSections,
  usersListQuery,
  usersPageSize,
  type StaffRoleFilter,
  type UserSection
} from "./users.rules";

async function requireToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error(i18n.t("common:sessionExpired"));
  return token;
}

const emptyDraft = { fullName: "", countryCode: "+970", phoneNumber: "", password: "", makeSuperAdmin: false };

/**
 * The admin Users screen, at parity with the admin web console: customers and staff are separate
 * lists; customer rows lead with the registered phone and open the customer detail; staff rows carry
 * the role and the administrator tools. What each account may do comes from the API's access context.
 */
export function AdminUsersScreen(props: {
  currentUserId: string;
  onBack: () => void;
  onOpenCustomer: (userId: string) => void;
}) {
  const adminStyles = useAdminStyles();
  const { t } = useTranslation(["admin", "common"]);
  const [section, setSection] = useState<UserSection>("customers");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [role, setRole] = useState<StaffRoleFilter>("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [access, setAccess] = useState<AdminAccess | null>(null);
  const [suspending, setSuspending] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const requestSeq = useRef(0);

  const canManageAdmins = hasAdminPermission(access, "MANAGE_ADMINS");
  // The customer detail shows order history, which the API guards with VIEW_ALL_ORDERS as well.
  const canViewCustomerOrders = hasAdminPermission(access, "VIEW_ALL_ORDERS");

  useEffect(() => {
    let cancelled = false;
    requireToken()
      .then(fetchAdminAccess)
      .then((result) => {
        if (!cancelled) setAccess(result);
      })
      .catch(() => {
        // Without an access context every permission-gated control stays hidden; the list still loads.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function load() {
    const seq = ++requestSeq.current;
    try {
      const token = await requireToken();
      const result = await listAdminUsers(token, usersListQuery(section, { role, search, page, pageSize: usersPageSize }));
      if (seq !== requestSeq.current) return;
      setUsers(result.items);
      setTotal(result.total);
      setError(null);
    } catch (requestError) {
      if (seq === requestSeq.current) setError(readAdminError(requestError));
    }
  }

  useEffect(() => {
    const timeout = setTimeout(() => void load(), 250);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, role, search, page]);

  function selectSection(next: UserSection) {
    if (next === section) return;
    setUsers(null);
    setRole("ALL");
    setPage(1);
    setNotice(null);
    setSuspending(null);
    setSection(next);
  }

  async function run(action: (token: string) => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    try {
      await action(await requireToken());
      await load();
      setError(null);
      return true;
    } catch (requestError) {
      setError(readAdminError(requestError));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const sections = userSections.map((value) => ({ value, label: t(`users.sections.${value}`) }));
  const roles = staffRoleFilters.map((value) => ({
    value,
    label: value === "ALL" ? t("users.allStaffRoles") : t(`common:role.${value}`)
  }));

  function accessActions(user: AdminUser) {
    if (suspending === user.id) {
      return (
        <View style={adminStyles.reasonBox}>
          <Meta>{t("users.suspendDescription", { name: user.fullName })}</Meta>
          <Input multiline onChangeText={setReason} placeholder={t("users.suspendReasonPlaceholder")} value={reason} />
          <ActionRow>
            <ActionButton
              disabled={!reason.trim()}
              label={t("users.suspend")}
              loading={busy}
              onPress={() =>
                void run((token) => setAdminUserActive(token, user.id, false, reason)).then((done) => {
                  if (done) {
                    setSuspending(null);
                    setReason("");
                  }
                })
              }
              variant="danger"
            />
            <ActionButton label={t("common:cancel")} onPress={() => setSuspending(null)} variant="secondary" />
          </ActionRow>
        </View>
      );
    }
    return user.isActive ? (
      <ActionButton
        label={t("users.suspend")}
        onPress={() => {
          setReason("");
          setSuspending(user.id);
        }}
        variant="danger"
      />
    ) : (
      <ActionButton
        label={t("users.restore")}
        loading={busy}
        onPress={() => void run((token) => setAdminUserActive(token, user.id, true, t("users.restoredReason")))}
        variant="secondary"
      />
    );
  }

  return (
    <AdminPage onBack={props.onBack} subtitle={t("users.subtitle")} title={t("users.title")}>
      <FilterChips onChange={selectSection} options={sections} value={section} />
      <ErrorBanner message={error} />
      {notice ? <Meta>{notice}</Meta> : null}

      {section === "staff" && canManageAdmins ? (
        <Card>
          <CardTitle>{t("users.createAdminTitle")}</CardTitle>
          <View style={{ gap: 8, marginTop: 8 }}>
            <Input
              autoComplete="off"
              onChangeText={(value) => setDraft({ ...draft, fullName: value })}
              placeholder={t("users.fullName")}
              value={draft.fullName}
            />
            <View style={adminStyles.rowBetween}>
              <View style={{ width: 90 }}>
                <Input
                  autoComplete="off"
                  keyboardType="phone-pad"
                  ltr
                  onChangeText={(value) => setDraft({ ...draft, countryCode: value })}
                  placeholder={t("users.countryCode")}
                  value={draft.countryCode}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Input
                  autoComplete="off"
                  keyboardType="phone-pad"
                  ltr
                  onChangeText={(value) => setDraft({ ...draft, phoneNumber: value })}
                  placeholder={t("users.phoneNumber")}
                  value={draft.phoneNumber}
                />
              </View>
            </View>
            <Input
              autoComplete="new-password"
              onChangeText={(value) => setDraft({ ...draft, password: value })}
              placeholder={t("users.initialPassword")}
              secureTextEntry
              value={draft.password}
            />
            <FilterChips
              onChange={(value) => setDraft({ ...draft, makeSuperAdmin: value === "SUPER_ADMIN" })}
              options={[
                { value: "NONE", label: t("users.noPlatformRole") },
                { value: "SUPER_ADMIN", label: t("users.superAdmin") }
              ]}
              value={draft.makeSuperAdmin ? "SUPER_ADMIN" : "NONE"}
            />
            <ActionButton
              disabled={!canSubmitNewAdmin(draft)}
              label={t("users.createAdmin")}
              loading={busy}
              onPress={() =>
                void run((token) =>
                  createAdminAccount(token, {
                    fullName: draft.fullName.trim(),
                    countryCode: draft.countryCode.trim(),
                    phoneNumber: draft.phoneNumber.trim(),
                    password: draft.password,
                    platformRoleKey: draft.makeSuperAdmin ? "SUPER_ADMIN" : undefined
                  })
                ).then((done) => {
                  if (done) {
                    setNotice(t("users.createdNotice"));
                    setDraft(emptyDraft);
                  }
                })
              }
            />
            <Meta>{t("users.passwordHint")}</Meta>
          </View>
        </Card>
      ) : null}

      <CardTitle>{t(`users.sectionTitles.${section}`)}</CardTitle>
      {section === "staff" ? (
        <FilterChips
          onChange={(value) => {
            setRole(value);
            setPage(1);
          }}
          options={roles}
          value={role}
        />
      ) : null}
      <Input
        onChangeText={(value) => {
          setSearch(value);
          setPage(1);
        }}
        placeholder={t("users.searchPlaceholder")}
        value={search}
      />

      {users === null ? (
        <LoadingState />
      ) : users.length === 0 ? (
        <EmptyState message={t(`users.emptySection.${section}`)} />
      ) : section === "customers" ? (
        users.map((user) => (
          <Card key={user.id}>
            <View style={adminStyles.rowBetween}>
              <View style={{ flex: 1 }}>
                <CardTitle>{user.fullName}</CardTitle>
              </View>
              <StatusPill status={user.isActive ? "ACTIVE" : "INACTIVE"} />
            </View>
            <Meta>{t("users.registeredPhone")}</Meta>
            <PhoneNumber phone={user.phone} />
            <KeyValue label={t("users.joined")} value={formatDate(user.createdAt)} />
            <ActionRow>
              {canViewCustomerOrders ? (
                <ActionButton label={t("users.viewCustomer")} onPress={() => props.onOpenCustomer(user.id)} variant="secondary" />
              ) : null}
              {suspending === user.id ? null : accessActions(user)}
            </ActionRow>
            {suspending === user.id ? accessActions(user) : null}
          </Card>
        ))
      ) : (
        users.map((user) => {
          const isSelf = user.id === props.currentUserId;
          return (
            <Card key={user.id}>
              <View style={adminStyles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <CardTitle>
                    {user.fullName}
                    {isSelf ? ` · ${t("users.you")}` : ""}
                  </CardTitle>
                </View>
                <StatusPill status={user.isActive ? "ACTIVE" : "INACTIVE"} />
              </View>
              <PhoneNumber phone={user.phone} />
              <KeyValue label={t("users.roleLabel")} value={t(`common:role.${user.role}`)} />
              <KeyValue label={t("users.joined")} value={formatDate(user.createdAt)} />
              {/* Changing your own access is refused by the API too, not just hidden here. */}
              {isSelf ? null : (
                <>
                  <ActionRow>
                    {suspending === user.id ? null : accessActions(user)}
                    {canManageAdmins && user.role === "ADMIN" ? (
                      <ActionButton
                        label={t("users.makeSuperAdmin")}
                        loading={busy}
                        onPress={() => void run((token) => assignAdminPlatformRole(token, user.id, "SUPER_ADMIN"))}
                        variant="secondary"
                      />
                    ) : null}
                    {canManageAdmins && user.role === "ADMIN" ? (
                      <ActionButton
                        label={t("users.removePlatformRole")}
                        loading={busy}
                        onPress={() => void run((token) => assignAdminPlatformRole(token, user.id, undefined))}
                        variant="secondary"
                      />
                    ) : null}
                  </ActionRow>
                  {suspending === user.id ? accessActions(user) : null}
                </>
              )}
            </Card>
          );
        })
      )}
      <Pager onPage={setPage} page={page} pages={pageCount(total)} />
    </AdminPage>
  );
}
