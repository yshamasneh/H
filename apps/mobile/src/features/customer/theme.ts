import { colors as tokenColors, radius as tokenRadius, shadow as tokenShadow } from "../../theme/tokens";

/**
 * A thin adapter over the shared JOVO tokens (src/theme/tokens.ts), kept so
 * the customer screens that already destructure `customerTheme.colors.*`
 * don't need call-site changes. Every value here is a reference into the
 * token module, never a literal — this file carries no colour of its own.
 *
 * Two names existed before the JOVO palette and don't map 1:1:
 * - `secondary` (previously a dark teal accent for prices) has no token
 *   equivalent — JOVO has no secondary brand hue, only orange plus neutral
 *   text — so it now points at `text`. Price emphasis comes from weight, not
 *   colour.
 * - `surfaceMuted` (a thumbnail/placeholder background) now points at the
 *   neutral `surfaceSunk` rather than an orange-tinted surface, since orange
 *   is deliberately scarce and a placeholder box is not a call to action.
 */
export const customerTheme = {
  colors: {
    background: tokenColors.surfaceSunk,
    surface: tokenColors.surface,
    surfaceMuted: tokenColors.surfaceSunk,
    primary: tokenColors.primary,
    primaryDark: tokenColors.primaryPressed,
    primarySoft: tokenColors.primarySubtle,
    secondary: tokenColors.text,
    text: tokenColors.text,
    textMuted: tokenColors.textMuted,
    border: tokenColors.border,
    success: tokenColors.success,
    successSoft: tokenColors.successSubtle,
    warning: tokenColors.warning,
    danger: tokenColors.error
  },
  radius: { small: tokenRadius.sm, medium: tokenRadius.md, large: tokenRadius.lg, pill: tokenRadius.pill },
  shadow: tokenShadow[2]
} as const;
