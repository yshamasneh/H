import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../api";
import {
  addBusinessStaff,
  listBusinessStaff,
  removeBusinessStaff,
  updateBusinessStaff,
  type BusinessStaffMember
} from "../../api.business";

const assignableRoles = ["BUSINESS_ADMIN", "BUSINESS_STAFF"] as const;

/**
 * Who has access to this business. Accounts are created with a password the administrator sets and
 * passes on, because the platform has no email or SMS delivery to invite through.
 */
export function StaffPage() {
  const { t } = useTranslation();
  const [staff, setStaff] = useState<BusinessStaffMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    fullName: "",
    countryCode: "+970",
    phoneNumber: "",
    password: "",
    roleKey: "BUSINESS_STAFF" as (typeof assignableRoles)[number]
  });

  async function load() {
    try {
      setStaff(await listBusinessStaff());
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("staff.loadError"));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await load();
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("common.genericActionError"));
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("staff.title")}</h1>
          <p className="page-subtitle">{t("staff.subtitle")}</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="empty-state">{notice}</div> : null}

      <div className="card">
        <h2 className="card-title">{t("staff.addTitle")}</h2>
        <div className="filters-row">
          <input
            className="text-input"
            onChange={(event) => setDraft({ ...draft, fullName: event.target.value })}
            placeholder={t("staff.fullName")}
            value={draft.fullName}
          />
          <input
            className="text-input"
            onChange={(event) => setDraft({ ...draft, countryCode: event.target.value })}
            placeholder={t("staff.countryCode")}
            style={{ maxWidth: 90 }}
            value={draft.countryCode}
          />
          <input
            className="text-input"
            onChange={(event) => setDraft({ ...draft, phoneNumber: event.target.value })}
            placeholder={t("staff.phoneNumber")}
            value={draft.phoneNumber}
          />
          <input
            className="text-input"
            onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            placeholder={t("staff.initialPassword")}
            type="password"
            value={draft.password}
          />
          <select
            className="select"
            onChange={(event) =>
              setDraft({ ...draft, roleKey: event.target.value as (typeof assignableRoles)[number] })
            }
            value={draft.roleKey}
          >
            {assignableRoles.map((role) => (
              <option key={role} value={role}>
                {t(`role.${role}`, role)}
              </option>
            ))}
          </select>
          <button
            className="btn btn-primary btn-sm"
            disabled={!draft.fullName.trim() || !draft.phoneNumber.trim() || draft.password.length < 8}
            onClick={() =>
              void run(async () => {
                await addBusinessStaff({
                  fullName: draft.fullName.trim(),
                  countryCode: draft.countryCode.trim(),
                  phoneNumber: draft.phoneNumber.trim(),
                  password: draft.password,
                  confirmPassword: draft.password,
                  roleKey: draft.roleKey
                });
                setNotice(t("staff.createdNotice"));
                setDraft({ ...draft, fullName: "", phoneNumber: "", password: "" });
              })
            }
            type="button"
          >
            {t("staff.add")}
          </button>
        </div>
        <div className="empty-state">{t("staff.passwordHint")}</div>
      </div>

      <div className="card">
        <h2 className="card-title">{t("staff.listTitle")}</h2>
        {staff.length === 0 ? (
          <div className="empty-state">{t("staff.empty")}</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("common.name")}</th>
                  <th>{t("common.phone")}</th>
                  <th>{t("staff.role")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((member) => (
                  <tr key={member.userId}>
                    <td>
                      {member.fullName}
                      {member.isOwner ? ` · ${t("staff.owner")}` : ""}
                    </td>
                    <td>{member.phone}</td>
                    <td>{t(`role.${member.roleKey}`, member.roleKey)}</td>
                    <td>{member.isActive ? t("common.active") : t("common.inactive")}</td>
                    <td>
                      {member.isOwner ? (
                        t("common.dash")
                      ) : (
                        <div className="filters-row" style={{ margin: 0 }}>
                          <select
                            className="select"
                            onChange={(event) =>
                              void run(() => updateBusinessStaff(member.userId, { roleKey: event.target.value }))
                            }
                            value={member.roleKey}
                          >
                            {assignableRoles.map((role) => (
                              <option key={role} value={role}>
                                {t(`role.${role}`, role)}
                              </option>
                            ))}
                          </select>
                          {member.isActive ? (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => void run(() => removeBusinessStaff(member.userId))}
                              type="button"
                            >
                              {t("staff.revoke")}
                            </button>
                          ) : (
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => void run(() => updateBusinessStaff(member.userId, { isActive: true }))}
                              type="button"
                            >
                              {t("staff.restore")}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
