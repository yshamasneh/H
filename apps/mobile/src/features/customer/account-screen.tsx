import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LocationMap } from "../../components/location-map";
import type { MapCoordinate } from "../../components/location-map.types";
import {
  ApiError,
  createMyAddress,
  deleteMyAccount,
  deleteMyAddress,
  getMyProfile,
  listMyAddresses,
  registerMyPushToken,
  unregisterMyPushToken,
  updateMyAddress,
  updateMyProfile,
  type MyProfile,
  type PublicUser,
  type SavedAddress
} from "../../core/api";
import { getCurrentCoordinates, reverseGeocode } from "../../core/location";
import {
  clearStoredPushToken,
  getPushToken,
  getStoredPushToken,
  storePushToken
} from "../../core/push-notifications";
import { getAccessToken } from "../../core/session";
import i18n from "../../i18n";
import { LanguageSwitcher } from "../../i18n/LanguageSwitcher";
import { customerTheme } from "./theme";

const defaultCoordinate: MapCoordinate = { latitude: 31.9038, longitude: 35.2034 };

export function AccountScreen(props: {
  user: PublicUser;
  onBack: () => void;
  onDeleted: () => Promise<void>;
  onProfileUpdated: (user: PublicUser) => void;
}) {
  const { t } = useTranslation(["customer", "common"]);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [fullName, setFullName] = useState(props.user.fullName);
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState(() => t("account.defaultAddressLabel"));
  const [addressLine, setAddressLine] = useState("");
  const [coordinate, setCoordinate] = useState(defaultCoordinate);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function token() {
    const value = await getAccessToken();
    if (!value) throw new Error(t("common:sessionExpired"));
    return value;
  }

  async function load() {
    setError(null);
    try {
      const accessToken = await token();
      const [nextProfile, nextAddresses, storedPushToken] = await Promise.all([
        getMyProfile(accessToken),
        listMyAddresses(accessToken),
        getStoredPushToken()
      ]);
      setProfile(nextProfile);
      setFullName(nextProfile.fullName);
      setEmail(nextProfile.email ?? "");
      setAddresses(nextAddresses);
      setPushEnabled(Boolean(storedPushToken));
      const preferred = nextAddresses.find((item) => item.isDefault) ?? nextAddresses[0];
      if (preferred) setCoordinate(preferred);
    } catch (requestError) {
      setError(readError(requestError));
    }
  }

  async function saveProfile() {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateMyProfile(await token(), {
        fullName: fullName.trim(),
        email: email.trim() || null
      });
      setProfile(updated);
      props.onProfileUpdated(updated);
      setNotice(t("account.profileSavedNotice"));
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function selectCoordinate(value: MapCoordinate) {
    setCoordinate(value);
    try {
      const resolved = await reverseGeocode(value);
      if (resolved) setAddressLine(resolved);
    } catch {
      // The customer can still type the address while keeping the selected pin.
    }
  }

  async function useCurrentLocation() {
    setBusy(true);
    setError(null);
    try {
      await selectCoordinate(await getCurrentCoordinates());
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function saveAddress() {
    if (!label.trim() || addressLine.trim().length < 3) {
      setError(t("account.addressRequiredError"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createMyAddress(await token(), {
        label: label.trim(),
        addressLine: addressLine.trim(),
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        isDefault: addresses.length === 0
      });
      setAddresses(await listMyAddresses(await token()));
      setAddressLine("");
      setNotice(t("account.addressSavedNotice"));
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(address: SavedAddress) {
    setBusy(true);
    try {
      await updateMyAddress(await token(), address.id, { isDefault: true });
      setAddresses(await listMyAddresses(await token()));
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function removeAddress(address: SavedAddress) {
    if (!(await confirmAction(t("account.deleteAddressConfirm", { label: address.label })))) return;
    setBusy(true);
    try {
      await deleteMyAddress(await token(), address.id);
      setAddresses((current) => current.filter((item) => item.id !== address.id));
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function togglePush() {
    setBusy(true);
    setError(null);
    try {
      const accessToken = await token();
      const existing = await getStoredPushToken();
      if (existing) {
        await unregisterMyPushToken(accessToken, existing);
        await clearStoredPushToken();
        setPushEnabled(false);
        setNotice(t("account.notificationsDisabledNotice"));
      } else {
        const next = await getPushToken();
        const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
        await registerMyPushToken(accessToken, next, platform);
        await storePushToken(next);
        setPushEnabled(true);
        setNotice(t("account.notificationsEnabledNotice"));
      }
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function removeAccount() {
    if (!(await confirmAction(t("account.deleteAccountConfirm")))) return;
    setBusy(true);
    try {
      await deleteMyAccount(await token());
      await clearStoredPushToken();
      await props.onDeleted();
    } catch (requestError) {
      setError(readError(requestError));
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.background} barStyle="dark-content" />
      <View style={styles.header}>
        <Pressable onPress={props.onBack} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
        <Text style={styles.headerTitle}>{t("account.headerTitle")}</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!profile && !error ? <ActivityIndicator color={customerTheme.colors.primary} /> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.card}>
          <Text style={styles.title}>{t("account.personalDataTitle")}</Text>
          <Text style={styles.label}>{t("account.fullNameLabel")}</Text>
          <TextInput onChangeText={setFullName} style={styles.input} value={fullName} />
          <Text style={styles.label}>{t("account.emailLabel")}</Text>
          <TextInput autoCapitalize="none" keyboardType="email-address" onChangeText={setEmail} style={styles.input} value={email} />
          <Text style={styles.helper}>{profile?.phone}</Text>
          <Button disabled={busy} label={t("account.saveProfileButton")} onPress={() => void saveProfile()} />
          <LanguageSwitcher />
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>{t("account.savedAddressesTitle")}</Text>
          {addresses.map((address) => (
            <View key={address.id} style={styles.addressCard}>
              <Text style={styles.addressTitle}>{address.label}{address.isDefault ? t("account.defaultSuffix") : ""}</Text>
              <Text style={styles.helper}>{address.addressLine}</Text>
              <View style={styles.row}>
                {!address.isDefault ? <SmallButton label={t("account.setDefaultButton")} onPress={() => void setDefault(address)} /> : null}
                <SmallButton danger label={t("account.deleteButton")} onPress={() => void removeAddress(address)} />
              </View>
            </View>
          ))}
          <Text style={styles.subtitle}>{t("account.addNewAddressTitle")}</Text>
          <TextInput onChangeText={setLabel} placeholder={t("account.labelPlaceholder")} style={styles.input} value={label} />
          <TextInput multiline onChangeText={setAddressLine} placeholder={t("account.addressLinePlaceholder")} style={[styles.input, styles.multiline]} value={addressLine} />
          <LocationMap coordinate={coordinate} onCoordinateChange={(value) => void selectCoordinate(value)} />
          <SmallButton label={t("account.useCurrentLocationButton")} onPress={() => void useCurrentLocation()} />
          <Button disabled={busy} label={t("account.saveAddressButton")} onPress={() => void saveAddress()} />
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>{t("account.notificationsTitle")}</Text>
          <Text style={styles.helper}>{t("account.notificationsHelper")}</Text>
          <Button
            disabled={busy}
            label={pushEnabled ? t("account.disableNotificationsButton") : t("account.enableNotificationsButton")}
            onPress={() => void togglePush()}
          />
        </View>

        <View style={[styles.card, styles.dangerCard]}>
          <Text style={styles.title}>{t("account.deleteAccountTitle")}</Text>
          <Text style={styles.helper}>{t("account.deleteAccountHelper")}</Text>
          <Pressable disabled={busy} onPress={() => void removeAccount()} style={styles.deleteButton}>
            <Text style={styles.deleteText}>{t("account.deleteAccountButton")}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Button(props: { label: string; disabled?: boolean; onPress: () => void }) {
  return <Pressable disabled={props.disabled} onPress={props.onPress} style={styles.button}><Text style={styles.buttonText}>{props.label}</Text></Pressable>;
}

function SmallButton(props: { label: string; danger?: boolean; onPress: () => void }) {
  return <Pressable onPress={props.onPress} style={[styles.smallButton, props.danger && styles.smallDanger]}><Text style={[styles.smallText, props.danger && styles.smallDangerText]}>{props.label}</Text></Pressable>;
}

async function confirmAction(message: string): Promise<boolean> {
  if (Platform.OS === "web") return typeof globalThis.confirm === "function" ? globalThis.confirm(message) : false;
  return new Promise((resolve) => Alert.alert(i18n.t("customer:account.confirmDialogTitle"), message, [
    { text: i18n.t("common:cancel"), style: "cancel", onPress: () => resolve(false) },
    { text: i18n.t("customer:account.continueButton"), style: "destructive", onPress: () => resolve(true) }
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}

function readError(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : i18n.t("common:genericError");
}

const styles = StyleSheet.create({
  screen: { backgroundColor: customerTheme.colors.background, flex: 1 },
  header: { alignItems: "center", borderBottomColor: customerTheme.colors.border, borderBottomWidth: 1, flexDirection: "row", padding: 14 },
  back: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 14, height: 42, justifyContent: "center", width: 42 },
  backText: { color: customerTheme.colors.text, fontSize: 28 },
  headerTitle: { color: customerTheme.colors.text, flex: 1, fontSize: 20, fontWeight: "900", textAlign: "center" },
  headerSpacer: { width: 42 },
  content: { alignSelf: "center", maxWidth: 900, padding: 18, paddingBottom: 50, width: "100%" },
  card: { backgroundColor: "#FFFFFF", borderColor: customerTheme.colors.border, borderRadius: 20, borderWidth: 1, marginBottom: 16, padding: 18 },
  title: { color: customerTheme.colors.text, fontSize: 18, fontWeight: "900", marginBottom: 12, textAlign: "auto" },
  subtitle: { color: customerTheme.colors.text, fontSize: 15, fontWeight: "800", marginBottom: 10, marginTop: 18, textAlign: "auto" },
  label: { color: customerTheme.colors.text, fontSize: 12, fontWeight: "800", marginBottom: 6, textAlign: "auto" },
  input: { backgroundColor: "#F8FBFC", borderColor: customerTheme.colors.border, borderRadius: 13, borderWidth: 1, color: customerTheme.colors.text, marginBottom: 11, padding: 13, textAlign: "auto" },
  multiline: { minHeight: 78, textAlignVertical: "top" },
  helper: { color: customerTheme.colors.textMuted, fontSize: 12, lineHeight: 18, textAlign: "auto" },
  button: { alignItems: "center", backgroundColor: customerTheme.colors.primary, borderRadius: 13, marginTop: 14, padding: 14 },
  buttonText: { color: "#FFFFFF", fontWeight: "900" },
  addressCard: { borderBottomColor: customerTheme.colors.border, borderBottomWidth: 1, paddingVertical: 12 },
  addressTitle: { color: customerTheme.colors.text, fontSize: 14, fontWeight: "900", textAlign: "auto" },
  row: { flexDirection: "row", gap: 8, justifyContent: "flex-end", marginTop: 9 },
  smallButton: { borderColor: customerTheme.colors.primary, borderRadius: 10, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 8 },
  smallText: { color: customerTheme.colors.primary, fontSize: 11, fontWeight: "800" },
  smallDanger: { borderColor: customerTheme.colors.danger },
  smallDangerText: { color: customerTheme.colors.danger },
  notice: { backgroundColor: customerTheme.colors.successSoft, borderRadius: 12, color: customerTheme.colors.success, marginBottom: 12, padding: 12, textAlign: "auto" },
  error: { backgroundColor: "#FDE8E5", borderRadius: 12, color: customerTheme.colors.danger, marginBottom: 12, padding: 12, textAlign: "auto" },
  dangerCard: { borderColor: "#F4B7AD" },
  deleteButton: { alignItems: "center", borderColor: customerTheme.colors.danger, borderRadius: 13, borderWidth: 1, marginTop: 14, padding: 13 },
  deleteText: { color: customerTheme.colors.danger, fontWeight: "900" }
});
