import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Alert } from "react-native";
import i18n from "../../i18n";
import { SettingsScreen } from "./settings-screen";

// Store audit B2 / B3 / H1: every role reaches the legal pages from Settings, customers, drivers and
// store staff can delete their account, and a driver's blocked deletion shows its date instead of
// signing them out.

jest.mock("../../core/api", () => ({
  deleteMyAccount: jest.fn(),
  getMyDeletionRequest: jest.fn().mockResolvedValue({ status: "NONE" }),
  registerMyPushToken: jest.fn(),
  unregisterMyPushToken: jest.fn()
}));
jest.mock("../../core/session", () => ({ getAccessToken: jest.fn().mockResolvedValue("token") }));
jest.mock("../../core/push-notifications", () => ({
  clearStoredPushToken: jest.fn().mockResolvedValue(undefined),
  getPushToken: jest.fn(),
  getStoredPushToken: jest.fn().mockResolvedValue(null),
  getStoredPushTokenOwner: jest.fn().mockResolvedValue(null),
  storePushToken: jest.fn()
}));

const api = jest.requireMock("../../core/api") as { deleteMyAccount: jest.Mock; getMyDeletionRequest: jest.Mock };

function user(role: "CUSTOMER" | "DRIVER" | "RESTAURANT" | "ADMIN") {
  return { id: `u-${role}`, fullName: "Test Person", phone: "+970590000000", role };
}

function renderSettings(role: "CUSTOMER" | "DRIVER" | "RESTAURANT" | "ADMIN", onDeleted?: jest.Mock) {
  const onLogout = jest.fn().mockResolvedValue(undefined);
  render(
    <SettingsScreen
      onBack={jest.fn()}
      onDeleted={role === "ADMIN" ? undefined : onDeleted ?? jest.fn().mockResolvedValue(undefined)}
      onLogout={onLogout}
      user={user(role)}
    />
  );
  return { onLogout };
}

function confirmNextAlert() {
  return jest.spyOn(Alert, "alert").mockImplementation((_title, _body, buttons) => {
    const destructive = buttons?.find((button) => button.style === "destructive");
    destructive?.onPress?.();
  });
}

beforeEach(() => {
  api.deleteMyAccount.mockReset();
  api.getMyDeletionRequest.mockResolvedValue({ status: "NONE" });
});

afterEach(() => jest.restoreAllMocks());

test.each(["CUSTOMER", "DRIVER", "RESTAURANT", "ADMIN"] as const)("%s settings link to the privacy policy, terms, support and web deletion", async (role) => {
  const { Linking } = require("react-native");
  const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  renderSettings(role);
  await act(async () => {
    fireEvent.press(screen.getByText(i18n.t("common:legal.privacyPolicy")));
  });
  expect(openURL).toHaveBeenCalledWith("https://jovops.com/privacy");
  expect(screen.getByText(i18n.t("common:legal.terms"))).toBeTruthy();
  expect(screen.getByText(i18n.t("common:legal.support"))).toBeTruthy();
  expect(screen.getByText(i18n.t("common:legal.deleteOnWeb"))).toBeTruthy();
});

test.each(["CUSTOMER", "DRIVER", "RESTAURANT"] as const)("%s can delete their account in the app", async (role) => {
  api.deleteMyAccount.mockResolvedValue({ status: "DELETED" });
  const onDeleted = jest.fn().mockResolvedValue(undefined);
  confirmNextAlert();
  renderSettings(role, onDeleted);
  await act(async () => {
    fireEvent.press(screen.getByText(i18n.t("customer:account.deleteAccountButton")));
  });
  expect(api.deleteMyAccount).toHaveBeenCalledWith("token");
  expect(onDeleted).toHaveBeenCalledTimes(1);
});

test("a driver whose deletion is scheduled sees the date and stays signed in", async () => {
  api.deleteMyAccount.mockResolvedValue({ status: "SCHEDULED", scheduledFor: "2026-12-01T10:00:00.000Z", blockers: ["ACTIVE_DELIVERY"] });
  const onDeleted = jest.fn().mockResolvedValue(undefined);
  const alert = confirmNextAlert();
  renderSettings("DRIVER", onDeleted);
  await act(async () => {
    fireEvent.press(screen.getByText(i18n.t("customer:account.deleteAccountButton")));
  });
  expect(onDeleted).not.toHaveBeenCalled();
  expect(screen.getByTestId("deletion-scheduled")).toBeTruthy();
  expect(alert).toHaveBeenLastCalledWith(i18n.t("customer:account.deleteScheduledTitle"), expect.any(String));
  // Drivers sign out from Settings; the button is still there.
  expect(screen.getByText(i18n.t("customer:settings.logoutButton"))).toBeTruthy();
});

test("the confirmation never says the account is only deactivated", () => {
  for (const language of ["en", "ar"]) {
    const copy = i18n.getFixedT(language, "customer")("account.deleteAccountConfirm");
    expect(copy).not.toMatch(/deactivat|تعطيل/i);
  }
});

test("administrators see how their account is closed instead of a delete button", () => {
  renderSettings("ADMIN");
  expect(screen.queryByText(i18n.t("customer:account.deleteAccountButton"))).toBeNull();
  expect(screen.getByText(i18n.t("customer:account.deleteAdminNote"))).toBeTruthy();
  expect(screen.getByText(i18n.t("customer:settings.logoutButton"))).toBeTruthy();
});
