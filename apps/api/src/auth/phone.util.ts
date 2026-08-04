import { parsePhoneNumberFromString } from "libphonenumber-js";
import { ApiException } from "../common/api.exception";
import { supportedCountryCodes, type SupportedCountryCode } from "./auth.dto";

export function normalizePhoneNumber(countryCode: string, phoneNumber: string): string {
  if (!supportedCountryCodes.includes(countryCode as SupportedCountryCode)) {
    throw new ApiException(
      400,
      "UNSUPPORTED_COUNTRY_CODE",
      "Only +970 and +972 phone numbers are supported."
    );
  }

  const raw = typeof phoneNumber === "string" ? phoneNumber.trim() : "";
  if (!raw || /[A-Za-z]/.test(raw)) {
    throw invalidPhone();
  }

  let compact = raw.replace(/[\s().-]/g, "");
  if (compact.startsWith("00")) {
    compact = `+${compact.slice(2)}`;
  }

  let candidate: string;
  if (compact.startsWith("+")) {
    if (!compact.startsWith(countryCode)) {
      throw new ApiException(
        400,
        "UNSUPPORTED_COUNTRY_CODE",
        `The entered number does not match the selected ${countryCode} country code.`
      );
    }
    candidate = compact;
  } else {
    if (!/^\d+$/.test(compact)) {
      throw invalidPhone();
    }
    const countryDigits = countryCode.slice(1);
    if (compact.startsWith(countryDigits)) {
      compact = compact.slice(countryDigits.length);
    }
    if (compact.startsWith("0")) {
      compact = compact.slice(1);
    }
    candidate = `${countryCode}${compact}`;
  }

  const parsed = parsePhoneNumberFromString(candidate);
  if (
    !parsed ||
    !parsed.isValid() ||
    parsed.countryCallingCode !== countryCode.slice(1) ||
    !supportedCountryCodes.some((prefix) => parsed.number.startsWith(prefix))
  ) {
    throw invalidPhone();
  }

  return parsed.number;
}

export function splitE164Phone(phone: string): { countryCode: SupportedCountryCode; phoneNumber: string } {
  const countryCode = supportedCountryCodes.find((prefix) => phone.startsWith(prefix));
  if (!countryCode) {
    throw invalidPhone();
  }
  return { countryCode, phoneNumber: phone.slice(countryCode.length) };
}

function invalidPhone(): ApiException {
  return new ApiException(400, "INVALID_PHONE_NUMBER", "Please enter a valid phone number.");
}
