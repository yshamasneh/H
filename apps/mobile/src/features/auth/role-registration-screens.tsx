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
import { colors, radius, spacing } from "../../theme/tokens";
import { text } from "../../theme/typography";
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
      <StatusBar backgroundColor={colors.surfaceSunk} barStyle="dark-content" />
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
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={props.phoneNumber}
      />
    </View>
  );
}

function PrimaryButton(props: { label: string; loading: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={props.loading} onPress={props.onPress} style={styles.primaryButton}>
      {props.loading ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.primaryButtonText}>{props.label}</Text>}
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
  screen: { backgroundColor: colors.surfaceSunk, flex: 1 },
  flex: { flex: 1 },
  content: { alignSelf: "center", maxWidth: 620, padding: spacing[5], paddingBottom: spacing[9], width: "100%" },
  brand: { ...text("label", "bold"), color: colors.primary, textAlign: "center" },
  title: { ...text("h1", "bold"), color: colors.text, marginTop: spacing[3], textAlign: "center" },
  subtitle: { ...text("bodySm"), color: colors.textMuted, marginTop: spacing[2], textAlign: "center" },
  panel: { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing[6], padding: spacing[5] },
  field: { marginBottom: spacing[4] },
  label: { ...text("caption", "bold"), color: colors.text, marginBottom: spacing[2] },
  input: { backgroundColor: colors.surfaceSunk, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, color: colors.text, minHeight: 50, paddingHorizontal: spacing[4] },
  multilineInput: { minHeight: 82, paddingTop: spacing[3], textAlignVertical: "top" },
  help: { ...text("label"), color: colors.textMuted, marginBottom: spacing[3], marginTop: -8 },
  countryRow: { flexDirection: "row", gap: spacing[2], marginBottom: spacing[2] },
  businessTypeRow: { flexDirection: "row", gap: spacing[2] },
  businessTypeButton: { alignItems: "center", backgroundColor: colors.surfaceSunk, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flex: 1, paddingVertical: spacing[4] },
  businessTypeSelected: { backgroundColor: colors.primarySubtle, borderColor: colors.primary },
  businessTypeText: { ...text("bodySm", "bold"), color: colors.textMuted },
  businessTypeTextSelected: { color: colors.primaryPressed },
  countryButton: { backgroundColor: colors.surfaceSunk, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  countryButtonSelected: { backgroundColor: colors.primarySubtle, borderColor: colors.primary },
  countryText: { ...text("bodySm", "bold"), color: colors.textMuted },
  countryTextSelected: { color: colors.primaryPressed },
  error: { ...text("bodySm"), backgroundColor: colors.errorSubtle, borderRadius: radius.sm, color: colors.error, marginBottom: spacing[3], padding: spacing[3] },
  primaryButton: { alignItems: "center", backgroundColor: colors.primary, borderRadius: radius.lg, justifyContent: "center", minHeight: 52, paddingHorizontal: spacing[4] },
  primaryButtonText: { ...text("bodySm", "bold"), color: colors.textInverse },
  backButton: { alignItems: "center", marginTop: spacing[4], padding: spacing[2] },
  backButtonText: { ...text("caption", "bold"), color: colors.textMuted }
});
