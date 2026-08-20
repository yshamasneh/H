import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  clearSession,
  fetchCurrentUser,
  getAccessToken,
  login as apiLogin,
  logout as apiLogout,
  storeSession,
  type AccessContext,
  type Permission,
  type PublicUser
} from "./api";

type AuthState = {
  user: PublicUser | null;
  access: AccessContext | null;
  isBooting: boolean;
  error: string | null;
  /**
   * Whether the interface should offer a capability. The API checks every operation regardless, so
   * this only decides what is worth rendering — it is never the thing that protects an action.
   */
  can: (permission: Permission) => boolean;
  signIn: (countryCode: string, phoneNumber: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshAccess: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

/** Roles that have somewhere to go in this application. */
const supportedRoles = ["ADMIN", "RESTAURANT"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [access, setAccess] = useState<AccessContext | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadCurrent(): Promise<boolean> {
    const current = await fetchCurrentUser();
    if (!supportedRoles.includes(current.user.role)) {
      clearSession();
      setError(t("login.errorNotAdminRestore"));
      return false;
    }
    setUser(current.user);
    setAccess(current.access);
    return true;
  }

  useEffect(() => {
    async function restore() {
      if (!getAccessToken()) {
        setIsBooting(false);
        return;
      }
      try {
        await loadCurrent();
      } catch (restoreError) {
        // Only give up the stored session if the server actively rejected it. A network
        // failure at boot must not log the admin out (mirrors the mobile H-1 fix); the
        // refresh-on-401 in request() already handled a merely-expired access token.
        if (restoreError instanceof ApiError && restoreError.statusCode === 401) clearSession();
      } finally {
        setIsBooting(false);
      }
    }
    void restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn(countryCode: string, phoneNumber: string, password: string) {
    setError(null);
    try {
      const result = await apiLogin({ countryCode, phoneNumber, password });
      if (!supportedRoles.includes(result.user.role)) {
        setError(t("login.errorNotAdminSignIn"));
        return;
      }
      storeSession(result);
      // Permissions come from the API rather than being inferred from the role, so a role whose
      // permissions change later needs no client change.
      await loadCurrent();
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
    clearSession();
    setUser(null);
    setAccess(null);
  }

  async function refreshAccess() {
    try {
      await loadCurrent();
    } catch {
      // A failed refresh leaves the previous context in place; the next request will surface it.
    }
  }

  function can(permission: Permission): boolean {
    if (!access) return false;
    return access.isSuperAdmin || access.permissions.includes(permission);
  }

  return (
    <AuthContext.Provider value={{ user, access, isBooting, error, can, signIn, signOut, refreshAccess }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
