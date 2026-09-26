/** Customer decoration only. No dates, offers, prices, or global palette changes. */
export const customerPresets = ["normal", "ramadan", "newYear"] as const;
export type CustomerPreset = typeof customerPresets[number];

export function isCustomerPreset(value: unknown): value is CustomerPreset {
  return customerPresets.some((preset) => preset === value);
}

export function resolveCustomerPreset(configured: unknown, preview: unknown, development: boolean): CustomerPreset {
  if (development && isCustomerPreset(preview)) return preview;
  return isCustomerPreset(configured) ? configured : "normal";
}

// Gold is dark enough for text on light surfaces, and warm/light on dark surfaces.
export const seasonalPalettes = {
  ramadan: {
    light: { background: "#F7F8FA", header: "#F5F6FA", accent: "#866019", soft: "#F4EDDD", border: "#DBD7CB", promo: "#192A43", onPromo: "#F5DDA8" },
    dark: { background: "#121720", header: "#192332", accent: "#E3C27B", soft: "#2C2930", border: "#393B43", promo: "#192A43", onPromo: "#F5DDA8" }
  },
  newYear: {
    light: { background: "#FBF9F4", header: "#FFFCF5", accent: "#805B16", soft: "#F7EED9", border: "#E2D8C1", promo: "#F7EED9", onPromo: "#674811" },
    dark: { background: "#191713", header: "#242019", accent: "#E9C97E", soft: "#342C1D", border: "#443A28", promo: "#342C1D", onPromo: "#E9C97E" }
  }
} as const;
