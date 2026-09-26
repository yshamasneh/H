/**
 * The `tel:` link that opens the phone's own dialer with a real number. There is no in-app calling or
 * proxy number: the person taps, the OS dialer opens with the customer's actual number, and the call
 * happens outside JOVO. Only digits and a leading + are kept, so a stored number with spaces, dashes
 * or other characters can never turn into a different URL.
 */
export function telUrl(phone: string | null | undefined): string | null {
  const trimmed = phone?.trim();
  if (!trimmed) return null;
  const cleaned = `${trimmed.startsWith("+") ? "+" : ""}${trimmed.replace(/\D/g, "")}`;
  return /\d{5,}/.test(cleaned) ? `tel:${cleaned}` : null;
}
