import type { AuthResult, DeliveryView, OrderDetail, OtpRequestResult, PublicUser, RestaurantSummary, SignupInput } from "./api";
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
  | { name: "restaurant-menu"; user: PublicUser; restaurantId: string; restaurantName: string }
  | { name: "cart"; user: PublicUser }
  | { name: "checkout"; user: PublicUser }
  | { name: "order-confirmation"; user: PublicUser; order: OrderDetail }
  | { name: "order-history"; user: PublicUser }
  | { name: "order-detail"; user: PublicUser; orderId: string }
  | { name: "restaurant-orders"; user: PublicUser }
  | { name: "restaurant-order-detail"; user: PublicUser; orderId: string }
  | { name: "driver-home"; user: PublicUser }
  | { name: "delivery-detail"; user: PublicUser; deliveryId: string }
  | { name: "notifications"; user: PublicUser };

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

export function goToCart(user: PublicUser): Extract<AppScreen, { name: "cart" }> {
  return { name: "cart", user };
}

export function goToCheckout(user: PublicUser): Extract<AppScreen, { name: "checkout" }> {
  return { name: "checkout", user };
}

export function orderToConfirmation(
  user: PublicUser,
  order: OrderDetail
): Extract<AppScreen, { name: "order-confirmation" }> {
  return { name: "order-confirmation", user, order };
}

export function goToOrderHistory(user: PublicUser): Extract<AppScreen, { name: "order-history" }> {
  return { name: "order-history", user };
}

export function goToOrderDetail(
  user: PublicUser,
  orderId: string
): Extract<AppScreen, { name: "order-detail" }> {
  return { name: "order-detail", user, orderId };
}

export function goToRestaurantOrders(user: PublicUser): Extract<AppScreen, { name: "restaurant-orders" }> {
  return { name: "restaurant-orders", user };
}

export function goToRestaurantOrderDetail(
  user: PublicUser,
  orderId: string
): Extract<AppScreen, { name: "restaurant-order-detail" }> {
  return { name: "restaurant-order-detail", user, orderId };
}

export function goToDriverHome(user: PublicUser): Extract<AppScreen, { name: "driver-home" }> {
  return { name: "driver-home", user };
}

export function goToDeliveryDetail(
  user: PublicUser,
  deliveryId: string
): Extract<AppScreen, { name: "delivery-detail" }> {
  return { name: "delivery-detail", user, deliveryId };
}

export function goToNotifications(user: PublicUser): Extract<AppScreen, { name: "notifications" }> {
  return { name: "notifications", user };
}

export function deliveryToDetail(
  user: PublicUser,
  delivery: Pick<DeliveryView, "id">
): Extract<AppScreen, { name: "delivery-detail" }> {
  return goToDeliveryDetail(user, delivery.id);
}
