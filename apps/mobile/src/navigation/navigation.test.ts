import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountNotFoundToSignup,
  authResultToHome,
  forgotRequestToOtp,
  goToDriverSignup,
  goToRestaurantManagement,
  goToRestaurantMenu,
  goToRestaurantSignup,
  goToRestaurants,
  goToSupermarketCatalog,
  goToSupermarketProduct,
  goToSignup,
  homeForUser,
  resetOtpToNewPassword,
  signupRequestToOtp
} from "./navigation";

const prefill = { countryCode: "+970" as const, phoneNumber: "0591234567" };

test("login navigates to customer signup", () => {
  assert.equal(goToSignup().name, "signup");
});

test("signup request navigates to the signup OTP screen", () => {
  const screen = signupRequestToOtp(
    { ...prefill, fullName: "Customer", password: "Pass@123", confirmPassword: "Pass@123" },
    { phone: "+970591234567", expiresInSeconds: 300, resendAvailableInSeconds: 60, message: "ok" }
  );
  assert.equal(screen.name, "otp");
  assert.equal(screen.name === "otp" && screen.purpose, "signup");
});

test("existing-phone actions can navigate to login or forgot password", () => {
  assert.equal(goToSignup(prefill).prefill?.phoneNumber, "0591234567");
  assert.deepEqual({ name: "forgot-password", prefill }, { name: "forgot-password", prefill });
});

test("forgot password navigates to reset OTP", () => {
  const screen = forgotRequestToOtp(prefill, {
    phone: "+970591234567",
    expiresInSeconds: 300,
    resendAvailableInSeconds: 60,
    message: "ok"
  });
  assert.equal(screen.name === "otp" && screen.purpose, "password-reset");
});

test("account-not-found navigation prefills signup phone", () => {
  const screen = accountNotFoundToSignup(prefill);
  assert.equal(screen.name === "signup" && screen.prefill?.countryCode, "+970");
  assert.equal(screen.name === "signup" && screen.prefill?.phoneNumber, "0591234567");
});

test("verified reset OTP navigates to new password", () => {
  assert.deepEqual(resetOtpToNewPassword("reset-token"), {
    name: "new-password",
    resetToken: "reset-token"
  });
});

test("successful customer authentication navigates to Customer Home", () => {
  const screen = authResultToHome({
    accessToken: "access",
    refreshToken: "refresh",
    expiresInSeconds: 900,
    refreshExpiresInSeconds: 1000,
    user: { id: "1", fullName: "Customer", phone: "+970591234567", role: "CUSTOMER" }
  });
  assert.equal(screen.name, "home");
  assert.equal(screen.name === "home" && screen.user.role, "CUSTOMER");
});

test("login exposes restaurant and driver registration routes", () => {
  assert.deepEqual(goToRestaurantSignup(prefill), { name: "restaurant-signup", prefill });
  assert.deepEqual(goToDriverSignup(prefill), { name: "driver-signup", prefill });
});

test("successful admin authentication opens the in-app admin dashboard", () => {
  const screen = authResultToHome({
    accessToken: "access",
    refreshToken: "refresh",
    expiresInSeconds: 900,
    refreshExpiresInSeconds: 1000,
    user: { id: "admin", fullName: "Admin", phone: "+970590000001", role: "ADMIN" }
  });
  assert.equal(screen.name, "admin-dashboard");
});

const customer = { id: "1", fullName: "Customer", phone: "+970591234567", role: "CUSTOMER" as const };

test("browsing restaurants carries the current user", () => {
  const screen = goToRestaurants(customer);
  assert.equal(screen.name, "restaurants");
  assert.equal(screen.user.id, customer.id);
});

test("opening a restaurant navigates to its menu with the current user", () => {
  const screen = goToRestaurantMenu(customer, { id: "r1", name: "Falafel House" });
  assert.equal(screen.name, "restaurant-menu");
  assert.equal(screen.restaurantId, "r1");
  assert.equal(screen.restaurantName, "Falafel House");
  assert.equal(screen.user.id, customer.id);
});

test("leaving restaurant browsing returns to Home for the same user", () => {
  const screen = homeForUser(customer);
  assert.deepEqual(screen, { name: "home", user: customer });
});

test("customers can navigate through supermarket catalog and product details", () => {
  const catalog = goToSupermarketCatalog(customer, { id: "s1", name: "JOVO MARKET" });
  assert.equal(catalog.name, "supermarket-catalog");
  assert.equal(catalog.supermarketId, "s1");
  assert.equal(catalog.departmentId, undefined);
  const product = goToSupermarketProduct(customer, { id: "s1", name: "JOVO MARKET" }, "p1");
  assert.equal(product.name, "supermarket-product");
  assert.equal(product.productId, "p1");
});

test("the catalogue can be opened already filtered to one department", () => {
  const catalog = goToSupermarketCatalog(customer, { id: "s1", name: "JOVO MARKET" }, { departmentId: "d1" });
  assert.equal(catalog.departmentId, "d1");
  assert.equal(catalog.search, undefined);
});

test("the catalogue can be opened already carrying a search term", () => {
  const catalog = goToSupermarketCatalog(customer, { id: "s1", name: "JOVO MARKET" }, { search: "rice" });
  assert.equal(catalog.search, "rice");
  assert.equal(catalog.departmentId, undefined);
});

test("restaurant owners can navigate to profile and menu management", () => {
  const owner = { id: "owner", fullName: "Owner", phone: "+970591234568", role: "RESTAURANT" as const };
  assert.deepEqual(goToRestaurantManagement(owner), { name: "restaurant-management", user: owner });
});

test("an admin order opened from a customer's history goes back to that customer", async () => {
  const { adminOrderDetailBack, goToAdminCustomerDetail, goToAdminOrderDetail } = await import("./navigation");
  const admin = { id: "a1", fullName: "Admin", phone: "+970590000001", role: "ADMIN" as const };

  const fromCustomer = goToAdminOrderDetail(admin, "o1", "c1");
  assert.deepEqual(adminOrderDetailBack(fromCustomer), goToAdminCustomerDetail(admin, "c1"));

  const fromList = goToAdminOrderDetail(admin, "o1");
  assert.deepEqual(adminOrderDetailBack(fromList), { name: "admin-orders", user: admin });
  assert.ok(!("backToCustomerId" in fromList));
});

test("an order opened from a driver's cash handover goes back to that driver", async () => {
  const { adminOrderDetailBack, goToAdminDriverCashDetail, goToAdminOrderFromDriverCash } = await import("./navigation");
  const admin = { id: "a1", fullName: "Admin", phone: "+970590000001", role: "ADMIN" as const };
  assert.deepEqual(adminOrderDetailBack(goToAdminOrderFromDriverCash(admin, "o1", "d1")), goToAdminDriverCashDetail(admin, "d1"));
});

test("a product returns to wherever it was opened from, or the catalogue when opened directly", async () => {
  const { productBackTarget, goToSupermarketCatalog: catalogOf, goToSupermarketProduct: productOf, homeForUser: home } = await import("./navigation");
  const store = { id: "s1", name: "JOVO MARKET" };
  const dairyAisle = catalogOf(customer, store, { departmentId: "dairy", search: "milk" });
  assert.deepEqual(productBackTarget(productOf(customer, store, "p1", dairyAisle)), dairyAisle);
  assert.deepEqual(productBackTarget(productOf(customer, store, "p1", home(customer))), home(customer));
  assert.deepEqual(productBackTarget(productOf(customer, store, "p1")), catalogOf(customer, store));
});

test("the catalogue can be opened ready to type a search", () => {
  const catalog = goToSupermarketCatalog(customer, { id: "s1", name: "JOVO MARKET" }, { focusSearch: true });
  assert.equal(catalog.focusSearch, true);
  assert.equal("focusSearch" in goToSupermarketCatalog(customer, { id: "s1", name: "JOVO MARKET" }), false);
});
