import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
import {
  ApiError,
  registerDriver,
  registerRestaurant,
  type BusinessType,
  type DriverRegistrationInput,
  type RestaurantRegistrationInput
} from "../../core/api";
import {
  countryCodes,
  normalizePhoneNumber,
  PhoneValidationError,
  type CountryCode
} from "../../core/phone";
import type { PhonePrefill } from "../../navigation/navigation";
import i18n from "../../i18n";
import { strongPasswordPattern } from "./auth.rules";

type RegistrationProps = {
  prefill?: PhonePrefill;
  onBack: (prefill: PhonePrefill) => void;
  onRegistered: (prefill: PhonePrefill, message: string) => void;
};

export function RestaurantRegistrationScreen(props: RegistrationProps) {
  const { t } = useTranslation(["auth", "common"]);
  const [businessType, setBusinessType] = useState<BusinessType>("RESTAURANT");
  const [ownerFullName, setOwnerFullName] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [description, setDescription] = useState("");
  const [countryCode, setCountryCode] = useState<CountryCode>(props.prefill?.countryCode ?? "+970");
  const [phoneNumber, setPhoneNumber] = useState(props.prefill?.phoneNumber ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const prefill = { countryCode, phoneNumber };

  async function submit() {
    const input: RestaurantRegistrationInput = {
      ownerFullName: ownerFullName.trim(),
      restaurantName: restaurantName.trim(),
      addressLine: addressLine.trim(),
      description: description.trim() || undefined,
      countryCode,
      phoneNumber,
      password,
      confirmPassword,
      businessType
    };
    const validationError = validateCommon(input.ownerFullName, prefill, password, confirmPassword);
    if (validationError) return setError(validationError);
    if (input.restaurantName.length < 2) return setError(t("restaurantRegistration.storeNameRequired"));
    if (input.addressLine.length < 3) return setError(t("restaurantRegistration.addressRequired"));

    setError(null);
    setLoading(true);
    try {
      await registerRestaurant(input);
      props.onRegistered(
        prefill,
        t(businessType === "SUPERMARKET" ? "restaurantRegistration.successSupermarket" : "restaurantRegistration.successRestaurant")
      );
    } catch (requestError) {
      setError(readRegistrationError(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <RegistrationLayout title={t("restaurantRegistration.title")} subtitle={t("restaurantRegistration.subtitle")}>
      <View style={styles.field}>
        <Text style={styles.label}>{t("restaurantRegistration.businessTypeLabel")}</Text>
        <View style={styles.businessTypeRow}>
          <Pressable onPress={() => setBusinessType("RESTAURANT")} style={[styles.businessTypeButton, businessType === "RESTAURANT" && styles.businessTypeSelected]}>
            <Text style={[styles.businessTypeText, businessType === "RESTAURANT" && styles.businessTypeTextSelected]}>
              {t("restaurantRegistration.businessTypeRestaurant")}
            </Text>
          </Pressable>
          <Pressable onPress={() => setBusinessType("SUPERMARKET")} style={[styles.businessTypeButton, businessType === "SUPERMARKET" && styles.businessTypeSelected]}>
            <Text style={[styles.businessTypeText, businessType === "SUPERMARKET" && styles.businessTypeTextSelected]}>
              {t("restaurantRegistration.businessTypeSupermarket")}
            </Text>
          </Pressable>
        </View>
      </View>
      <Field label={t("restaurantRegistration.ownerFullNameLabel")} value={ownerFullName} onChangeText={setOwnerFullName} />
      <Field
        label={t(businessType === "SUPERMARKET" ? "restaurantRegistration.supermarketNameLabel" : "restaurantRegistration.restaurantNameLabel")}
        value={restaurantName}
        onChangeText={setRestaurantName}
      />
      <Field label={t("restaurantRegistration.addressLabel")} value={addressLine} onChangeText={setAddressLine} multiline />
      <Field
        label={t("restaurantRegistration.descriptionLabel")}
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <PhoneFields
        countryCode={countryCode}
        phoneNumber={phoneNumber}
        onCountryCodeChange={setCountryCode}
        onPhoneNumberChange={setPhoneNumber}
      />
      <PasswordFields
        password={password}
        confirmPassword={confirmPassword}
        onPasswordChange={setPassword}
        onConfirmPasswordChange={setConfirmPassword}
      />
      <ErrorMessage message={error} />
      <PrimaryButton
        label={t(businessType === "SUPERMARKET" ? "restaurantRegistration.submitSupermarket" : "restaurantRegistration.submitRestaurant")}
        loading={loading}
        onPress={() => void submit()}
      />
      <BackButton onPress={() => props.onBack(prefill)} />
    </RegistrationLayout>
  );
}

export function DriverRegistrationScreen(props: RegistrationProps) {
  const { t } = useTranslation(["auth", "common"]);
  const [fullName, setFullName] = useState("");
  const [countryCode, setCountryCode] = useState<CountryCode>(props.prefill?.countryCode ?? "+970");
  const [phoneNumber, setPhoneNumber] = useState(props.prefill?.phoneNumber ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const prefill = { countryCode, phoneNumber };

  async function submit() {
    const input: DriverRegistrationInput = {
      fullName: fullName.trim(),
      countryCode,
      phoneNumber,
      password,
      confirmPassword
    };
    const validationError = validateCommon(input.fullName, prefill, password, confirmPassword);
    if (validationError) return setError(validationError);

    setError(null);
    setLoading(true);
    try {
      await registerDriver(input);
      props.onRegistered(prefill, t("driverRegistration.success"));
    } catch (requestError) {
      setError(readRegistrationError(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <RegistrationLayout title={t("driverRegistration.title")} subtitle={t("driverRegistration.subtitle")}>
      <Field label={t("fields.fullName")} value={fullName} onChangeText={setFullName} />
      <PhoneFields
        countryCode={countryCode}
        phoneNumber={phoneNumber}
        onCountryCodeChange={setCountryCode}
        onPhoneNumberChange={setPhoneNumber}
      />
      <PasswordFields
        password={password}
        confirmPassword={confirmPassword}
        onPasswordChange={setPassword}
        onConfirmPasswordChange={setConfirmPassword}
      />
      <ErrorMessage message={error} />
      <PrimaryButton label={t("driverRegistration.submit")} loading={loading} onPress={() => void submit()} />
      <BackButton onPress={() => props.onBack(prefill)} />
    </RegistrationLayout>
  );
}

function RegistrationLayout(props: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor="#F5FAFC" barStyle="dark-content" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.brand}>JOVO</Text>
          <Text style={styles.title}>{props.title}</Text>
          <Text style={styles.subtitle}>{props.subtitle}</Text>
          <View style={styles.panel}>{props.children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  secureTextEntry?: boolean;
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        autoCapitalize={props.secureTextEntry ? "none" : "sentences"}
        multiline={props.multiline}
        onChangeText={props.onChangeText}
        secureTextEntry={props.secureTextEntry}
        style={[styles.input, props.multiline && styles.multilineInput]}
        value={props.value}
      />
    </View>
  );
}

function PasswordFields(props: {
  password: string;
  confirmPassword: string;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
}) {
  const { t } = useTranslation(["auth"]);
  return (
    <>
      <Field label={t("fields.password")} value={props.password} onChangeText={props.onPasswordChange} secureTextEntry />
      <Text style={styles.help}>{t("validation.passwordHelp")}</Text>
      <Field
        label={t("fields.confirmPassword")}
        value={props.confirmPassword}
        onChangeText={props.onConfirmPasswordChange}
        secureTextEntry
      />
    </>
  );
}

function PhoneFields(props: {
  countryCode: CountryCode;
  phoneNumber: string;
  onCountryCodeChange: (value: CountryCode) => void;
  onPhoneNumberChange: (value: string) => void;
}) {
  const { t } = useTranslation(["auth"]);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{t("fields.mobileNumber")}</Text>
      <View style={styles.countryRow}>
        {countryCodes.map((code) => (
          <Pressable
            key={code}
            onPress={() => props.onCountryCodeChange(code)}
            style={[styles.countryButton, code === props.countryCode && styles.countryButtonSelected]}
          >
            <Text style={[styles.countryText, code === props.countryCode && styles.countryTextSelected]}>{code}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        keyboardType="phone-pad"
        onChangeText={props.onPhoneNumberChange}
        placeholder={t("fields.phoneNumberPlaceholder")}
        placeholderTextColor="#94A3B8"
        style={styles.input}
        value={props.phoneNumber}
      />
    </View>
  );
}

function PrimaryButton(props: { label: string; loading: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={props.loading} onPress={props.onPress} style={styles.primaryButton}>
      {props.loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>{props.label}</Text>}
    </Pressable>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation(["auth"]);
  return (
    <Pressable onPress={onPress} style={styles.backButton}>
      <Text style={styles.backButtonText}>{t("shared.backToLogin")}</Text>
    </Pressable>
  );
}

function ErrorMessage({ message }: { message: string | null }) {
  return message ? <Text style={styles.error}>{message}</Text> : null;
}

function validateCommon(
  name: string,
  phone: PhonePrefill,
  password: string,
  confirmPassword: string
): string | null {
  if (name.length < 2) return i18n.t("auth:validation.fullNameRequired");
  try {
    normalizePhoneNumber(phone.countryCode, phone.phoneNumber);
  } catch (error) {
    return readRegistrationError(error);
  }
  if (!strongPasswordPattern.test(password)) {
    return i18n.t("auth:validation.passwordStrength");
  }
  if (password !== confirmPassword) return i18n.t("auth:validation.passwordMismatch");
  return null;
}

function readRegistrationError(error: unknown): string {
  if (error instanceof ApiError || error instanceof PhoneValidationError) return error.message;
  if (error instanceof Error) return error.message;
  return i18n.t("auth:shared.requestFailed");
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#F5FAFC", flex: 1 },
  flex: { flex: 1 },
  content: { alignSelf: "center", maxWidth: 620, padding: 22, paddingBottom: 48, width: "100%" },
  brand: { color: "#0F766E", fontSize: 13, fontWeight: "900", letterSpacing: 2, textAlign: "center" },
  title: { color: "#102A2A", fontSize: 28, fontWeight: "900", marginTop: 14, textAlign: "center" },
  subtitle: { color: "#64748B", fontSize: 14, lineHeight: 20, marginTop: 7, textAlign: "center" },
  panel: { backgroundColor: "#FFFFFF", borderRadius: 22, marginTop: 24, padding: 20 },
  field: { marginBottom: 15 },
  label: { color: "#334155", fontSize: 13, fontWeight: "800", marginBottom: 7 },
  input: { backgroundColor: "#F8FAFC", borderColor: "#DCE5E4", borderRadius: 13, borderWidth: 1, color: "#102A2A", minHeight: 50, paddingHorizontal: 14 },
  multilineInput: { minHeight: 82, paddingTop: 13, textAlignVertical: "top" },
  help: { color: "#64748B", fontSize: 11, marginBottom: 13, marginTop: -8 },
  countryRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  businessTypeRow: { flexDirection: "row", gap: 9 },
  businessTypeButton: { alignItems: "center", backgroundColor: "#F8FAFC", borderColor: "#DCE5E4", borderRadius: 13, borderWidth: 1, flex: 1, paddingVertical: 14 },
  businessTypeSelected: { backgroundColor: "#DDF4EF", borderColor: "#0F766E" },
  businessTypeText: { color: "#64748B", fontWeight: "800" },
  businessTypeTextSelected: { color: "#0F766E" },
  countryButton: { backgroundColor: "#F8FAFC", borderColor: "#DCE5E4", borderRadius: 11, borderWidth: 1, paddingHorizontal: 17, paddingVertical: 10 },
  countryButtonSelected: { backgroundColor: "#DDF4EF", borderColor: "#0F766E" },
  countryText: { color: "#64748B", fontWeight: "800" },
  countryTextSelected: { color: "#0F766E" },
  error: { backgroundColor: "#FEE2E2", borderRadius: 11, color: "#B91C1C", marginBottom: 13, padding: 11 },
  primaryButton: { alignItems: "center", backgroundColor: "#0F766E", borderRadius: 14, justifyContent: "center", minHeight: 52, paddingHorizontal: 18 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  backButton: { alignItems: "center", marginTop: 16, padding: 8 },
  backButtonText: { color: "#0F766E", fontSize: 13, fontWeight: "800" }
});
