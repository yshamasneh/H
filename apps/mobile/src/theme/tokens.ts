import { I18nManager, Platform } from "react-native";

/**
 * The JOVO token layer — the mobile equivalent of apps/admin/src/styles.css.
 * Same brand palette, same semantic families, same 4px spacing scale. Nothing
 * outside this module (and theme/fonts.ts, theme/typography.ts) should name a
 * colour, a font size, or a duration directly.
 */

/* --- brand ---------------------------------------------------------------- */
/* Hover doesn't exist on touch; primaryHover is reused as the "raised" tone
   for things like a currently-armed toggle, primaryPressed is the actual
   press-down feedback colour. */
export const colors = {
  primary: "#F45A00",
  primaryHover: "#FF6A00",
  primaryPressed: "#D94A00",
  primarySubtle: "#FFF7F2",
  primaryBorder: "#FFD3B8",

  /* --- neutrals, warm-biased to keep the orange from reading cheap ------- */
  background: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceSunk: "#FAF8F7",
  surfaceInverse: "#171717",
  border: "#ECE6E2",
  borderStrong: "#D8D0CB",
  text: "#171717",
  textMuted: "#6B6B6B",
  textInverse: "#FFFFFF",

  /* --- semantic ------------------------------------------------------------ */
  success: "#0E7A3C",
  successSubtle: "#E6F5EC",
  warning: "#A55A00",
  warningSubtle: "#FDF1DF",
  error: "#C02626",
  errorSubtle: "#FDECEC",
  errorPressed: "#A81F1F",
  info: "#1F5FBF",
  infoSubtle: "#EAF1FC",
  neutral: "#6B6B6B",
  neutralSubtle: "#F2EFED"
} as const;

export type ColorToken = keyof typeof colors;

/* --- spacing (4px base) ---------------------------------------------------- */
export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 32,
  8: 40,
  9: 48,
  10: 64
} as const;

/* --- radius ------------------------------------------------------------- */
export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999
} as const;

/* --- elevation ------------------------------------------------------------ */
/* Deliberately shallow, matching admin: a hairline border does most of the
   work, shadow is a soft accent rather than the primary depth cue. */
export const shadow = {
  1: Platform.select({
    web: { boxShadow: "0 1px 2px rgba(23, 23, 23, 0.05)" } as const,
    default: {
      elevation: 1,
      shadowColor: "#171717",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2
    }
  }),
  2: Platform.select({
    web: { boxShadow: "0 1px 2px rgba(23, 23, 23, 0.04), 0 8px 20px -12px rgba(23, 23, 23, 0.16)" } as const,
    default: {
      elevation: 3,
      shadowColor: "#171717",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 10
    }
  }),
  3: Platform.select({
    web: { boxShadow: "0 12px 40px -12px rgba(23, 23, 23, 0.28)" } as const,
    default: {
      elevation: 8,
      shadowColor: "#171717",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.22,
      shadowRadius: 22
    }
  })
} as const;

/* --- motion ------------------------------------------------------------ */
export const motion = {
  durationFast: 120,
  durationBase: 180,
  durationSlow: 240,
  /* Matches admin's cubic-bezier(0.2, 0, 0.2, 1); consumed via Easing.bezier
     in Animated-based transitions (see theme/motion.ts). */
  easingPoints: [0.2, 0, 0.2, 1] as const
} as const;

/**
 * Five semantic families for status, matching apps/admin's StatusBadge exactly
 * so a driver and a dispatcher never disagree about what a colour means.
 * PLACED is the only "attention" (orange) status; everything already moving
 * is blue and recedes; done is green; wrong is red; dormant is grey.
 */
const attentionStatuses = new Set(["PLACED", "PENDING", "PENDING_ASSIGNMENT"]);
const inFlightStatuses = new Set([
  "ACCEPTED",
  "PREPARING",
  "PREPARING_SUPERMARKET",
  "READY_FOR_PICKUP",
  "ASSIGNED",
  "PICKED_UP",
  "ON_THE_WAY"
]);
const doneStatuses = new Set(["DELIVERED", "APPROVED", "ACTIVE", "ONLINE", "RECEIVED"]);
const failedStatuses = new Set(["REJECTED", "SUSPENDED", "CANCELLED", "DELIVERY_FAILED", "FAILED"]);

export type StatusFamily = "attention" | "inFlight" | "done" | "failed" | "neutral";

export function statusFamily(status: string): StatusFamily {
  if (attentionStatuses.has(status)) return "attention";
  if (inFlightStatuses.has(status)) return "inFlight";
  if (doneStatuses.has(status)) return "done";
  if (failedStatuses.has(status)) return "failed";
  return "neutral";
}

export const statusPalette: Record<StatusFamily, { background: string; foreground: string }> = {
  attention: { background: colors.primarySubtle, foreground: colors.primaryPressed },
  inFlight: { background: colors.infoSubtle, foreground: colors.info },
  done: { background: colors.successSubtle, foreground: colors.success },
  failed: { background: colors.errorSubtle, foreground: colors.error },
  neutral: { background: colors.neutralSubtle, foreground: colors.neutral }
};

/**
 * I18nManager.isRTL is reconciled with the chosen language before any screen
 * renders (see src/i18n/rtl.ts — a native language switch forces a reload
 * specifically so this is always true by the time JS evaluates). Reading it
 * here is therefore as reliable as admin's [dir="rtl"] CSS selector.
 */
export function isRTL(): boolean {
  return I18nManager.isRTL;
}
