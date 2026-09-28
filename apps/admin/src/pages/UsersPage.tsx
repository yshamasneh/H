import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Pager } from "../components/Pager";
import {
  assignPlatformRole,
  createAdminUser,
  listAdminUsers,
  readApiError,
  setUserActive,
  type AdminUserView
} from "../api";
import { useAuth } from "../auth";
import { ReasonModal } from "../components/ReasonModal";
import { StatusBadge } from "../components/StatusBadge";
import { telHref } from "../tel";
import {
  customerDetailPath,
  parseUserSection,
  staffRoleOptions,
  userSections,
  usersListQuery,
  type UserSection
} from "../users-sections";

const listPageSize = 20;

export function UsersPage() {
  const { t } = useTranslation();
  const { can, user: currentUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = parseUserSection(searchParams.get("section"));
  const [users, setUsers] = useState<AdminUserView[] | null>(null);
  const [role, setRole] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingSuspension, setPendingSuspension] = useState<AdminUserView | null>(null);
  const [draft, setDraft] = useState({
    fullName: "",
    countryCode: "+970",
    phoneNumber: "",
    password: "",
    makeSuperAdmin: false
  });

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const canManageAdmins = can("MANAGE_ADMINS");
  // The customer detail shows order history, which the API guards with VIEW_ALL_ORDERS as well.
  const canViewCustomerOrders = can("VIEW_ALL_ORDERS");

  async function load() {
    try {
      const result = await listAdminUsers(usersListQuery(section, { role, search, page, pageSize: listPageSize }));
      setUsers(result.items);
      setTotal(result.total);
      setError(null);
    } catch (requestError) {
      setError(readApiError(requestError, t("users.loadError")));
    }
  }

  useEffect(() => {
    const timeout = setTimeout(() => void load(), 250);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, role, search, page]);

  useEffect(() => {
    setPage(1);
  }, [section, role, search]);

  function selectSection(next: UserSection) {
    if (next === section) return;
    setUsers(null);
    setRole("");
    setNotice(null);
    setSearchParams(next === "customers" ? {} : { section: next });
  }

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await load();
      setError(null);
    } catch (requestError) {
      setError(readApiError(requestError, t("common.genericActionError")));
    }
  }

  function accessActions(user: AdminUserView) {
    return user.isActive ? (
      <button className="btn btn-danger btn-sm" onClick={() => setPendingSuspension(user)} type="button">
        {t("users.suspend")}
      </button>
    ) : (
      <button
        className="btn btn-outline btn-sm"
        onClick={() => void run(() => setUserActive(user.id, true, t("users.restoredReason")))}
        type="button"
      >
        {t("users.restore")}
      </button>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("users.title")}</h1>
          <p className="page-subtitle">{t("users.subtitle")}</p>
        </div>
      </div>

      <div className="tab-row" role="tablist">
        {userSections.map((key) => (
          <button
            aria-selected={key === section}
            className={`btn btn-sm ${key === section ? "btn-primary" : "btn-outline"}`}
            key={key}
            onClick={() => selectSection(key)}
            role="tab"
            type="button"
          >
            {t(`users.sections.${key}`)}
          </button>
        ))}
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="notice-banner">{notice}</div> : null}

      {section === "staff" && canManageAdmins ? (
        <div className="card">
          <h2 className="card-title">{t("users.createAdminTitle")}</h2>
          <div className="filters-row">
            <input
              className="text-input"
              onChange={(event) => setDraft({ ...draft, fullName: event.target.value })}
              placeholder={t("users.fullName")}
              value={draft.fullName}
            />
            <input
              className="text-input"
              onChange={(event) => setDraft({ ...draft, countryCode: event.target.value })}
              placeholder={t("users.countryCode")}
              style={{ maxWidth: 90 }}
              value={draft.countryCode}
            />
            <input
              className="text-input"
              onChange={(event) => setDraft({ ...draft, phoneNumber: event.target.value })}
              placeholder={t("users.phoneNumber")}
              value={draft.phoneNumber}
            />
            <input
              className="text-input"
              onChange={(event) => setDraft({ ...draft, password: event.target.value })}
              placeholder={t("users.initialPassword")}
              type="password"
              value={draft.password}
            />
            <select
              className="select"
              onChange={(event) => setDraft({ ...draft, makeSuperAdmin: event.target.value === "SUPER_ADMIN" })}
              value={draft.makeSuperAdmin ? "SUPER_ADMIN" : ""}
            >
              <option value="">{t("users.noPlatformRole")}</option>
              <option value="SUPER_ADMIN">{t("role.SUPER_ADMIN")}</option>
            </select>
            <button
              className="btn btn-primary btn-sm"
              disabled={!draft.fullName.trim() || !draft.phoneNumber.trim() || draft.password.length < 8}
              onClick={() =>
                void run(async () => {
                  await createAdminUser({
                    fullName: draft.fullName.trim(),
                    countryCode: draft.countryCode.trim(),
                    phoneNumber: draft.phoneNumber.trim(),
                    password: draft.password,
                    platformRoleKey: draft.makeSuperAdmin ? "SUPER_ADMIN" : undefined
                  });
                  setNotice(t("users.createdNotice"));
                  setDraft({ ...draft, fullName: "", phoneNumber: "", password: "", makeSuperAdmin: false });
                })
              }
              type="button"
            >
              {t("users.createAdmin")}
            </button>
          </div>
          <div className="empty-state">{t("users.passwordHint")}</div>
        </div>
      ) : null}

      <div className="card">
        <h2 className="card-title">{t(`users.sectionTitles.${section}`)}</h2>
        <div className="filters-row">
          {section === "staff" ? (
            <select className="select" onChange={(event) => setRole(event.target.value)} value={role}>
              {staffRoleOptions.map((option) => (
                <option key={option} value={option}>
                  {option ? t(`role.${option}`) : t("users.allStaffRoles")}
                </option>
              ))}
            </select>
          ) : null}
          <input
            className="text-input"
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("users.searchPlaceholder")}
            value={search}
          />
        </div>

        {users === null ? (
          <div className="loading-state">{t("common.loading")}</div>
        ) : users.length === 0 ? (
          <div className="empty-state">{t(`users.emptySection.${section}`)}</div>
        ) : section === "customers" ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("common.name")}</th>
                  <th>{t("users.registeredPhone")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("users.joined")}</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      {canViewCustomerOrders ? (
                        <Link className="text-link" to={customerDetailPath(user.id)}>
                          {user.fullName}
                        </Link>
                      ) : (
                        user.fullName
                      )}
                    </td>
                    <td>
                      <PhoneNumber phone={user.phone} />
                    </td>
                    <td>
                      <StatusBadge status={user.isActive ? "ACTIVE" : "INACTIVE"} />
                    </td>
                    <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                    <td>
                      <div className="row-actions">
                        {canViewCustomerOrders ? (
                          <Link className="btn btn-outline btn-sm" to={customerDetailPath(user.id)}>
                            {t("users.viewCustomer")}
                          </Link>
                        ) : null}
                        {accessActions(user)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("common.name")}</th>
                  <th>{t("common.phone")}</th>
                  <th>{t("users.role")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("users.joined")}</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isSelf = user.id === currentUser?.id;
                  return (
                    <tr key={user.id}>
                      <td>
                        {user.fullName}
                        {isSelf ? ` · ${t("users.you")}` : ""}
                      </td>
                      <td>
                        <PhoneNumber phone={user.phone} />
                      </td>
                      <td>{t(`role.${user.role}`)}</td>
                      <td>
                        <StatusBadge status={user.isActive ? "ACTIVE" : "INACTIVE"} />
                      </td>
                      <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                      <td>
                        {/* Changing your own access is refused by the API too, not just hidden here. */}
                        {isSelf ? (
                          t("common.dash")
                        ) : (
                          <div className="row-actions">
                            {accessActions(user)}
                            {canManageAdmins && user.role === "ADMIN" ? (
                              <button
                                className="btn btn-outline btn-sm"
                                onClick={() => void run(() => assignPlatformRole(user.id, "SUPER_ADMIN"))}
                                type="button"
                              >
                                {t("users.makeSuperAdmin")}
                              </button>
                            ) : null}
                            {canManageAdmins && user.role === "ADMIN" ? (
                              <button
                                className="btn btn-outline btn-sm"
                                onClick={() => void run(() => assignPlatformRole(user.id, undefined))}
                                type="button"
                              >
                                {t("users.removePlatformRole")}
                              </button>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager onPage={setPage} page={page} pageSize={listPageSize} total={total} />
      </div>

      {pendingSuspension ? (
        <ReasonModal
          confirmLabel={t("users.suspend")}
          description={t("users.suspendDescription", { name: pendingSuspension.fullName })}
          onCancel={() => setPendingSuspension(null)}
          onConfirm={async (reason) => {
            await run(() => setUserActive(pendingSuspension.id, false, reason));
            setPendingSuspension(null);
          }}
          title={t("users.suspend")}
        />
      ) : null}
    </div>
  );
}

/** A registered number, kept left-to-right inside Arabic text and dialable where the device can. */
export function PhoneNumber({ phone }: { phone: string }) {
  const href = telHref(phone);
  const number = <bdi className="phone-number" dir="ltr">{phone}</bdi>;
  return href ? <a className="phone-link" href={href}>{number}</a> : number;
}
