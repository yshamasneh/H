import { useState, type ReactNode } from "react";
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
import { strongPasswordPattern } from "./auth.rules";

type RegistrationProps = {
  prefill?: PhonePrefill;
  onBack: (prefill: PhonePrefill) => void;
  onRegistered: (prefill: PhonePrefill, message: string) => void;
};

export function RestaurantRegistrationScreen(props: RegistrationProps) {
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
    if (input.restaurantName.length < 2) return setError("Please enter the store name.");
    if (input.addressLine.length < 3) return setError("Please enter the store address.");

    setError(null);
    setLoading(true);
    try {
      await registerRestaurant(input);
      props.onRegistered(
        prefill,
        `${businessType === "SUPERMARKET" ? "Supermarket" : "Restaurant"} application submitted. Log in to prepare your profile and catalog while approval is pending.`
      );
    } catch (requestError) {
      setError(readRegistrationError(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <RegistrationLayout
      title="Register a store"
      subtitle="Choose your business type and submit it for administrator approval"
    >
      <View style={styles.field}>
        <Text style={styles.label}>Business type</Text>
        <View style={styles.businessTypeRow}>
          <Pressable onPress={() => setBusinessType("RESTAURANT")} style={[styles.businessTypeButton, businessType === "RESTAURANT" && styles.businessTypeSelected]}>
            <Text style={[styles.businessTypeText, businessType === "RESTAURANT" && styles.businessTypeTextSelected]}>Restaurant</Text>
          </Pressable>
          <Pressable onPress={() => setBusinessType("SUPERMARKET")} style={[styles.businessTypeButton, businessType === "SUPERMARKET" && styles.businessTypeSelected]}>
            <Text style={[styles.businessTypeText, businessType === "SUPERMARKET" && styles.businessTypeTextSelected]}>Supermarket</Text>
          </Pressable>
        </View>
      </View>
      <Field label="Owner full name" value={ownerFullName} onChangeText={setOwnerFullName} />
      <Field label={businessType === "SUPERMARKET" ? "Supermarket name" : "Restaurant name"} value={restaurantName} onChangeText={setRestaurantName} />
      <Field label="Address" value={addressLine} onChangeText={setAddressLine} multiline />
      <Field
        label="Description (optional)"
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
      <PrimaryButton label={`Submit ${businessType === "SUPERMARKET" ? "supermarket" : "restaurant"}`} loading={loading} onPress={() => void submit()} />
      <BackButton onPress={() => props.onBack(prefill)} />
    </RegistrationLayout>
  );
}

export function DriverRegistrationScreen(props: RegistrationProps) {
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
      props.onRegistered(
        prefill,
        "Driver application submitted. You can log in now; delivery work unlocks after administrator approval."
      );
    } catch (requestError) {
      setError(readRegistrationError(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <RegistrationLayout
      title="Register as a driver"
      subtitle="Create a driver account and submit it for administrator approval"
    >
      <Field label="Full name" value={fullName} onChangeText={setFullName} />
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
      <PrimaryButton label="Submit driver application" loading={loading} onPress={() => void submit()} />
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
          <Text style={styles.brand}>TASAWAQ</Text>
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
  return (
    <>
      <Field label="Password" value={props.password} onChangeText={props.onPasswordChange} secureTextEntry />
      <Text style={styles.help}>Use 8+ characters with uppercase, lowercase, number, and symbol.</Text>
      <Field
        label="Confirm password"
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
  return (
    <View style={styles.field}>
      <Text style={styles.label}>Mobile number</Text>
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
        placeholder="0591234567"
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
  return (
    <Pressable onPress={onPress} style={styles.backButton}>
      <Text style={styles.backButtonText}>Back to login</Text>
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
  if (name.length < 2) return "Please enter the full name.";
  try {
    normalizePhoneNumber(phone.countryCode, phone.phoneNumber);
  } catch (error) {
    return readRegistrationError(error);
  }
  if (!strongPasswordPattern.test(password)) {
    return "Password must be 8-72 characters and include uppercase, lowercase, number, and symbol.";
  }
  if (password !== confirmPassword) return "The passwords do not match.";
  return null;
}

function readRegistrationError(error: unknown): string {
  if (error instanceof ApiError || error instanceof PhoneValidationError) return error.message;
  if (error instanceof Error) return error.message;
  return "The request could not be completed.";
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
