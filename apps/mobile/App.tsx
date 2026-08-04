import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StatusBar,
  StyleSheet,
  View
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  fetchCurrentUser,
  logout,
  refreshSession,
  type AuthResult
} from "./src/api";
import {
  ForgotPasswordScreen,
  HomeScreen,
  LoginScreen,
  NewPasswordScreen,
  OtpScreen,
  SignupScreen
} from "./src/auth-screens";
import {
  accountNotFoundToSignup,
  authResultToHome,
  forgotRequestToOtp,
  goToLogin,
  goToSignup,
  initialScreen,
  resetOtpToNewPassword,
  signupRequestToOtp,
  type AppScreen
} from "./src/navigation";

const accessTokenStorageKey = "wasel_access_token";
const refreshTokenStorageKey = "wasel_refresh_token";
const splashDurationMs = 3000;
const logo = require("./assets/logo/TasawaQ.png");

export default function App() {
  return (
    <SafeAreaProvider>
      <TasawaQApp />
    </SafeAreaProvider>
  );
}

function TasawaQApp() {
  const [screen, setScreen] = useState<AppScreen>(initialScreen);
  const [isBooting, setIsBooting] = useState(true);
  const [isSplashVisible, setIsSplashVisible] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const splashTimer = setTimeout(() => {
      if (isMounted) setIsSplashVisible(false);
    }, splashDurationMs);

    async function restoreSession() {
      try {
        const [accessToken, storedRefreshToken] = await Promise.all([
          SecureStore.getItemAsync(accessTokenStorageKey),
          SecureStore.getItemAsync(refreshTokenStorageKey)
        ]);
        if (!accessToken) return;

        try {
          const user = await fetchCurrentUser(accessToken);
          if (isMounted) setScreen({ name: "home", user });
        } catch {
          if (!storedRefreshToken) throw new Error("No refresh token");
          const result = await refreshSession(storedRefreshToken);
          await saveTokens(result);
          if (isMounted) setScreen(authResultToHome(result));
        }
      } catch {
        await clearTokens();
      } finally {
        if (isMounted) setIsBooting(false);
      }
    }

    void restoreSession();
    return () => {
      isMounted = false;
      clearTimeout(splashTimer);
    };
  }, []);

  async function handleAuthenticated(result: AuthResult, notice?: string) {
    await saveTokens(result);
    setScreen({ ...authResultToHome(result), notice });
  }

  async function handleLogout() {
    const accessToken = await SecureStore.getItemAsync(accessTokenStorageKey);
    if (accessToken) {
      try {
        await logout(accessToken);
      } catch {
        // Local logout still clears credentials if the API is unavailable.
      }
    }
    await clearTokens();
    setScreen(goToLogin());
  }

  if (isSplashVisible) {
    return (
      <SafeAreaView style={styles.splashScreen}>
        <StatusBar backgroundColor="#F5FAFC" barStyle="dark-content" />
        <Image
          accessibilityLabel="TasawaQ logo"
          resizeMode="contain"
          source={logo}
          style={styles.splashLogo}
        />
      </SafeAreaView>
    );
  }

  if (isBooting) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <StatusBar backgroundColor="#F5FAFC" barStyle="dark-content" />
        <View style={styles.centered}>
          <ActivityIndicator color="#0F766E" size="large" />
        </View>
      </SafeAreaView>
    );
  }

  switch (screen.name) {
    case "login":
      return (
        <LoginScreen
          notice={screen.notice}
          onAuthenticated={handleAuthenticated}
          onForgotPassword={(prefill) => setScreen({ name: "forgot-password", prefill })}
          onSignup={(prefill) => setScreen(goToSignup(prefill))}
          prefill={screen.prefill}
        />
      );
    case "signup":
      return (
        <SignupScreen
          onForgotPassword={(prefill) => setScreen({ name: "forgot-password", prefill })}
          onLogin={(prefill) => setScreen(goToLogin(prefill))}
          onOtpRequested={(input, result) => setScreen(signupRequestToOtp(input, result))}
          prefill={screen.prefill}
        />
      );
    case "forgot-password":
      return (
        <ForgotPasswordScreen
          onCreateAccount={(prefill) => setScreen(accountNotFoundToSignup(prefill))}
          onLogin={(prefill) => setScreen(goToLogin(prefill))}
          onOtpRequested={(input, result) => setScreen(forgotRequestToOtp(input, result))}
          prefill={screen.prefill}
        />
      );
    case "otp":
      return (
        <OtpScreen
          onAuthenticated={(result) =>
            handleAuthenticated(result, "Your customer account was created successfully.")
          }
          onBack={() =>
            setScreen(
              screen.purpose === "signup"
                ? goToSignup({ countryCode: screen.countryCode, phoneNumber: screen.phoneNumber })
                : { name: "forgot-password", prefill: { countryCode: screen.countryCode, phoneNumber: screen.phoneNumber } }
            )
          }
          onResetToken={(token) => setScreen(resetOtpToNewPassword(token))}
          screen={screen}
        />
      );
    case "new-password":
      return (
        <NewPasswordScreen
          onBack={() => setScreen(goToLogin())}
          onSuccess={(message) => setScreen(goToLogin(undefined, message))}
          resetToken={screen.resetToken}
        />
      );
    case "home":
      return <HomeScreen notice={screen.notice} onLogout={handleLogout} user={screen.user} />;
  }
}

async function saveTokens(result: AuthResult): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(accessTokenStorageKey, result.accessToken),
    SecureStore.setItemAsync(refreshTokenStorageKey, result.refreshToken)
  ]);
}

async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(accessTokenStorageKey),
    SecureStore.deleteItemAsync(refreshTokenStorageKey)
  ]);
}

const styles = StyleSheet.create({
  splashScreen: {
    alignItems: "center",
    backgroundColor: "#F5FAFC",
    flex: 1,
    justifyContent: "center"
  },
  splashLogo: {
    height: 320,
    maxWidth: 460,
    width: "88%"
  },
  loadingScreen: {
    backgroundColor: "#F5FAFC",
    flex: 1
  },
  centered: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center"
  }
});
