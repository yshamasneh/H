import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { palettes, type ThemeColors } from "./tokens";

/**
 * App-wide light/dark theming.
 *
 * The active palette is exposed through {@link useTheme}; screens build their
 * StyleSheets from it (via a `createStyles(colors)` factory + `useMemo`) so a
 * toggle repaints them. This is a *manual* Light/Dark switch only — there is no
 * system/auto option — persisted locally and defaulting to Light.
 */
export type ThemeMode = "light" | "dark";

type ThemeContextValue = {
  mode: ThemeMode;
  colors: ThemeColors;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
};

const storageKey = "jovo-theme-mode";
const defaultMode: ThemeMode = "light";

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(defaultMode);

  // Restore the saved choice after mount. Until it resolves we render Light (the
  // default), so first paint is stable rather than flashing from an unknown mode.
  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(storageKey).then((stored) => {
      if (mounted && (stored === "light" || stored === "dark")) setModeState(stored);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const setMode = (next: ThemeMode) => {
      setModeState(next);
      void AsyncStorage.setItem(storageKey, next);
    };
    return {
      mode,
      colors: palettes[mode],
      isDark: mode === "dark",
      setMode,
      toggleTheme: () => setMode(mode === "dark" ? "light" : "dark")
    };
  }, [mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  // A component rendered outside the provider (e.g. an isolated UI test) still
  // gets a usable Light theme rather than throwing.
  if (!context) {
    return {
      mode: "light",
      colors: palettes.light,
      isDark: false,
      setMode: () => {},
      toggleTheme: () => {}
    };
  }
  return context;
}
