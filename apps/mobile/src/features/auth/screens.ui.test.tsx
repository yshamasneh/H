import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "../../i18n";
import { LoginScreen } from "./screens";

/**
 * screens.tsx used to define its own local readError() that just returned error.message with no
 * translation lookup at all — a same-named function that silently shadowed the real, centralized
 * readError() (apps/mobile/src/core/errors.ts) that every other screen already used correctly.
 * This pins the fix: a raw, technical ApiError message from the server must never reach the UI —
 * the user always sees the translated `errors:<code>` copy instead.
 */
jest.mock("../../core/api", () => ({
  apiBaseUrl: "http://localhost:3000",
  login: jest.fn(),
  requestSignupCode: jest.fn(),
  requestPasswordResetCode: jest.fn(),
  resetPassword: jest.fn(),
  verifySignupCode: jest.fn(),
  verifyPasswordResetCode: jest.fn(),
  listMyNotifications: jest.fn(),
  ApiError: class ApiError extends Error {
    statusCode: number;
    code: string;
    details: unknown;
    constructor(statusCode: number, code: string, message: string, details: unknown = null) {
      super(message);
      this.name = "ApiError";
      this.statusCode = statusCode;
      this.code = code;
      this.details = details;
    }
  }
}));
jest.mock("../../core/session", () => ({ getAccessToken: jest.fn() }));
jest.mock("../../core/socket", () => ({ useRealtimeEvent: () => {} }));

const { login, ApiError } = jest.requireMock("../../core/api") as {
  login: jest.Mock;
  ApiError: new (statusCode: number, code: string, message: string, details?: unknown) => Error;
};

function renderLogin() {
  return render(
    <LoginScreen
      onAuthenticated={jest.fn()}
      onSignup={jest.fn()}
      onRestaurantSignup={jest.fn()}
      onDriverSignup={jest.fn()}
      onForgotPassword={jest.fn()}
    />
  );
}

test("a raw/technical API error is shown translated, not as the server's own message", async () => {
  // A deliberately raw, technical message — the kind a server logs for itself, not copy a
  // customer should ever see. If screens.tsx's local readError() regresses back in, this exact
  // string is what would show up on screen instead of the translated one asserted below.
  const rawTechnicalMessage = "invalid_grant: credential check failed (trace=0x4F2C)";
  login.mockRejectedValueOnce(new ApiError(401, "INVALID_CREDENTIALS", rawTechnicalMessage));

  renderLogin();
  const passwordInput = screen.UNSAFE_getByProps({ secureTextEntry: true });
  fireEvent.changeText(passwordInput, "Whatever@123");
  await act(async () => {
    fireEvent.press(screen.getByText(i18n.t("auth:login.submit")));
  });

  expect(screen.getByText(i18n.t("errors:INVALID_CREDENTIALS"))).toBeTruthy();
  expect(screen.queryByText(rawTechnicalMessage)).toBeNull();
});

test("a code with no catalogued translation falls back to the server's own message, not a dead end", async () => {
  const serverMessage = "This specific edge case has no translated copy yet.";
  login.mockRejectedValueOnce(new ApiError(400, "SOME_FUTURE_CODE_NOT_YET_TRANSLATED", serverMessage));

  renderLogin();
  const passwordInput = screen.UNSAFE_getByProps({ secureTextEntry: true });
  fireEvent.changeText(passwordInput, "Whatever@123");
  await act(async () => {
    fireEvent.press(screen.getByText(i18n.t("auth:login.submit")));
  });

  expect(screen.getByText(serverMessage)).toBeTruthy();
});
