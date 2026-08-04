import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountNotFoundToSignup,
  authResultToHome,
  forgotRequestToOtp,
  goToSignup,
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
