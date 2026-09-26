/**
 * The `tel:` link that opens the device's own dialer with the customer's real number (admin console
 * twin of apps/mobile/src/core/tel.ts). There is no in-app calling or proxy number. Only digits and
 * a leading + are kept, so a stored number can never turn into a different URL.
 */
export function telHref(phone: string | null | undefined): string | null {
  const trimmed = phone?.trim();
  if (!trimmed) return null;
  const cleaned = `${trimmed.startsWith("+") ? "+" : ""}${trimmed.replace(/\D/g, "")}`;
  return /\d{5,}/.test(cleaned) ? `tel:${cleaned}` : null;
}
