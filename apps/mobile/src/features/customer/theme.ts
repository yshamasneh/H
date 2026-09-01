import { useMemo } from "react";
import {
  colors as tokenColors,
  radius as tokenRadius,
  shadow as tokenShadow,
  type ThemeColors
} from "../../theme/tokens";
import { useTheme } from "../../theme/theme-context";

/**
 * A thin adapter over the shared JOVO tokens (src/theme/tokens.ts), kept so
 * the customer screens that already destructure `customerTheme.colors.*`
 * don't need call-site changes. Every value here is a reference into the
 * active palette, never a literal — this file carries no colour of its own.
 *
 * It is a *factory* of the active palette so customer screens repaint when the
 * light/dark theme toggles (see `useCustomerTheme`).
 *
 * Two names existed before the JOVO palette and don't map 1:1:
 * - `secondary` (previously a dark teal accent for prices) has no token
 *   equivalent, so it points at `text`. Price emphasis comes from weight, not
 *   colour, and this keeps it legible in both modes.
 * - `surfaceMuted` (a thumbnail/placeholder background) points at the neutral
 *   `surfaceSunk`.
 * - `inverseSurface` is the raised dark panel behind hero cards and headers.
 *   It stays dark in both modes (`surfaceInverse`), so the white-on-dark text
 *   layered over it reads the same whether the app is light or dark.
 */
export function createCustomerTheme(colors: ThemeColors) {
  return {
    colors: {
      background: colors.surfaceSunk,
      surface: colors.surface,
      surfaceMuted: colors.surfaceSunk,
      inverseSurface: colors.surfaceInverse,
      primary: colors.primary,
      primaryDark: colors.primaryPressed,
      primarySoft: colors.primarySubtle,
      secondary: colors.text,
      text: colors.text,
      textMuted: colors.textMuted,
      border: colors.border,
      success: colors.success,
      successSoft: colors.successSubtle,
      warning: colors.warning,
      danger: colors.error
    },
    radius: { small: tokenRadius.sm, medium: tokenRadius.md, large: tokenRadius.lg, pill: tokenRadius.pill },
    shadow: tokenShadow[2]
  };
}

export type CustomerTheme = ReturnType<typeof createCustomerTheme>;

/** The light adapter, for any call site not yet reading the active theme. */
export const customerTheme: CustomerTheme = createCustomerTheme(tokenColors);

/** The active customer theme — recomputed when the light/dark mode toggles. */
export function useCustomerTheme(): CustomerTheme {
  const { colors } = useTheme();
  return useMemo(() => createCustomerTheme(colors), [colors]);
}
