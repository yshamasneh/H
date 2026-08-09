import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, fetchCurrentUser, getAccessToken, login as apiLogin, logout as apiLogout, setAccessToken, type PublicUser } from "./api";

type AuthState = {
  user: PublicUser | null;
  isBooting: boolean;
  error: string | null;
  signIn: (countryCode: string, phoneNumber: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function restore() {
      const token = getAccessToken();
      if (!token) {
        setIsBooting(false);
        return;
      }
      try {
        const currentUser = await fetchCurrentUser();
        if (currentUser.role !== "ADMIN") {
          setAccessToken(null);
          setError(t("login.errorNotAdminRestore"));
        } else {
          setUser(currentUser);
        }
      } catch {
        setAccessToken(null);
      } finally {
        setIsBooting(false);
      }
    }
    void restore();
  }, []);

  async function signIn(countryCode: string, phoneNumber: string, password: string) {
    setError(null);
    try {
      const result = await apiLogin({ countryCode, phoneNumber, password });
      if (result.user.role !== "ADMIN") {
        setError(t("login.errorNotAdminSignIn"));
        return;
      }
      setAccessToken(result.accessToken);
      setUser(result.user);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("login.errorGeneric"));
    }
  }

  async function signOut() {
    try {
      await apiLogout();
    } catch {
      // Local sign-out still clears credentials if the API is unreachable.
    }
    setAccessToken(null);
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, isBooting, error, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
