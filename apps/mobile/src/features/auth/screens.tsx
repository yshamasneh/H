import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
} from "../../core/api";
import type { AppScreen, PhonePrefill } from "../../navigation/navigation";
import {
  countryCodes,
  maskPhone,
  normalizePhoneNumber,
  PhoneValidationError,
  type CountryCode
} from "../../core/phone";
import { getAccessToken } from "../../core/session";
import { useRealtimeEvent } from "../../core/socket";
import i18n from "../../i18n";
import { colors, radius, spacing } from "../../theme/tokens";
import { text } from "../../theme/typography";
import { strongPasswordPattern } from "./auth.rules";

const logo = require("../../../assets/logo/jovo-wordmark.png");

type LoginScreenProps = {
  prefill?: PhonePrefill;
  notice?: string;
  onAuthenticated: (result: AuthResult) => Promise<void>;
  onSignup: (prefill: PhonePrefill) => void;
  onRestaurantSignup: (prefill: PhonePrefill) => void;
  onDriverSignup: (prefill: PhonePrefill) => void;
  onForgotPassword: (prefill: PhonePrefill) => void;
};

export function LoginScreen(props: LoginScreenProps) {
  const { t } = useTranslation(["auth", "common"]);
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
      setError(t("validation.passwordRequired"));
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
    <AuthLayout title={t("login.title")} subtitle={t("login.subtitle")}>
      {props.notice ? <Notice text={props.notice} /> : null}
      <PhoneFields
        countryCode={countryCode}
        phoneNumber={phoneNumber}
        onCountryCodeChange={setCountryCode}
        onPhoneNumberChange={setPhoneNumber}
      />
      <FormField label={t("fields.password")} value={password} onChangeText={setPassword} secureTextEntry />
      <ErrorText message={error} />
      <PrimaryButton label={t("login.submit")} loading={loading} onPress={submit} />
      <LinkButton label={t("login.createAccount")} onPress={() => props.onSignup(prefill)} />
      <View style={styles.inlineActions}>
        <SecondaryButton label={t("login.registerRestaurant")} onPress={() => props.onRestaurantSignup(prefill)} />
        <SecondaryButton label={t("login.registerDriver")} onPress={() => props.onDriverSignup(prefill)} />
      </View>
      <LinkButton label={t("login.forgotPassword")} onPress={() => props.onForgotPassword(prefill)} />
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
  const { t } = useTranslation(["auth", "common"]);
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
      setError(t("validation.fullNameRequired"));
      return;
    }
    try {
      normalizePhoneNumber(countryCode, phoneNumber);
    } catch (validationError) {
      setError(readError(validationError));
      return;
    }
    if (!strongPasswordPattern.test(password)) {
      setError(t("validation.passwordStrength"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("validation.passwordMismatch"));
      return;
    }
    const input = { fullName: fullName.trim(), countryCode, phoneNumber, password, confirmPassword };
    setLoading(true);
    try {
      props.onOtpRequested(input, await requestSignupCode(input));
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.code === "PHONE_ALREADY_REGISTERED") {
        setPhoneExists(true);
        setError(t("signup.phoneExists"));
      } else {
        setError(readError(requestError));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title={t("signup.title")} subtitle={t("signup.subtitle")}>
      <FormField label={t("fields.fullName")} value={fullName} onChangeText={setFullName} autoCapitalize="words" />
      <PhoneFields
        countryCode={countryCode}
        phoneNumber={phoneNumber}
        onCountryCodeChange={setCountryCode}
        onPhoneNumberChange={setPhoneNumber}
      />
      <FormField label={t("fields.password")} value={password} onChangeText={setPassword} secureTextEntry />
      <Text style={styles.help}>{t("validation.passwordHelp")}</Text>
      <FormField
        label={t("fields.confirmPassword")}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
      />
      <ErrorText message={error} />
      <PrimaryButton label={t("signup.submit")} loading={loading} onPress={submit} />
      {phoneExists ? (
        <View style={styles.inlineActions}>
          <SecondaryButton label={t("signup.goToLogin")} onPress={() => props.onLogin(prefill)} />
          <SecondaryButton label={t("signup.forgotPassword")} onPress={() => props.onForgotPassword(prefill)} />
        </View>
      ) : null}
      <LinkButton label={t("shared.backToLogin")} onPress={() => props.onLogin(prefill)} />
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
  const { t } = useTranslation(["auth", "common"]);
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
        setError(t("forgotPassword.accountNotFound"));
      } else {
        setError(readError(requestError));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title={t("forgotPassword.title")} subtitle={t("forgotPassword.subtitle")}>
      <PhoneFields
        countryCode={countryCode}
        phoneNumber={phoneNumber}
        onCountryCodeChange={setCountryCode}
        onPhoneNumberChange={setPhoneNumber}
      />
      <ErrorText message={error} />
      <PrimaryButton label={t("shared.continue")} loading={loading} onPress={submit} />
      {accountNotFound ? (
        <SecondaryButton label={t("forgotPassword.createAccount")} onPress={() => props.onCreateAccount(prefill)} />
      ) : null}
      <LinkButton label={t("shared.backToLogin")} onPress={() => props.onLogin(prefill)} />
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
  const { t } = useTranslation(["auth", "common"]);
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
      setError(t("otp.incompleteCode"));
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
    <AuthLayout title={t("otp.title")} subtitle={t("otp.subtitle", { phone: maskPhone(props.screen.normalizedPhone) })}>
      <FormField
        label={t("otp.codeLabel")}
        value={code}
        onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        textAlign="center"
      />
      <Text style={styles.help}>{t("otp.devCodeHelp")}</Text>
      <ErrorText message={error} />
      <PrimaryButton label={t("otp.verify")} loading={loading} onPress={verify} />
      <SecondaryButton
        disabled={countdown > 0 || resending}
        label={countdown > 0 ? t("otp.resendCodeCountdown", { seconds: countdown }) : t("otp.resendCode")}
        loading={resending}
        onPress={resend}
      />
      <LinkButton label={t("shared.back")} onPress={props.onBack} />
    </AuthLayout>
  );
}

export function NewPasswordScreen(props: {
  resetToken: string;
  onSuccess: (message: string) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation(["auth", "common"]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(null);
    if (!strongPasswordPattern.test(password)) {
      setError(t("validation.passwordStrength"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("validation.passwordMismatch"));
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
    <AuthLayout title={t("newPassword.title")} subtitle={t("newPassword.subtitle")}>
      <FormField label={t("fields.newPassword")} value={password} onChangeText={setPassword} secureTextEntry />
      <Text style={styles.help}>{t("validation.passwordHelp")}</Text>
      <FormField
        label={t("fields.confirmNewPassword")}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
      />
      <ErrorText message={error} />
      <PrimaryButton label={t("newPassword.submit")} loading={loading} onPress={submit} />
      <LinkButton label={t("shared.backToLogin")} onPress={props.onBack} />
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
  onManageRestaurant?: () => void;
  onOpenDriverDashboard?: () => void;
  onOpenNotifications: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation(["auth", "common"]);
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
      title={t("home.title", { role: t(`common:role.${props.user.role}`) })}
      subtitle={t("home.subtitle", { name: props.user.fullName })}
    >
      {props.notice ? <Notice text={props.notice} /> : null}
      <View style={styles.profileCard}>
        <Text style={styles.profileLabel}>{t("home.phoneLabel")}</Text>
        <Text style={styles.profileValue}>{props.user.phone}</Text>
        <Text style={styles.profileLabel}>{t("home.roleLabel")}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleBadgeText}>{t(`common:role.${props.user.role}`)}</Text>
        </View>
      </View>
      {props.onBrowseRestaurants ? (
        <PrimaryButton label={t("home.browseRestaurants")} onPress={props.onBrowseRestaurants} />
      ) : null}
      {props.onViewOrders ? <SecondaryButton label={t("home.myOrders")} onPress={props.onViewOrders} /> : null}
      {props.onManageOrders ? (
        <PrimaryButton label={t("home.manageOrders")} onPress={props.onManageOrders} />
      ) : null}
      {props.onManageRestaurant ? (
        <SecondaryButton label={t("home.manageRestaurant")} onPress={props.onManageRestaurant} />
      ) : null}
      {props.onOpenDriverDashboard ? (
        <PrimaryButton label={t("home.driverDashboard")} onPress={props.onOpenDriverDashboard} />
      ) : null}
      <SecondaryButton
        label={
          unreadCount > 0
            ? t("home.notificationsCount", { label: t("common:notifications"), count: unreadCount })
            : t("common:notifications")
        }
        onPress={props.onOpenNotifications}
      />
      <SecondaryButton label={t("common:settings")} onPress={props.onOpenSettings} />
      <SecondaryButton label={t("common:logout")} loading={loading} onPress={submitLogout} />
    </AuthLayout>
  );
}

function AuthLayout(props: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={colors.surfaceSunk} barStyle="dark-content" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Image accessibilityLabel="JOVO" resizeMode="contain" source={logo} style={styles.logo} />
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
  const { t } = useTranslation(["auth"]);
  return (
    <>
      <Text style={styles.label}>{t("fields.countryCode")}</Text>
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
        label={t("fields.phoneNumber")}
        onChangeText={props.onPhoneNumberChange}
        placeholder={t("fields.phoneNumberPlaceholder")}
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
        placeholderTextColor={colors.textMuted}
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
      {props.loading ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.primaryText}>{props.label}</Text>}
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
        <ActivityIndicator color={colors.text} />
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
  const { t } = useTranslation(["auth"]);
  return (
    <View style={styles.apiBox}>
      <Text style={styles.apiLabel}>{t("login.developerApiLabel")}</Text>
      <Text style={styles.apiValue}>{apiBaseUrl}</Text>
    </View>
  );
}

function readError(error: unknown): string {
  if (error instanceof ApiError || error instanceof PhoneValidationError || error instanceof Error) {
    return error.message;
  }
  return i18n.t("auth:shared.requestFailed");
}

function readRetrySeconds(details: unknown): number | null {
  if (!details || typeof details !== "object") return null;
  const value = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return typeof value === "number" ? value : null;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.surfaceSunk, flex: 1 },
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: spacing[6], paddingBottom: spacing[9] },
  logo: { alignSelf: "center", height: 68, width: 220 },
  title: { ...text("h1", "bold"), color: colors.text, textAlign: "center" },
  subtitle: { ...text("body"), color: colors.textMuted, marginBottom: spacing[5], marginTop: spacing[2], textAlign: "center" },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing[5]
  },
  label: { ...text("bodySm", "bold"), color: colors.text, marginBottom: spacing[2], marginTop: spacing[4] },
  input: {
    backgroundColor: colors.surfaceSunk,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    ...text("body"),
    minHeight: 52,
    paddingHorizontal: spacing[4]
  },
  centerInput: { ...text("h1", "bold"), letterSpacing: 8, textAlign: "center" },
  countryRow: { flexDirection: "row", gap: spacing[3] },
  countryButton: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    minHeight: 48,
    justifyContent: "center"
  },
  countryButtonSelected: { backgroundColor: colors.primarySubtle, borderColor: colors.primary },
  countryButtonText: { ...text("body", "bold"), color: colors.textMuted },
  countryButtonTextSelected: { color: colors.primaryPressed },
  help: { ...text("caption"), color: colors.textMuted, marginTop: spacing[2] },
  error: { ...text("bodySm"), color: colors.error, marginTop: spacing[4] },
  notice: {
    ...text("bodySm"),
    backgroundColor: colors.successSubtle,
    borderRadius: radius.md,
    color: colors.success,
    marginBottom: spacing[2],
    padding: spacing[3]
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    justifyContent: "center",
    marginTop: spacing[5],
    minHeight: 52
  },
  buttonPressed: { backgroundColor: colors.primaryPressed, opacity: 0.8 },
  primaryText: { ...text("body", "bold"), color: colors.textInverse },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: spacing[3],
    minHeight: 50
  },
  secondaryDisabled: { opacity: 0.45 },
  secondaryText: { ...text("bodySm", "bold"), color: colors.text },
  linkButton: { alignItems: "center", padding: spacing[3] },
  linkText: { ...text("bodySm", "medium"), color: colors.textMuted },
  inlineActions: { marginTop: spacing[1] },
  profileCard: { backgroundColor: colors.surfaceSunk, borderRadius: radius.md, padding: spacing[4] },
  profileLabel: { ...text("caption", "bold"), color: colors.textMuted, marginBottom: spacing[1], marginTop: spacing[2] },
  profileValue: { ...text("h3", "bold"), color: colors.text },
  roleBadge: { alignSelf: "flex-start", backgroundColor: colors.neutralSubtle, borderRadius: radius.sm, padding: spacing[2] },
  roleBadgeText: { ...text("caption", "bold"), color: colors.text },
  apiBox: { marginTop: spacing[5] },
  apiLabel: { ...text("label", "bold"), color: colors.textMuted },
  apiValue: { ...text("caption"), color: colors.textMuted, marginTop: spacing[1] }
});
