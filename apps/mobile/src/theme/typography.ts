import type { TextStyle } from "react-native";
import { isRTL } from "./tokens";

/**
 * The mobile equivalent of admin's [dir="rtl"] type-scale override: Arabic
 * gets more leading (room for ascenders/descenders/diacritics), zero tracking
 * (tracking breaks Arabic letter joins), a small optical size bump (Arabic has
 * no cap height and reads smaller than Latin at an identical nominal size),
 * and no uppercase transform (Arabic has no letter case).
 */

export type FontRole = "display" | "h1" | "h2" | "h3" | "body" | "bodySm" | "caption" | "label";
export type FontWeight = "regular" | "medium" | "semibold" | "bold" | "heavy";

const fontSizeLTR: Record<FontRole, number> = {
  display: 30,
  h1: 24,
  h2: 20,
  h3: 16,
  body: 15,
  bodySm: 14,
  caption: 13,
  label: 11.5
};

const fontSizeRTL: Record<FontRole, number> = {
  ...fontSizeLTR,
  body: 16,
  bodySm: 15,
  caption: 13.5,
  label: 12
};

const headingLeading = { ltr: 1.2, rtl: 1.45 };
const bodyLeading = { ltr: 1.55, rtl: 1.85 };
const headingRoles = new Set<FontRole>(["display", "h1", "h2", "h3"]);

/* Static font instances only exist at 400/600/700 (see theme/fonts.ts), so
   "semibold" (web weight 680) and "heavy" (750) bucket onto the nearest
   instance rather than a distinct file — visually indistinguishable at
   mobile sizes and it keeps the font bundle to six files. */
const fontFileWeight: Record<FontWeight, "Regular" | "SemiBold" | "Bold"> = {
  regular: "Regular",
  medium: "SemiBold",
  semibold: "SemiBold",
  bold: "Bold",
  heavy: "Bold"
};

export function fontFamily(weight: FontWeight): string {
  const family = isRTL() ? "Cairo" : "Inter";
  return `${family}-${fontFileWeight[weight]}`;
}

/**
 * A ready-to-spread TextStyle for one role at one weight, corrected for the
 * current writing direction. This is the only place fontSize/lineHeight/
 * letterSpacing should be computed — screens consume `text(role, weight)`,
 * never a bare number.
 */
export function text(role: FontRole, weight: FontWeight = "regular"): TextStyle {
  const rtl = isRTL();
  const fontSize = (rtl ? fontSizeRTL : fontSizeLTR)[role];
  const leadingMultiplier = headingRoles.has(role)
    ? (rtl ? headingLeading.rtl : headingLeading.ltr)
    : (rtl ? bodyLeading.rtl : bodyLeading.ltr);

  let letterSpacing = 0;
  if (!rtl) {
    if (role === "display" || role === "h1" || role === "h2" || role === "h3") letterSpacing = fontSize * -0.015;
    if (role === "label") letterSpacing = fontSize * 0.08;
  }

  return {
    fontFamily: fontFamily(weight),
    fontSize,
    lineHeight: Math.round(fontSize * leadingMultiplier),
    letterSpacing,
    textTransform: role === "label" && !rtl ? "uppercase" : "none",
    writingDirection: rtl ? "rtl" : "ltr"
  };
}
