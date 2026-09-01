import { useEffect, useMemo, useState } from "react";
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
import { landmarkMarkerColor, type LocationMapMarker, type MapCoordinate } from "../../components/location-map.types";
import { Skeleton } from "../../components/skeleton";
import {
  createMyAddress,
  deleteMyAddress,
  getMyProfile,
  listLandmarks,
  listMyAddresses,
  updateMyAddress,
  updateMyProfile,
  type Landmark,
  type MyProfile,
  type PublicUser,
  type SavedAddress
} from "../../core/api";
import { readError } from "../../core/errors";
import { getCurrentCoordinates, reverseGeocode } from "../../core/location";
import { getAccessToken } from "../../core/session";
import i18n from "../../i18n";
import { Icon, backIconName } from "../../theme/icon";
import { radius, spacing, type ThemeColors } from "../../theme/tokens";
import { useTheme } from "../../theme/theme-context";
import { text } from "../../theme/typography";
import { useCustomerTheme, type CustomerTheme } from "./theme";

// Default map center: the Biddu-enclave service area, used only until the
// customer's saved/detected location is available.
const defaultCoordinate: MapCoordinate = { latitude: 31.83804, longitude: 35.14047 };

export function AccountScreen(props: {
  user: PublicUser;
  onBack: () => void;
  onOpenSettings: () => void;
  onLogout: () => Promise<void>;
  onProfileUpdated: (user: PublicUser) => void;
}) {
  const { t } = useTranslation(["customer", "common"]);
  const { colors } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [fullName, setFullName] = useState(props.user.fullName);
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState(() => t("account.defaultAddressLabel"));
  const [addressLine, setAddressLine] = useState("");
  const [coordinate, setCoordinate] = useState(defaultCoordinate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  // Named landmarks render on the address map as static reference pins alongside
  // the customer's own draggable coordinate.
  const landmarkMarkers = useMemo<LocationMapMarker[]>(
    () =>
      landmarks.map((landmark) => ({
        id: landmark.id,
        title: landmark.name,
        latitude: landmark.latitude,
        longitude: landmark.longitude,
        color: landmarkMarkerColor
      })),
    [landmarks]
  );

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
      // Fetch landmarks alongside profile/addresses rather than sequentially after
      // them. All three then share the single coordinated token refresh on a 401
      // (the well-tested "refresh storm" path); the old sequential call reused a
      // token that a mid-load refresh could have already rotated, so on an expiring
      // session its lone retry could fail and the map silently lost every landmark.
      // Landmarks are orientation aids only, so their own failure stays non-fatal.
      const [nextProfile, nextAddresses, nextLandmarks] = await Promise.all([
        getMyProfile(accessToken),
        listMyAddresses(accessToken),
        listLandmarks(accessToken).catch(() => [] as Landmark[])
      ]);
      setProfile(nextProfile);
      setFullName(nextProfile.fullName);
      setEmail(nextProfile.email ?? "");
      setAddresses(nextAddresses);
      const preferred = nextAddresses.find((item) => item.isDefault) ?? nextAddresses[0];
      if (preferred) setCoordinate(preferred);
      setLandmarks(nextLandmarks);
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
    if (!(await confirmDialog(t("account.confirmDialogTitle"), t("account.deleteAddressConfirm", { label: address.label }), t("account.continueButton")))) return;
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

  async function confirmLogout() {
    if (!(await confirmDialog(t("settings.logoutConfirmTitle"), t("settings.logoutConfirmBody"), t("settings.logoutButton")))) {
      return;
    }
    setLoggingOut(true);
    try {
      await props.onLogout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <StatusBar backgroundColor={customerTheme.colors.background} barStyle="dark-content" />
      <View style={styles.header}>
        <Pressable onPress={props.onBack} style={styles.back}><Icon name={backIconName()} size="md" /></Pressable>
        <Text style={styles.headerTitle}>{t("account.headerTitle")}</Text>
        <Pressable accessibilityLabel={t("common:settings")} onPress={props.onOpenSettings} style={styles.back}>
          <Icon name="settings" size="md" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!profile && !error ? (
          <>
            <AccountCardSkeleton lines={3} />
            <AccountCardSkeleton lines={2} />
          </>
        ) : !profile && error ? (
          <View style={styles.card}>
            <Text style={styles.error}>{error}</Text>
            <Button label={t("common:retry")} onPress={() => void load()} />
          </View>
        ) : (
          <>
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.card}>
              <Text style={styles.title}>{t("account.personalDataTitle")}</Text>
              <Text style={styles.label}>{t("account.fullNameLabel")}</Text>
              <TextInput onChangeText={setFullName} style={styles.input} value={fullName} />
              <Text style={styles.label}>{t("account.emailLabel")}</Text>
              <TextInput autoCapitalize="none" keyboardType="email-address" onChangeText={setEmail} style={styles.input} value={email} />
              <Text style={[styles.helper, styles.ltrText]}>{profile?.phone}</Text>
              <Button disabled={busy} label={t("account.saveProfileButton")} onPress={() => void saveProfile()} />
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
              <LocationMap coordinate={coordinate} markers={landmarkMarkers} onCoordinateChange={(value) => void selectCoordinate(value)} />
              <SmallButton label={t("account.useCurrentLocationButton")} onPress={() => void useCurrentLocation()} />
              <Button disabled={busy} label={t("account.saveAddressButton")} onPress={() => void saveAddress()} />
            </View>

            <Pressable disabled={loggingOut} onPress={() => void confirmLogout()} style={styles.logoutButton}>
              {loggingOut ? (
                <ActivityIndicator color={colors.error} />
              ) : (
                <>
                  <Icon color={colors.error} name="logout" size="sm" />
                  <Text style={styles.logoutText}>{t("settings.logoutButton")}</Text>
                </>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function AccountCardSkeleton(props: { lines: number }) {
  const { colors } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
  return (
    <View style={styles.card}>
      <Skeleton height={16} style={styles.skeletonTitle} width="45%" />
      {Array.from({ length: props.lines }).map((_, index) => (
        <View key={index} style={styles.skeletonFieldGroup}>
          <Skeleton height={11} width="30%" />
          <Skeleton height={44} radius={radius.md} style={styles.skeletonInput} />
        </View>
      ))}
    </View>
  );
}

function Button(props: { label: string; disabled?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
  return <Pressable disabled={props.disabled} onPress={props.onPress} style={styles.button}><Text style={styles.buttonText}>{props.label}</Text></Pressable>;
}

function SmallButton(props: { label: string; danger?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const customerTheme = useCustomerTheme();
  const styles = useMemo(() => createStyles(colors, customerTheme), [colors, customerTheme]);
  return <Pressable onPress={props.onPress} style={[styles.smallButton, props.danger && styles.smallDanger]}><Text style={[styles.smallText, props.danger && styles.smallDangerText]}>{props.label}</Text></Pressable>;
}

async function confirmDialog(title: string, body: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return typeof globalThis.confirm === "function" ? globalThis.confirm(`${title}\n\n${body}`) : false;
  }
  return new Promise((resolve) => Alert.alert(title, body, [
    { text: i18n.t("common:cancel"), style: "cancel", onPress: () => resolve(false) },
    { text: confirmLabel, style: "destructive", onPress: () => resolve(true) }
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}

const createStyles = (colors: ThemeColors, customerTheme: CustomerTheme) => StyleSheet.create({
  screen: { backgroundColor: customerTheme.colors.background, flex: 1 },
  header: { alignItems: "center", borderBottomColor: customerTheme.colors.border, borderBottomWidth: 1, flexDirection: "row", padding: spacing[4] },
  back: { alignItems: "center", backgroundColor: customerTheme.colors.surface, borderRadius: radius.lg, height: 42, justifyContent: "center", width: 42 },
  headerTitle: { ...text("h2", "bold"), color: customerTheme.colors.text, flex: 1, textAlign: "center" },
  content: { alignSelf: "center", maxWidth: 900, padding: spacing[5], paddingBottom: spacing[9], width: "100%" },
  card: { backgroundColor: customerTheme.colors.surface, borderColor: customerTheme.colors.border, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing[4], padding: spacing[5] },
  skeletonTitle: { marginBottom: spacing[4] },
  skeletonFieldGroup: { marginBottom: spacing[3] },
  skeletonInput: { marginTop: spacing[2] },
  title: { ...text("h3", "bold"), color: customerTheme.colors.text, marginBottom: spacing[3], textAlign: "auto" },
  subtitle: { ...text("body", "bold"), color: customerTheme.colors.text, marginBottom: spacing[3], marginTop: spacing[5], textAlign: "auto" },
  label: { ...text("caption", "bold"), color: customerTheme.colors.text, marginBottom: spacing[2], textAlign: "auto" },
  input: { backgroundColor: customerTheme.colors.surfaceMuted, borderColor: customerTheme.colors.border, borderRadius: radius.md, borderWidth: 1, color: customerTheme.colors.text, marginBottom: spacing[3], padding: spacing[3], textAlign: "auto" },
  multiline: { minHeight: 78, textAlignVertical: "top" },
  helper: { ...text("caption"), color: customerTheme.colors.textMuted, textAlign: "auto" },
  ltrText: { writingDirection: "ltr" },
  button: { alignItems: "center", backgroundColor: customerTheme.colors.primary, borderRadius: radius.md, marginTop: spacing[4], padding: spacing[4] },
  buttonText: { ...text("bodySm", "bold"), color: colors.textInverse },
  addressCard: { borderBottomColor: customerTheme.colors.border, borderBottomWidth: 1, paddingVertical: spacing[3] },
  addressTitle: { ...text("bodySm", "bold"), color: customerTheme.colors.text, textAlign: "auto" },
  row: { flexDirection: "row", gap: spacing[2], justifyContent: "flex-end", marginTop: spacing[2] },
  smallButton: { borderColor: customerTheme.colors.primary, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  smallText: { ...text("label", "bold"), color: customerTheme.colors.primary },
  smallDanger: { borderColor: customerTheme.colors.danger },
  smallDangerText: { color: customerTheme.colors.danger },
  notice: { ...text("bodySm"), backgroundColor: customerTheme.colors.successSoft, borderRadius: radius.md, color: customerTheme.colors.success, marginBottom: spacing[3], padding: spacing[3], textAlign: "auto" },
  error: { ...text("bodySm"), backgroundColor: colors.errorSubtle, borderRadius: radius.md, color: customerTheme.colors.danger, marginBottom: spacing[3], padding: spacing[3], textAlign: "auto" },
  logoutButton: {
    alignItems: "center",
    backgroundColor: colors.errorSubtle,
    borderRadius: radius.lg,
    flexDirection: "row",
    gap: spacing[2],
    justifyContent: "center",
    minHeight: 52,
    paddingVertical: spacing[3]
  },
  logoutText: { ...text("bodySm", "bold"), color: colors.error }
});
