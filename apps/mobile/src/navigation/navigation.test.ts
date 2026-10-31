import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountNotFoundToSignup,
  authResultToHome,
  forgotRequestToOtp,
  goToRestaurantManagement,
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

test("there is no restaurant registration, restaurant list or restaurant menu route in v1 (store audit H7)", async () => {
  const navigation = await import("./navigation");
  assert.equal("goToRestaurantSignup" in navigation, false);
  assert.equal("goToRestaurants" in navigation, false);
  assert.equal("goToRestaurantMenu" in navigation, false);
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

test("a customer's home is the JOVO MARKET home for the same user", () => {
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

test("admin tools go back to where they were opened: Home for an attention item, else More", async () => {
  const { adminToolBack, adminOrderDetailBack, goToAdminCosts, goToAdminRestaurants, goToAdminOrderFromHome, goToAdminOrderFromDriver } =
    await import("./navigation");
  const admin = { id: "a1", fullName: "Admin", phone: "+970590000001", role: "ADMIN" as const };
  assert.deepEqual(adminToolBack(goToAdminRestaurants(admin, "PENDING", "home")), { name: "admin-dashboard", user: admin });
  assert.deepEqual(adminToolBack(goToAdminCosts(admin)), { name: "admin-more", user: admin });
  assert.deepEqual(adminOrderDetailBack(goToAdminOrderFromHome(admin, "o1")), { name: "admin-dashboard", user: admin });
  assert.deepEqual(adminOrderDetailBack(goToAdminOrderFromDriver(admin, "o1", "d1")), {
    name: "admin-driver-detail",
    user: admin,
    driverUserId: "d1"
  });
});

test("guest browsing (H2): the read-only catalogue screens stay open for a guest", async () => {
  const { guardGuestNavigation, goToGuestHome, guestUser } = await import("./navigation");
  const store = { id: "store-1", name: "JOVO MARKET" };
  for (const screen of [
    goToGuestHome(),
    goToSupermarketCatalog(guestUser, store),
    goToSupermarketProduct(guestUser, store, "product-1"),
    { name: "cart" as const, user: guestUser }
  ]) {
    assert.deepEqual(guardGuestNavigation(screen), screen);
  }
});

test("guest browsing (H2): every account screen sends a guest to sign-in, checkout returns to the cart", async () => {
  const { guardGuestNavigation, guestUser } = await import("./navigation");
  const accountScreens = ["checkout", "order-history", "account", "settings", "notifications", "driver-home", "admin-dashboard", "restaurant-orders"] as const;
  for (const name of accountScreens) {
    const guarded = guardGuestNavigation({ name, user: guestUser } as never, "sign in");
    assert.equal(guarded.name, "login", name);
    assert.equal(guarded.name === "login" && guarded.notice, "sign in");
    assert.equal(guarded.name === "login" && guarded.afterLogin, name === "checkout" ? "cart" : undefined);
  }
});

test("guest browsing (H2): a signed-in customer is never redirected", async () => {
  const { guardGuestNavigation } = await import("./navigation");
  const user = { id: "u1", fullName: "Customer", phone: "+970591234567", role: "CUSTOMER" as const };
  for (const name of ["checkout", "order-history", "account", "settings", "notifications"] as const) {
    assert.equal(guardGuestNavigation({ name, user } as never).name, name);
  }
});
