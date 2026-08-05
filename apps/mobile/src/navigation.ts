import type { AuthResult, OtpRequestResult, PublicUser, RestaurantSummary, SignupInput } from "./api";
import type { CountryCode } from "./phone";

export type PhonePrefill = { countryCode: CountryCode; phoneNumber: string };

export type AppScreen =
  | { name: "login"; prefill?: PhonePrefill; notice?: string }
  | { name: "signup"; prefill?: PhonePrefill }
  | { name: "forgot-password"; prefill?: PhonePrefill }
  | {
      name: "otp";
      purpose: "signup" | "password-reset";
      countryCode: CountryCode;
      phoneNumber: string;
      normalizedPhone: string;
      resendAvailableInSeconds: number;
      signupDraft?: SignupInput;
    }
  | { name: "new-password"; resetToken: string }
  | { name: "home"; user: PublicUser; notice?: string }
  | { name: "restaurants"; user: PublicUser }
  | { name: "restaurant-menu"; user: PublicUser; restaurantId: string; restaurantName: string };

export const initialScreen: AppScreen = { name: "login" };

export function goToSignup(prefill?: PhonePrefill): Extract<AppScreen, { name: "signup" }> {
  return { name: "signup", prefill };
}

export function goToLogin(prefill?: PhonePrefill, notice?: string): Extract<AppScreen, { name: "login" }> {
  return { name: "login", prefill, notice };
}

export function signupRequestToOtp(
  input: SignupInput,
  result: OtpRequestResult
): Extract<AppScreen, { name: "otp" }> {
  return {
    name: "otp",
    purpose: "signup",
    countryCode: input.countryCode,
    phoneNumber: input.phoneNumber,
    normalizedPhone: result.phone,
    resendAvailableInSeconds: result.resendAvailableInSeconds,
    signupDraft: input
  };
}

export function forgotRequestToOtp(
  input: PhonePrefill,
  result: OtpRequestResult
): Extract<AppScreen, { name: "otp" }> {
  return {
    name: "otp",
    purpose: "password-reset",
    countryCode: input.countryCode,
    phoneNumber: input.phoneNumber,
    normalizedPhone: result.phone,
    resendAvailableInSeconds: result.resendAvailableInSeconds
  };
}

export function accountNotFoundToSignup(
  prefill: PhonePrefill
): Extract<AppScreen, { name: "signup" }> {
  return goToSignup(prefill);
}

export function resetOtpToNewPassword(
  resetToken: string
): Extract<AppScreen, { name: "new-password" }> {
  return { name: "new-password", resetToken };
}

export function authResultToHome(result: AuthResult): Extract<AppScreen, { name: "home" }> {
  return { name: "home", user: result.user };
}

export function goToRestaurants(user: PublicUser): Extract<AppScreen, { name: "restaurants" }> {
  return { name: "restaurants", user };
}

export function goToRestaurantMenu(
  user: PublicUser,
  restaurant: Pick<RestaurantSummary, "id" | "name">
): Extract<AppScreen, { name: "restaurant-menu" }> {
  return { name: "restaurant-menu", user, restaurantId: restaurant.id, restaurantName: restaurant.name };
}

export function homeForUser(user: PublicUser): Extract<AppScreen, { name: "home" }> {
  return { name: "home", user };
}
