import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "../../i18n";
import { palettes } from "../../theme/tokens";
import { CustomerHomeHeader } from "./home-header";
import { customerPresets } from "./seasonal-theme";
import { createCustomerTheme } from "./theme";

test("header keeps the actual first name separate and notification action reachable", async () => {
  const open = jest.fn();
  render(<CustomerHomeHeader fullName="  Alexandra-Marguerite Example  " unreadCount={3} onOpenNotifications={open} />);
  await act(async () => {}); // Allow the icon font to finish loading.
  expect(screen.getByText(i18n.t("customer:home.welcome"))).toBeTruthy();
  expect(screen.getByLabelText("Alexandra-Marguerite")).toBeTruthy();
  expect(screen.queryByText(/Example/)).toBeNull();
  expect(screen.getByTestId("header-unread")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: i18n.t("common:notifications") }));
  expect(open).toHaveBeenCalledTimes(1);
});

test("empty names have a translated fallback; no unread dot for zero notifications", async () => {
  render(<CustomerHomeHeader fullName="  " unreadCount={0} onOpenNotifications={() => {}} />);
  await act(async () => {});
  expect(screen.getByText(i18n.t("customer:home.defaultFirstName"))).toBeTruthy();
  expect(screen.queryByTestId("header-unread")).toBeNull();
});

test("seasonal adapters preserve text, commerce colors and the global palettes in both modes", () => {
  for (const mode of ["light", "dark"] as const) {
    const original = { ...palettes[mode] };
    for (const preset of customerPresets) {
      const theme = createCustomerTheme(palettes[mode], preset, mode);
      expect(theme.colors.primary).toBe(original.primary);
      expect(theme.colors.text).toBe(original.text);
      expect(theme.colors.surface).toBe(original.surface);
      expect(theme.colors.danger).toBe(original.error);
    }
    expect(palettes[mode]).toEqual(original);
  }
});
