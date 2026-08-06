import { useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  type KeyboardTypeOptions,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ApiError,
  apiBaseUrl,
  listMyNotifications,
  login,
  requestPasswordResetCode,
  requestSignupCode,
  resetPassword,
  verifyPasswordResetCode,
  verifySignupCode,
  type AuthResult,
  type OtpRequestResult,
  type PublicUser,
  type SignupInput
} from "./api";
import type { AppScreen, PhonePrefill } from "./navigation";
import {
  countryCodes,
  maskPhone,
  normalizePhoneNumber,
  PhoneValidationError,
  type CountryCode
} from "./phone";
import { getAccessToken } from "./session";
import { useRealtimeEvent } from "./socket";

const logo = require("../assets/logo/TasawaQ.png");
const strongPasswordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,72}$/;

type LoginScreenProps = {
  prefill?: PhonePrefill;
  notice?: string;
  onAuthenticated: (result: AuthResult) => Promise<void>;
  onSignup: (prefill: PhonePrefill) => void;
  onForgotPassword: (prefill: PhonePrefill) => void;
};

export function LoginScreen(props: LoginScreenProps) {
  const [countryCode, setCountryCode] = useState<CountryCode>(props.prefill?.countryCode ?? "+970");
  const [phoneNumber, setPhoneNumber] = useState(props.prefill?.phoneNumber ?? "0590000000");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const prefill = { countryCode, phoneNumber };

  async function submit() {
    setError(null);
    try {
      normalizePhoneNumber(countryCode, phoneNumber);
    } catch (validationError) {
      setError(readError(validationError));
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }
    setLoading(true);
    try {
      await props.onAuthenticated(await login({ countryCode, phoneNumber, password }));
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Log in with your mobile number">
      {props.notice ? <Notice text={props.notice} /> : null}
      <PhoneFields
        countryCode={countryCode}
        phoneNumber={phoneNumber}
        onCountryCodeChange={setCountryCode}
        onPhoneNumberChange={setPhoneNumber}
      />
      <FormField label="Password" value={password} onChangeText={setPassword} secureTextEntry />
      <ErrorText message={error} />
      <PrimaryButton label="Log in" loading={loading} onPress={submit} />
      <LinkButton label="Create Customer Account" onPress={() => props.onSignup(prefill)} />
      <LinkButton label="Forgot Password?" onPress={() => props.onForgotPassword(prefill)} />
      <DeveloperApiLabel />
    </AuthLayout>
  );
}

type SignupScreenProps = {
  prefill?: PhonePrefill;
  onOtpRequested: (input: SignupInput, result: OtpRequestResult) => void;
  onLogin: (prefill: PhonePrefill) => void;
  onForgotPassword: (prefill: PhonePrefill) => void;
};

export function SignupScreen(props: SignupScreenProps) {
  const [fullName, setFullName] = useState("");
  const [countryCode, setCountryCode] = useState<CountryCode>(props.prefill?.countryCode ?? "+970");
  const [phoneNumber, setPhoneNumber] = useState(props.prefill?.phoneNumber ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phoneExists, setPhoneExists] = useState(false);
  const [loading, setLoading] = useState(false);
  const prefill = { countryCode, phoneNumber };

  async function submit() {
    setError(null);
    setPhoneExists(false);
    if (fullName.trim().length < 2) {
      setError("Please enter your full name.");
      return;
    }
    try {
      normalizePhoneNumber(countryCode, phoneNumber);
    } catch (validationError) {
      setError(readError(validationError));
      return;
    }
    if (!strongPasswordPattern.test(password)) {
      setError("Password must be 8-72 characters and include uppercase, lowercase, number, and symbol.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    const input = { fullName: fullName.trim(), countryCode, phoneNumber, password, confirmPassword };
    setLoading(true);
    try {
      props.onOtpRequested(input, await requestSignupCode(input));
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.code === "PHONE_ALREADY_REGISTERED") {
        setPhoneExists(true);
        setError("An account already exists with this phone number.\nPlease log in or reset your password.");
      } else {
        setError(readError(requestError));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Create Customer Account" subtitle="Verify your phone to join TasawaQ">
      <FormField label="Full name" value={fullName} onChangeText={setFullName} autoCapitalize="words" />
      <PhoneFields
        countryCode={countryCode}
        phoneNumber={phoneNumber}
        onCountryCodeChange={setCountryCode}
        onPhoneNumberChange={setPhoneNumber}
      />
      <FormField label="Password" value={password} onChangeText={setPassword} secureTextEntry />
      <Text style={styles.help}>Use 8+ characters with uppercase, lowercase, number, and symbol.</Text>
      <FormField
        label="Confirm password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
      />
      <ErrorText message={error} />
      <PrimaryButton label="Create Account" loading={loading} onPress={submit} />
      {phoneExists ? (
        <View style={styles.inlineActions}>
          <SecondaryButton label="Go to Login" onPress={() => props.onLogin(prefill)} />
          <SecondaryButton label="Forgot Password" onPress={() => props.onForgotPassword(prefill)} />
        </View>
      ) : null}
      <LinkButton label="Back to Login" onPress={() => props.onLogin(prefill)} />
    </AuthLayout>
  );
}

type ForgotPasswordScreenProps = {
  prefill?: PhonePrefill;
  onOtpRequested: (input: PhonePrefill, result: OtpRequestResult) => void;
  onLogin: (prefill: PhonePrefill) => void;
  onCreateAccount: (prefill: PhonePrefill) => void;
};

export function ForgotPasswordScreen(props: ForgotPasswordScreenProps) {
  const [countryCode, setCountryCode] = useState<CountryCode>(props.prefill?.countryCode ?? "+970");
  const [phoneNumber, setPhoneNumber] = useState(props.prefill?.phoneNumber ?? "");
  const [error, setError] = useState<string | null>(null);
  const [accountNotFound, setAccountNotFound] = useState(false);
  const [loading, setLoading] = useState(false);
  const prefill = { countryCode, phoneNumber };

  async function submit() {
    setError(null);
    setAccountNotFound(false);
    try {
      normalizePhoneNumber(countryCode, phoneNumber);
    } catch (validationError) {
      setError(readError(validationError));
      return;
    }
    setLoading(true);
    try {
      props.onOtpRequested(prefill, await requestPasswordResetCode(prefill));
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.code === "ACCOUNT_NOT_FOUND") {
        setAccountNotFound(true);
        setError("No account was found with this phone number.\nWould you like to create a new customer account?");
      } else {
        setError(readError(requestError));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Forgot Password" subtitle="We will create a free development verification code">
      <PhoneFields
        countryCode={countryCode}
        phoneNumber={phoneNumber}
        onCountryCodeChange={setCountryCode}
        onPhoneNumberChange={setPhoneNumber}
      />
      <ErrorText message={error} />
      <PrimaryButton label="Continue" loading={loading} onPress={submit} />
      {accountNotFound ? (
        <SecondaryButton label="Create Account" onPress={() => props.onCreateAccount(prefill)} />
      ) : null}
      <LinkButton label="Back to Login" onPress={() => props.onLogin(prefill)} />
    </AuthLayout>
  );
}

type OtpScreenProps = {
  screen: Extract<AppScreen, { name: "otp" }>;
  onAuthenticated: (result: AuthResult) => Promise<void>;
  onResetToken: (token: string) => void;
  onBack: () => void;
};

export function OtpScreen(props: OtpScreenProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(props.screen.resendAvailableInSeconds);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [countdown > 0]);

  async function verify() {
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the complete six-digit verification code.");
      return;
    }
    setLoading(true);
    const input = {
      countryCode: props.screen.countryCode,
      phoneNumber: props.screen.phoneNumber,
      code
    };
    try {
      if (props.screen.purpose === "signup") {
        await props.onAuthenticated(await verifySignupCode(input));
      } else {
        const result = await verifyPasswordResetCode(input);
        props.onResetToken(result.resetToken);
      }
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (countdown > 0 || resending) return;
    setError(null);
    setResending(true);
    try {
      const result = props.screen.purpose === "signup"
        ? await requestSignupCode(props.screen.signupDraft!)
        : await requestPasswordResetCode({
            countryCode: props.screen.countryCode,
            phoneNumber: props.screen.phoneNumber
          });
      setCountdown(result.resendAvailableInSeconds);
      setCode("");
    } catch (requestError) {
      setError(readError(requestError));
      if (requestError instanceof ApiError && requestError.code === "OTP_RESEND_COOLDOWN") {
        const seconds = readRetrySeconds(requestError.details);
        if (seconds) setCountdown(seconds);
      }
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthLayout title="Verify Phone" subtitle={`Enter the code for ${maskPhone(props.screen.normalizedPhone)}`}>
      <FormField
        label="Six-digit verification code"
        value={code}
        onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        textAlign="center"
      />
      <Text style={styles.help}>The development code is printed only in the backend terminal.</Text>
      <ErrorText message={error} />
      <PrimaryButton label="Verify" loading={loading} onPress={verify} />
      <SecondaryButton
        disabled={countdown > 0 || resending}
        label={countdown > 0 ? `Resend Code (${countdown}s)` : "Resend Code"}
        loading={resending}
        onPress={resend}
      />
      <LinkButton label="Back" onPress={props.onBack} />
    </AuthLayout>
  );
}

export function NewPasswordScreen(props: {
  resetToken: string;
  onSuccess: (message: string) => void;
  onBack: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(null);
    if (!strongPasswordPattern.test(password)) {
      setError("Password must be 8-72 characters and include uppercase, lowercase, number, and symbol.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const result = await resetPassword({ resetToken: props.resetToken, password, confirmPassword });
      props.onSuccess(result.message);
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="New Password" subtitle="Choose a new password for your account">
      <FormField label="New password" value={password} onChangeText={setPassword} secureTextEntry />
      <Text style={styles.help}>Use 8+ characters with uppercase, lowercase, number, and symbol.</Text>
      <FormField
        label="Confirm new password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
      />
      <ErrorText message={error} />
      <PrimaryButton label="Reset Password" loading={loading} onPress={submit} />
      <LinkButton label="Back to Login" onPress={props.onBack} />
    </AuthLayout>
  );
}

export function HomeScreen(props: {
  user: PublicUser;
  notice?: string;
  onLogout: () => Promise<void>;
  onBrowseRestaurants?: () => void;
  onViewOrders?: () => void;
  onManageOrders?: () => void;
  onOpenDriverDashboard?: () => void;
  onOpenNotifications: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  async function loadUnreadCount() {
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) return;
      const page = await listMyNotifications(accessToken, 1, 1);
      setUnreadCount(page.unreadCount);
    } catch {
      // A failed unread-count fetch is not worth surfacing on the home screen.
    }
  }

  useEffect(() => {
    void loadUnreadCount();
  }, []);

  useRealtimeEvent("notification.created", () => void loadUnreadCount());

  async function submitLogout() {
    setLoading(true);
    try {
      await props.onLogout();
    } finally {
      setLoading(false);
    }
  }
  return (
    <AuthLayout
      title={props.user.role === "CUSTOMER" ? "Customer Home" : `${titleCase(props.user.role)} Home`}
      subtitle={`Welcome, ${props.user.fullName}`}
    >
      {props.notice ? <Notice text={props.notice} /> : null}
      <View style={styles.profileCard}>
        <Text style={styles.profileLabel}>Phone</Text>
        <Text style={styles.profileValue}>{props.user.phone}</Text>
        <Text style={styles.profileLabel}>Role</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleBadgeText}>{props.user.role}</Text>
        </View>
      </View>
      {props.onBrowseRestaurants ? (
        <PrimaryButton label="Browse Restaurants" onPress={props.onBrowseRestaurants} />
      ) : null}
      {props.onViewOrders ? <SecondaryButton label="My Orders" onPress={props.onViewOrders} /> : null}
      {props.onManageOrders ? <PrimaryButton label="Manage Incoming Orders" onPress={props.onManageOrders} /> : null}
      {props.onOpenDriverDashboard ? (
        <PrimaryButton label="Delivery Dashboard" onPress={props.onOpenDriverDashboard} />
      ) : null}
      <SecondaryButton
        label={unreadCount > 0 ? `Notifications (${unreadCount})` : "Notifications"}
        onPress={props.onOpenNotifications}
      />
      <SecondaryButton label="Log out" loading={loading} onPress={submitLogout} />
    </AuthLayout>
  );
}

function AuthLayout(props: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor="#F5FAFC" barStyle="dark-content" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Image accessibilityLabel="TasawaQ logo" resizeMode="contain" source={logo} style={styles.logo} />
          <Text style={styles.title}>{props.title}</Text>
          <Text style={styles.subtitle}>{props.subtitle}</Text>
          <View style={styles.panel}>{props.children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PhoneFields(props: {
  countryCode: CountryCode;
  phoneNumber: string;
  onCountryCodeChange: (value: CountryCode) => void;
  onPhoneNumberChange: (value: string) => void;
}) {
  return (
    <>
      <Text style={styles.label}>Country code</Text>
      <View style={styles.countryRow}>
        {countryCodes.map((countryCode) => (
          <Pressable
            accessibilityRole="button"
            key={countryCode}
            onPress={() => props.onCountryCodeChange(countryCode)}
            style={[
              styles.countryButton,
              props.countryCode === countryCode && styles.countryButtonSelected
            ]}
          >
            <Text
              style={[
                styles.countryButtonText,
                props.countryCode === countryCode && styles.countryButtonTextSelected
              ]}
            >
              {countryCode}
            </Text>
          </Pressable>
        ))}
      </View>
      <FormField
        keyboardType="phone-pad"
        label="Phone number"
        onChangeText={props.onPhoneNumberChange}
        placeholder="0591234567"
        value={props.phoneNumber}
      />
    </>
  );
}

function FormField(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  maxLength?: number;
  textAlign?: "left" | "center" | "right";
}) {
  return (
    <>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        autoCapitalize={props.autoCapitalize ?? "none"}
        keyboardType={props.keyboardType}
        maxLength={props.maxLength}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor="#94A3B8"
        secureTextEntry={props.secureTextEntry}
        style={[styles.input, props.textAlign === "center" && styles.centerInput]}
        value={props.value}
      />
    </>
  );
}

function PrimaryButton(props: { label: string; loading?: boolean; onPress: () => void }) {
  return (
    <Pressable
      disabled={props.loading}
      onPress={props.onPress}
      style={({ pressed }) => [styles.primaryButton, (pressed || props.loading) && styles.buttonPressed]}
    >
      {props.loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{props.label}</Text>}
    </Pressable>
  );
}

function SecondaryButton(props: {
  label: string;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={props.disabled || props.loading}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        (pressed || props.disabled || props.loading) && styles.secondaryDisabled
      ]}
    >
      {props.loading ? (
        <ActivityIndicator color="#0F766E" />
      ) : (
        <Text style={styles.secondaryText}>{props.label}</Text>
      )}
    </Pressable>
  );
}

function LinkButton(props: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={styles.linkButton}>
      <Text style={styles.linkText}>{props.label}</Text>
    </Pressable>
  );
}

function ErrorText({ message }: { message: string | null }) {
  return message ? <Text style={styles.error}>{message}</Text> : null;
}

function Notice({ text }: { text: string }) {
  return <Text style={styles.notice}>{text}</Text>;
}

function DeveloperApiLabel() {
  return (
    <View style={styles.apiBox}>
      <Text style={styles.apiLabel}>Development API</Text>
      <Text style={styles.apiValue}>{apiBaseUrl}</Text>
    </View>
  );
}

function readError(error: unknown): string {
  if (error instanceof ApiError || error instanceof PhoneValidationError || error instanceof Error) {
    return error.message;
  }
  return "The request could not be completed. Please try again.";
}

function readRetrySeconds(details: unknown): number | null {
  if (!details || typeof details !== "object") return null;
  const value = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return typeof value === "number" ? value : null;
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#F5FAFC", flex: 1 },
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: 24, paddingBottom: 48 },
  logo: { alignSelf: "center", height: 155, width: 205 },
  title: { color: "#0F172A", fontSize: 28, fontWeight: "800", textAlign: "center" },
  subtitle: { color: "#64748B", fontSize: 15, marginBottom: 22, marginTop: 6, textAlign: "center" },
  panel: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D9E2EC",
    borderRadius: 16,
    borderWidth: 1,
    padding: 20
  },
  label: { color: "#334155", fontSize: 14, fontWeight: "700", marginBottom: 8, marginTop: 14 },
  input: {
    backgroundColor: "#F8FAFC",
    borderColor: "#CBD5E1",
    borderRadius: 10,
    borderWidth: 1,
    color: "#0F172A",
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 14
  },
  centerInput: { fontSize: 24, fontWeight: "700", letterSpacing: 8, textAlign: "center" },
  countryRow: { flexDirection: "row", gap: 10 },
  countryButton: {
    alignItems: "center",
    borderColor: "#CBD5E1",
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    minHeight: 48,
    justifyContent: "center"
  },
  countryButtonSelected: { backgroundColor: "#DDF7F1", borderColor: "#0F766E" },
  countryButtonText: { color: "#475569", fontSize: 16, fontWeight: "700" },
  countryButtonTextSelected: { color: "#0F766E" },
  help: { color: "#64748B", fontSize: 12, lineHeight: 18, marginTop: 7 },
  error: { color: "#B91C1C", fontSize: 14, lineHeight: 20, marginTop: 14 },
  notice: {
    backgroundColor: "#DCFCE7",
    borderRadius: 10,
    color: "#166534",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
    padding: 12
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#0F766E",
    borderRadius: 10,
    justifyContent: "center",
    marginTop: 20,
    minHeight: 52
  },
  buttonPressed: { backgroundColor: "#115E59", opacity: 0.8 },
  primaryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#0F766E",
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 12,
    minHeight: 50
  },
  secondaryDisabled: { opacity: 0.45 },
  secondaryText: { color: "#0F766E", fontSize: 15, fontWeight: "800" },
  linkButton: { alignItems: "center", padding: 12 },
  linkText: { color: "#0369A1", fontSize: 14, fontWeight: "700" },
  inlineActions: { marginTop: 4 },
  profileCard: { backgroundColor: "#F8FAFC", borderRadius: 12, padding: 16 },
  profileLabel: { color: "#64748B", fontSize: 12, fontWeight: "700", marginBottom: 5, marginTop: 9 },
  profileValue: { color: "#0F172A", fontSize: 18, fontWeight: "700" },
  roleBadge: { alignSelf: "flex-start", backgroundColor: "#E0F2FE", borderRadius: 8, padding: 8 },
  roleBadgeText: { color: "#0369A1", fontSize: 13, fontWeight: "800" },
  apiBox: { marginTop: 18 },
  apiLabel: { color: "#94A3B8", fontSize: 11, fontWeight: "700" },
  apiValue: { color: "#64748B", fontSize: 12, marginTop: 3 }
});
