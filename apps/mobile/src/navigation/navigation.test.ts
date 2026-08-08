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
  goToSupermarkets,
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
  assert.deepEqual(goToSupermarkets(customer), { name: "supermarkets", user: customer });
  const catalog = goToSupermarketCatalog(customer, { id: "s1", name: "Fresh Market" });
  assert.equal(catalog.name, "supermarket-catalog");
  assert.equal(catalog.supermarketId, "s1");
  const product = goToSupermarketProduct(customer, { id: "s1", name: "Fresh Market" }, "p1");
  assert.equal(product.name, "supermarket-product");
  assert.equal(product.productId, "p1");
});

test("restaurant owners can navigate to profile and menu management", () => {
  const owner = { id: "owner", fullName: "Owner", phone: "+970591234568", role: "RESTAURANT" as const };
  assert.deepEqual(goToRestaurantManagement(owner), { name: "restaurant-management", user: owner });
});
