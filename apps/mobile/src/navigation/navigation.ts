import type { AuthResult, DeliveryView, OrderDetail, OtpRequestResult, PublicUser, RestaurantOffer, RestaurantSummary, SignupInput } from "../core/api";
import type { CountryCode } from "../core/phone";

export type PhonePrefill = { countryCode: CountryCode; phoneNumber: string };

export type AppScreen =
  | { name: "login"; prefill?: PhonePrefill; notice?: string }
  | { name: "signup"; prefill?: PhonePrefill }
  | { name: "restaurant-signup"; prefill?: PhonePrefill }
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
  | {
      name: "supermarket-catalog";
      user: PublicUser;
      supermarketId: string;
      supermarketName: string;
      departmentId?: string;
      search?: string;
      /** Opened from a search box: the catalogue's search field takes focus straight away. */
      focusSearch?: boolean;
    }
  | {
      name: "supermarket-product";
      user: PublicUser;
      supermarketId: string;
      supermarketName: string;
      productId: string;
      /** Where Back leads: the screen the product was opened from (home, an offer, a filtered aisle). */
      returnTo?: AppScreen;
    }
  // The offer is carried whole (not just an id) the same way "order-confirmation" carries its
  // order: there is no GET-one-offer endpoint, and the caller (the offers list, a notification
  // payload, or a deep link resolver) already has the full record in hand.
  | { name: "offer-detail"; user: PublicUser; offer: RestaurantOffer }
  | { name: "cart"; user: PublicUser }
  | { name: "checkout"; user: PublicUser }
  | { name: "order-confirmation"; user: PublicUser; order: OrderDetail }
  | { name: "order-history"; user: PublicUser }
  | { name: "order-detail"; user: PublicUser; orderId: string }
  | { name: "account"; user: PublicUser }
  | { name: "settings"; user: PublicUser }
  | { name: "restaurant-orders"; user: PublicUser }
  | { name: "restaurant-management"; user: PublicUser; editItemId?: string }
  | { name: "restaurant-stats"; user: PublicUser }
  | { name: "restaurant-offers"; user: PublicUser }
  | { name: "restaurant-order-detail"; user: PublicUser; orderId: string }
  | { name: "driver-home"; user: PublicUser }
  | { name: "driver-stats"; user: PublicUser }
  | { name: "delivery-detail"; user: PublicUser; deliveryId: string }
  | { name: "notifications"; user: PublicUser }
  | { name: "admin-dashboard"; user: PublicUser }
  | { name: "admin-offers"; user: PublicUser }
  | { name: "admin-more"; user: PublicUser }
  // Tools live under More; opened from a Home attention item, Back returns Home instead.
  | { name: "admin-restaurants"; user: PublicUser; filter?: "PENDING"; from?: "home" }
  | { name: "admin-restaurant-detail"; user: PublicUser; restaurantId: string }
  | { name: "admin-orders"; user: PublicUser; filter?: "PLACED" }
  // Opened from a customer's order history, Back returns to that customer rather than the order list.
  | {
      name: "admin-order-detail";
      user: PublicUser;
      orderId: string;
      backToCustomerId?: string;
      backToDriverCashId?: string;
      backToDriverId?: string;
      backToHome?: boolean;
    }
  | { name: "admin-drivers"; user: PublicUser; filter?: "PENDING" }
  | { name: "admin-driver-detail"; user: PublicUser; driverUserId: string }
  | { name: "admin-driver-create"; user: PublicUser }
  | { name: "admin-users"; user: PublicUser }
  | { name: "admin-customer-detail"; user: PublicUser; userId: string }
  | { name: "admin-audit-log"; user: PublicUser }
  | { name: "admin-analytics"; user: PublicUser }
  | { name: "admin-driver-cash"; user: PublicUser; from?: "home" }
  | { name: "admin-driver-cash-detail"; user: PublicUser; driverUserId: string }
  | { name: "admin-costs"; user: PublicUser; from?: "home" }
  | { name: "admin-product-offers"; user: PublicUser };

export const initialScreen: AppScreen = { name: "login" };

export function goToSignup(prefill?: PhonePrefill): Extract<AppScreen, { name: "signup" }> {
  return { name: "signup", prefill };
}

export function goToRestaurantSignup(
  prefill?: PhonePrefill
): Extract<AppScreen, { name: "restaurant-signup" }> {
  return { name: "restaurant-signup", prefill };
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

export function authResultToHome(result: AuthResult): AppScreen {
  return homeForUser(result.user);
}

/**
 * Customer-facing restaurant browsing is deferred for the JOVO MARKET-only
 * launch: nothing in the customer flow calls this or `goToRestaurantMenu` any
 * more, and the home screen shows a "coming soon" card where restaurants used
 * to be. Both routes, their screens and the whole restaurant domain are kept
 * intact so re-enabling browsing is a matter of restoring the entry points —
 * and so the restaurant *business* side (orders, workspace, staff) is
 * completely untouched.
 */
export function goToRestaurants(user: PublicUser): Extract<AppScreen, { name: "restaurants" }> {
  return { name: "restaurants", user };
}

export function goToRestaurantMenu(
  user: PublicUser,
  restaurant: Pick<RestaurantSummary, "id" | "name">
): Extract<AppScreen, { name: "restaurant-menu" }> {
  return { name: "restaurant-menu", user, restaurantId: restaurant.id, restaurantName: restaurant.name };
}

export function homeForUser(user: PublicUser): AppScreen {
  if (user.role === "ADMIN") return { name: "admin-dashboard", user };
  if (user.role === "DRIVER") return { name: "driver-home", user };
  return { name: "home", user };
}

export function goToOfferDetail(
  user: PublicUser,
  offer: RestaurantOffer
): Extract<AppScreen, { name: "offer-detail" }> {
  return { name: "offer-detail", user, offer };
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

export function goToAccount(user: PublicUser): Extract<AppScreen, { name: "account" }> {
  return { name: "account", user };
}

export function goToSettings(user: PublicUser): Extract<AppScreen, { name: "settings" }> {
  return { name: "settings", user };
}

/**
 * There is no supermarket *list* screen any more: JOVO MARKET is the only
 * partner, so the customer goes straight to its catalogue. The store id is
 * still carried here because the cart and every catalogue call are keyed by
 * business id — see features/customer/market.ts for how it is resolved.
 */
export function goToSupermarketCatalog(
  user: PublicUser,
  supermarket: Pick<RestaurantSummary, "id" | "name">,
  filters: { departmentId?: string; search?: string; focusSearch?: boolean } = {}
): Extract<AppScreen, { name: "supermarket-catalog" }> {
  return {
    name: "supermarket-catalog",
    user,
    supermarketId: supermarket.id,
    supermarketName: supermarket.name,
    departmentId: filters.departmentId,
    search: filters.search,
    ...(filters.focusSearch ? { focusSearch: true } : {})
  };
}

export function goToSupermarketProduct(
  user: PublicUser,
  supermarket: Pick<RestaurantSummary, "id" | "name">,
  productId: string,
  returnTo?: AppScreen
): Extract<AppScreen, { name: "supermarket-product" }> {
  return {
    name: "supermarket-product",
    user,
    supermarketId: supermarket.id,
    supermarketName: supermarket.name,
    productId,
    ...(returnTo ? { returnTo } : {})
  };
}

/**
 * Where Back leads from a product: wherever it was opened from, or the store's catalogue when it
 * was opened directly (a notification, a deep link). A product opened from another product's
 * screen never chains: the origin is that product's own origin.
 */
export function productBackTarget(screen: Extract<AppScreen, { name: "supermarket-product" }>): AppScreen {
  if (screen.returnTo) return screen.returnTo;
  return goToSupermarketCatalog(screen.user, { id: screen.supermarketId, name: screen.supermarketName });
}

export function goToRestaurantManagement(
  user: PublicUser,
  editItemId?: string
): Extract<AppScreen, { name: "restaurant-management" }> {
  return { name: "restaurant-management", user, ...(editItemId !== undefined ? { editItemId } : {}) };
}

export function goToRestaurantStats(user: PublicUser): Extract<AppScreen, { name: "restaurant-stats" }> {
  return { name: "restaurant-stats", user };
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

export function goToDriverStats(user: PublicUser): Extract<AppScreen, { name: "driver-stats" }> {
  return { name: "driver-stats", user };
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

export function goToAdminDashboard(user: PublicUser): Extract<AppScreen, { name: "admin-dashboard" }> {
  return { name: "admin-dashboard", user };
}

export function goToAdminOffers(user: PublicUser): Extract<AppScreen, { name: "admin-offers" }> {
  return { name: "admin-offers", user };
}

export function goToAdminRestaurants(
  user: PublicUser,
  filter?: "PENDING",
  from?: "home"
): Extract<AppScreen, { name: "admin-restaurants" }> {
  return { name: "admin-restaurants", user, ...(filter ? { filter } : {}), ...(from ? { from } : {}) };
}

/** The More tab: every tool that is not a tab of its own, plus notifications, settings, sign-out. */
export function goToAdminMore(user: PublicUser): Extract<AppScreen, { name: "admin-more" }> {
  return { name: "admin-more", user };
}

/** Back from a tool: Home when it was opened from a Home attention item, else More where tools live. */
export function adminToolBack(screen: { user: PublicUser; from?: "home" }): Extract<AppScreen, { name: "admin-dashboard" | "admin-more" }> {
  return screen.from === "home" ? goToAdminDashboard(screen.user) : goToAdminMore(screen.user);
}

export function goToAdminDriverDetail(user: PublicUser, driverUserId: string): Extract<AppScreen, { name: "admin-driver-detail" }> {
  return { name: "admin-driver-detail", user, driverUserId };
}

export function goToAdminDriverCreate(user: PublicUser): Extract<AppScreen, { name: "admin-driver-create" }> {
  return { name: "admin-driver-create", user };
}

/** An order opened from Home's recent activity: Back returns Home. */
export function goToAdminOrderFromHome(user: PublicUser, orderId: string): Extract<AppScreen, { name: "admin-order-detail" }> {
  return { name: "admin-order-detail", user, orderId, backToHome: true };
}

/** An order opened from a driver's recent deliveries: Back returns to that driver. */
export function goToAdminOrderFromDriver(user: PublicUser, orderId: string, driverUserId: string): Extract<AppScreen, { name: "admin-order-detail" }> {
  return { name: "admin-order-detail", user, orderId, backToDriverId: driverUserId };
}

export function goToAdminRestaurantDetail(
  user: PublicUser,
  restaurantId: string
): Extract<AppScreen, { name: "admin-restaurant-detail" }> {
  return { name: "admin-restaurant-detail", user, restaurantId };
}

export function goToAdminOrders(user: PublicUser, filter?: "PLACED"): Extract<AppScreen, { name: "admin-orders" }> {
  return filter ? { name: "admin-orders", user, filter } : { name: "admin-orders", user };
}

export function goToAdminOrderDetail(
  user: PublicUser,
  orderId: string,
  backToCustomerId?: string
): Extract<AppScreen, { name: "admin-order-detail" }> {
  return backToCustomerId
    ? { name: "admin-order-detail", user, orderId, backToCustomerId }
    : { name: "admin-order-detail", user, orderId };
}

export function goToAdminDrivers(user: PublicUser, filter?: "PENDING"): Extract<AppScreen, { name: "admin-drivers" }> {
  return filter ? { name: "admin-drivers", user, filter } : { name: "admin-drivers", user };
}

export function goToAdminUsers(user: PublicUser): Extract<AppScreen, { name: "admin-users" }> {
  return { name: "admin-users", user };
}

export function goToAdminCustomerDetail(
  user: PublicUser,
  userId: string
): Extract<AppScreen, { name: "admin-customer-detail" }> {
  return { name: "admin-customer-detail", user, userId };
}

/** Where Back leads from an admin order: the customer or driver it was opened from, else the order list. */
export function adminOrderDetailBack(
  screen: Extract<AppScreen, { name: "admin-order-detail" }>
): Extract<
  AppScreen,
  { name: "admin-customer-detail" | "admin-driver-cash-detail" | "admin-driver-detail" | "admin-dashboard" | "admin-orders" }
> {
  if (screen.backToCustomerId) return goToAdminCustomerDetail(screen.user, screen.backToCustomerId);
  if (screen.backToDriverCashId) return goToAdminDriverCashDetail(screen.user, screen.backToDriverCashId);
  if (screen.backToDriverId) return goToAdminDriverDetail(screen.user, screen.backToDriverId);
  if (screen.backToHome) return goToAdminDashboard(screen.user);
  return goToAdminOrders(screen.user);
}

/** An order opened from a driver's cash handover: Back returns to that driver. */
export function goToAdminOrderFromDriverCash(
  user: PublicUser,
  orderId: string,
  driverUserId: string
): Extract<AppScreen, { name: "admin-order-detail" }> {
  return { name: "admin-order-detail", user, orderId, backToDriverCashId: driverUserId };
}

export function goToAdminAnalytics(user: PublicUser): Extract<AppScreen, { name: "admin-analytics" }> {
  return { name: "admin-analytics", user };
}

export function goToAdminDriverCash(user: PublicUser, from?: "home"): Extract<AppScreen, { name: "admin-driver-cash" }> {
  return from ? { name: "admin-driver-cash", user, from } : { name: "admin-driver-cash", user };
}

export function goToAdminDriverCashDetail(
  user: PublicUser,
  driverUserId: string
): Extract<AppScreen, { name: "admin-driver-cash-detail" }> {
  return { name: "admin-driver-cash-detail", user, driverUserId };
}

export function goToRestaurantOffers(user: PublicUser): Extract<AppScreen, { name: "restaurant-offers" }> {
  return { name: "restaurant-offers", user };
}

export function goToAdminProductOffers(user: PublicUser): Extract<AppScreen, { name: "admin-product-offers" }> {
  return { name: "admin-product-offers", user };
}

export function goToAdminCosts(user: PublicUser, from?: "home"): Extract<AppScreen, { name: "admin-costs" }> {
  return from ? { name: "admin-costs", user, from } : { name: "admin-costs", user };
}

export function goToAdminAuditLog(user: PublicUser): Extract<AppScreen, { name: "admin-audit-log" }> {
  return { name: "admin-audit-log", user };
}

export function deliveryToDetail(
  user: PublicUser,
  delivery: Pick<DeliveryView, "id">
): Extract<AppScreen, { name: "delivery-detail" }> {
  return goToDeliveryDetail(user, delivery.id);
}
