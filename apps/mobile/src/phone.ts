import { parsePhoneNumberFromString } from "libphonenumber-js";

export const countryCodes = ["+970", "+972"] as const;
export type CountryCode = (typeof countryCodes)[number];

export class PhoneValidationError extends Error {
  constructor(message = "Please enter a valid phone number.") {
    super(message);
    this.name = "PhoneValidationError";
  }
}

export function normalizePhoneNumber(countryCode: CountryCode, phoneNumber: string): string {
  let compact = phoneNumber.trim().replace(/[\s().-]/g, "");
  if (!compact || /[A-Za-z]/.test(compact)) {
    throw new PhoneValidationError();
  }
  if (compact.startsWith("00")) {
    compact = `+${compact.slice(2)}`;
  }
  if (compact.startsWith("+")) {
    if (!compact.startsWith(countryCode)) {
      throw new PhoneValidationError(`The entered number does not match ${countryCode}.`);
    }
  } else {
    if (!/^\d+$/.test(compact)) throw new PhoneValidationError();
    const prefixDigits = countryCode.slice(1);
    if (compact.startsWith(prefixDigits)) compact = compact.slice(prefixDigits.length);
    if (compact.startsWith("0")) compact = compact.slice(1);
    compact = `${countryCode}${compact}`;
  }
  const parsed = parsePhoneNumberFromString(compact);
  if (!parsed || !parsed.isValid() || parsed.countryCallingCode !== countryCode.slice(1)) {
    throw new PhoneValidationError();
  }
  return parsed.number;
}

export function maskPhone(phone: string): string {
  if (phone.length < 8) return phone;
  return `${phone.slice(0, 5)}••••${phone.slice(-3)}`;
}

export function localNumberFromE164(phone: string, countryCode: CountryCode): string {
  return phone.startsWith(countryCode) ? `0${phone.slice(countryCode.length)}` : phone;
}
