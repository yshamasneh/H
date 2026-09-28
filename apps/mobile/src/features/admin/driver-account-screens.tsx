import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import i18n from "../../i18n";
import {
  approveAdminDriver,
  createAdminDriver,
  fetchAdminAccess,
  getAdminDriver,
  reactivateAdminDriver,
  rejectAdminDriver,
  setAdminDriverPassword,
  suspendAdminDriver,
  updateAdminDriver,
  type AdminDriver,
  type AdminDriverDetail
} from "../../core/api";
import { getAccessToken } from "../../core/session";
import { useTheme } from "../../theme/theme-context";
import { radius, spacing } from "../../theme/tokens";
import { text } from "../../theme/typography";
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
  formatDate,
  readAdminError,
  useAdminStyles
} from "./ui";
import { generateDriverPassword, isStrongPassword, splitDriverPhone } from "./drivers.rules";
import { formatMinorExact, hasAdminPermission } from "./users.rules";

type CountryCode = "+970" | "+972";
const countryCodes: CountryCode[] = ["+970", "+972"];

async function requireToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error(i18n.t("common:sessionExpired"));
  return token;
}

/** The details a driver needs to sign in, shown once and shareable through the phone's own sheet. */
function Credentials(props: { phone: string; password: string }) {
  const { t } = useTranslation(["admin"]);
  const { colors } = useTheme();
  return (
    <View style={[styles.credentials, { backgroundColor: colors.surfaceSunk, borderColor: colors.border }]}>
      <KeyValue label={t("drivers.account.loginPhone")} value={`⁦${props.phone}⁩`} />
      <View style={styles.passwordRow}>
        <Text style={[styles.passwordLabel, { color: colors.textMuted }]}>{t("drivers.account.password")}</Text>
        <Text selectable style={[styles.password, { color: colors.text }]} testID="driver-password">
          {props.password}
        </Text>
      </View>
    </View>
  );
}

function shareCredentials(name: string, phone: string, password: string) {
  void Share.share({ message: i18n.t("admin:drivers.account.shareMessage", { name, phone, password }) }).catch(() => undefined);
}

/**
 * Adding a driver on the phone: name, sign-in number and a suggested strong first password. The
 * account is ready to go on shift at once; the screen then shows exactly what to give the driver.
 */
export function AdminCreateDriverScreen(props: { onBack: () => void; onCreated: (driverUserId: string) => void }) {
  const { t } = useTranslation(["admin", "common"]);
  const { colors } = useTheme();
  const [fullName, setFullName] = useState("");
  const [countryCode, setCountryCode] = useState<CountryCode>("+970");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [password, setPassword] = useState(() => generateDriverPassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ driver: AdminDriver; password: string } | null>(null);
  const passwordOk = isStrongPassword(password);
  const canSubmit = fullName.trim().length >= 2 && phoneNumber.trim().length >= 7 && passwordOk;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const driver = await createAdminDriver(await requireToken(), {
        fullName: fullName.trim(),
        countryCode,
        phoneNumber: phoneNumber.trim(),
        password
      });
      setCreated({ driver, password });
    } catch (requestError) {
      setError(readAdminError(requestError));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <AdminPage onBack={props.onBack} title={t("drivers.account.createdTitle")}>
        <Card>
          <CardTitle>{created.driver.fullName}</CardTitle>
          <Meta>{t("drivers.account.createdBody")}</Meta>
          <Credentials password={created.password} phone={created.driver.phone} />
          <Meta>{t("drivers.account.shareHint")}</Meta>
          <ActionRow>
            <ActionButton
              label={t("drivers.account.share")}
              onPress={() => shareCredentials(created.driver.fullName, created.driver.phone, created.password)}
            />
            <ActionButton label={t("drivers.account.openDriver")} onPress={() => props.onCreated(created.driver.userId)} variant="secondary" />
          </ActionRow>
        </Card>
      </AdminPage>
    );
  }

  return (
    <AdminPage onBack={props.onBack} subtitle={t("drivers.account.createBody")} title={t("drivers.account.createTitle")}>
      <Card>
        <Text style={[styles.label, { color: colors.textMuted }]}>{t("drivers.account.fullName")}</Text>
        <Input autoComplete="off" onChangeText={setFullName} placeholder={t("drivers.account.fullName")} value={fullName} />
        <Text style={[styles.label, { color: colors.textMuted }]}>{t("drivers.account.phone")}</Text>
        <FilterChips onChange={setCountryCode} options={countryCodes.map((code) => ({ value: code, label: code }))} value={countryCode} />
        <Input autoComplete="off" keyboardType="phone-pad" ltr onChangeText={setPhoneNumber} placeholder="059XXXXXXX" value={phoneNumber} />
        <Text style={[styles.label, { color: colors.textMuted }]}>{t("drivers.account.firstPassword")}</Text>
        <Input autoComplete="new-password" ltr onChangeText={setPassword} placeholder={t("drivers.account.firstPassword")} value={password} />
        {password && !passwordOk ? <Text style={[styles.fieldError, { color: colors.error }]}>{t("drivers.account.passwordRule")}</Text> : null}
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setPassword(generateDriverPassword())}>
          <Text style={[styles.link, { color: colors.primary }]}>{t("drivers.account.suggestAnother")}</Text>
        </Pressable>
        <Meta>{t("drivers.account.passwordHint")}</Meta>
      </Card>
      <ErrorBanner message={error} />
      <ActionButton disabled={!canSubmit} label={t("drivers.account.create")} loading={busy} onPress={() => void submit()} />
    </AdminPage>
  );
}

/**
 * One driver on the phone: call them, see whether they are on shift and delivering, their recent
 * deliveries, and the account controls — correct name or number, set a new password, suspend or
 * reactivate (and, for an old application, approve or reject).
 */
export function AdminDriverDetailScreen(props: {
  driverUserId: string;
  onBack: () => void;
  onOpenOrder?: (orderId: string) => void;
  onOpenCash?: (driverUserId: string) => void;
}) {
  const { t } = useTranslation(["admin", "common"]);
  const adminStyles = useAdminStyles();
  const { colors } = useTheme();
  const [driver, setDriver] = useState<AdminDriverDetail | null>(null);
  const [canSeeOrders, setCanSeeOrders] = useState(false);
  const [canSeeCash, setCanSeeCash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"edit" | "password" | "suspend" | "reject" | null>(null);
  const [draft, setDraft] = useState({ fullName: "", countryCode: "+970" as CountryCode, phoneNumber: "" });
  const [newPassword, setNewPassword] = useState("");
  const [reason, setReason] = useState("");
  const [passwordSet, setPasswordSet] = useState<string | null>(null);

  async function load() {
    try {
      setDriver(await getAdminDriver(await requireToken(), props.driverUserId));
      setError(null);
    } catch (requestError) {
      setError(readAdminError(requestError));
    }
  }

  useEffect(() => {
    void load();
    requireToken()
      .then(fetchAdminAccess)
      .then((access) => {
        setCanSeeOrders(hasAdminPermission(access, "VIEW_ALL_ORDERS"));
        setCanSeeCash(hasAdminPermission(access, "VIEW_ACCOUNTING"));
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.driverUserId]);

  async function run(action: (token: string) => Promise<unknown>, message: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action(await requireToken());
      setNotice(message);
      setPanel(null);
      setReason("");
      await load();
      return true;
    } catch (requestError) {
      setError(readAdminError(requestError));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!driver) {
    return (
      <AdminPage onBack={props.onBack} title={t("drivers.title")}>
        {error ? <ErrorBanner message={error} /> : <LoadingState />}
      </AdminPage>
    );
  }

  const onShift = driver.status === "APPROVED" && driver.isOnline;
  const draftValid = draft.fullName.trim().length >= 2 && draft.phoneNumber.trim().length >= 7;

  return (
    <AdminPage onBack={props.onBack} subtitle={t("drivers.account.subtitle")} title={driver.fullName}>
      <ErrorBanner message={error} />
      {notice ? <Text style={[styles.notice, { backgroundColor: colors.successSubtle, color: colors.success }]}>{notice}</Text> : null}
      {passwordSet ? <Credentials password={passwordSet} phone={driver.phone} /> : null}
      {driver.status === "SUSPENDED" ? (
        <Text style={[styles.notice, { backgroundColor: colors.warningSubtle, color: colors.warning }]}>{t("drivers.account.suspendedBanner")}</Text>
      ) : null}

      <Card>
        <View style={adminStyles.rowBetween}>
          <View style={{ flex: 1 }}>
            <PhoneNumber phone={driver.phone} />
          </View>
          <StatusPill status={onShift ? "ONLINE" : driver.status} />
        </View>
        <KeyValue label={t("drivers.account.onShift")} value={onShift ? t("common:yes") : t("common:no")} />
        <KeyValue label={t("drivers.deliveringNow")} value={driver.activeDeliveryId ? t("common:yes") : t("common:no")} />
        <KeyValue label={t("drivers.completedDeliveriesLabel")} value={String(driver.completedDeliveriesCount)} />
        <KeyValue label={t("drivers.account.failedDeliveries")} value={String(driver.failedDeliveriesCount)} />
        <KeyValue label={t("drivers.account.lastLocation")} value={driver.lastLocationAt ? formatDate(driver.lastLocationAt) : "—"} />
        <KeyValue label={t("drivers.createdLabel")} value={formatDate(driver.createdAt)} />
        {canSeeCash && props.onOpenCash ? (
          <ActionButton label={t("drivers.receiveCash")} onPress={() => props.onOpenCash!(driver.userId)} variant="secondary" />
        ) : null}
      </Card>

      <Text style={adminStyles.sectionTitle}>{t("drivers.account.accountTitle")}</Text>
      <Card>
        {panel === "edit" ? (
          <>
            <Input onChangeText={(fullName) => setDraft({ ...draft, fullName })} placeholder={t("drivers.account.fullName")} value={draft.fullName} />
            <FilterChips
              onChange={(countryCode) => setDraft({ ...draft, countryCode })}
              options={countryCodes.map((code) => ({ value: code, label: code }))}
              value={draft.countryCode}
            />
            <Input keyboardType="phone-pad" ltr onChangeText={(phoneNumber) => setDraft({ ...draft, phoneNumber })} placeholder="059XXXXXXX" value={draft.phoneNumber} />
            <Meta>{t("drivers.account.phoneChangeHint")}</Meta>
            <ActionRow>
              <ActionButton
                disabled={!draftValid}
                label={t("drivers.account.save")}
                loading={busy}
                onPress={() =>
                  void run(
                    (token) => updateAdminDriver(token, driver.userId, { fullName: draft.fullName.trim(), countryCode: draft.countryCode, phoneNumber: draft.phoneNumber.trim() }),
                    t("drivers.account.savedNotice")
                  )
                }
              />
              <ActionButton label={t("common:cancel")} onPress={() => setPanel(null)} variant="secondary" />
            </ActionRow>
          </>
        ) : panel === "password" ? (
          <>
            <Input ltr onChangeText={setNewPassword} placeholder={t("drivers.account.newPassword")} value={newPassword} />
            {newPassword && !isStrongPassword(newPassword) ? (
              <Text style={[styles.fieldError, { color: colors.error }]}>{t("drivers.account.passwordRule")}</Text>
            ) : null}
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setNewPassword(generateDriverPassword())}>
              <Text style={[styles.link, { color: colors.primary }]}>{t("drivers.account.suggestAnother")}</Text>
            </Pressable>
            <Meta>{t("drivers.account.resetHint")}</Meta>
            <ActionRow>
              <ActionButton
                disabled={!isStrongPassword(newPassword)}
                label={t("drivers.account.setPassword")}
                loading={busy}
                onPress={() => {
                  const chosen = newPassword;
                  void run((token) => setAdminDriverPassword(token, driver.userId, chosen), t("drivers.account.passwordSetNotice")).then(
                    (ok) => ok && setPasswordSet(chosen)
                  );
                }}
              />
              <ActionButton label={t("common:cancel")} onPress={() => setPanel(null)} variant="secondary" />
            </ActionRow>
          </>
        ) : panel === "suspend" || panel === "reject" ? (
          <>
            <Input
              multiline
              onChangeText={setReason}
              placeholder={t(panel === "reject" ? "drivers.reasonPlaceholderReject" : "drivers.reasonPlaceholderSuspend")}
              value={reason}
            />
            <ActionRow>
              <ActionButton
                disabled={!reason.trim()}
                label={t(panel === "reject" ? "drivers.confirmRejectButton" : "drivers.confirmSuspendButton")}
                loading={busy}
                onPress={() =>
                  void run(
                    (token) =>
                      panel === "reject"
                        ? rejectAdminDriver(token, driver.userId, reason.trim())
                        : suspendAdminDriver(token, driver.userId, reason.trim()),
                    t(panel === "reject" ? "drivers.account.rejectedNotice" : "drivers.account.suspendedNotice")
                  )
                }
                variant="danger"
              />
              <ActionButton label={t("common:cancel")} onPress={() => setPanel(null)} variant="secondary" />
            </ActionRow>
          </>
        ) : (
          <ActionRow>
            <ActionButton
              label={t("drivers.account.edit")}
              onPress={() => {
                setDraft({ fullName: driver.fullName, ...splitDriverPhone(driver.phone) });
                setPanel("edit");
              }}
              variant="secondary"
            />
            <ActionButton
              label={t("drivers.account.resetPassword")}
              onPress={() => {
                setNewPassword(generateDriverPassword());
                setPasswordSet(null);
                setPanel("password");
              }}
              variant="secondary"
            />
            {driver.status === "APPROVED" ? (
              <ActionButton label={t("common:suspend")} onPress={() => setPanel("suspend")} variant="danger" />
            ) : null}
            {driver.status === "SUSPENDED" ? (
              <ActionButton
                label={t("common:reactivate")}
                loading={busy}
                onPress={() => void run((token) => reactivateAdminDriver(token, driver.userId), t("drivers.account.reactivatedNotice"))}
              />
            ) : null}
            {driver.status === "PENDING" ? (
              <>
                <ActionButton
                  label={t("common:approve")}
                  loading={busy}
                  onPress={() => void run((token) => approveAdminDriver(token, driver.userId), t("drivers.account.approvedNotice"))}
                />
                <ActionButton label={t("common:reject")} onPress={() => setPanel("reject")} variant="danger" />
              </>
            ) : null}
          </ActionRow>
        )}
      </Card>

      <Text style={adminStyles.sectionTitle}>{t("drivers.account.recentTitle")}</Text>
      {driver.recentDeliveries.length === 0 ? (
        <EmptyState message={t("drivers.account.noDeliveries")} />
      ) : (
        driver.recentDeliveries.map((delivery) => (
          <Card
            key={delivery.deliveryId}
            onPress={canSeeOrders && props.onOpenOrder ? () => props.onOpenOrder!(delivery.orderId) : undefined}
          >
            <View style={adminStyles.rowBetween}>
              <View style={{ flex: 1 }}>
                <CardTitle>{delivery.storeName}</CardTitle>
                <Meta>{`#${delivery.orderId.slice(0, 8)} · ${formatDate(delivery.finishedAt ?? delivery.assignedAt ?? driver.createdAt)}`}</Meta>
              </View>
              <StatusPill status={delivery.status} />
            </View>
            <KeyValue label={t("drivers.account.orderTotal")} value={formatMinorExact(delivery.totalMinor)} />
          </Card>
        ))
      )}
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  credentials: { borderRadius: radius.md, borderWidth: 1, gap: spacing[1], marginVertical: spacing[2], padding: spacing[3] },
  passwordRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  passwordLabel: { ...text("bodySm") },
  password: { ...text("h3", "bold"), letterSpacing: 1, writingDirection: "ltr" },
  label: { ...text("label", "semibold"), marginTop: spacing[2] },
  link: { ...text("bodySm", "semibold"), paddingVertical: spacing[1] },
  fieldError: { ...text("caption", "medium") },
  notice: { ...text("bodySm", "medium"), borderRadius: radius.sm, marginBottom: spacing[2], padding: spacing[3] }
});
