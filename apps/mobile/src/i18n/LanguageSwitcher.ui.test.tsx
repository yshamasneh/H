import { render, screen, act, fireEvent, waitFor } from "@testing-library/react-native";
import i18n from "../i18n";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { reconcileRTL, reloadApp } from "./rtl";

// Keep the language switch from persisting to SecureStore during these tests.
jest.mock("../core/language", () => ({
  supportedLanguages: ["ar", "en"],
  getStoredLanguage: jest.fn().mockResolvedValue(null),
  setStoredLanguage: jest.fn().mockResolvedValue(undefined)
}));

// Mock the RTL module so we control the reload outcome (and avoid loading the native
// expo-updates module in the render environment).
jest.mock("./rtl", () => ({
  reconcileRTL: jest.fn().mockReturnValue(false),
  reloadApp: jest.fn().mockResolvedValue(true)
}));

async function setLanguage(language: "ar" | "en") {
  await act(async () => {
    await i18n.changeLanguage(language);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (reconcileRTL as jest.Mock).mockReturnValue(false);
  (reloadApp as jest.Mock).mockResolvedValue(true);
});

test("renders both language options in the default (Arabic / RTL) state", async () => {
  await setLanguage("ar");
  render(<LanguageSwitcher />);
  // Both choices are always offered, regardless of the active language.
  expect(screen.getByText("العربية")).toBeTruthy();
  expect(screen.getByText("English")).toBeTruthy();
});

test("renders without crashing after switching to English (LTR)", async () => {
  await setLanguage("en");
  const { toJSON } = render(<LanguageSwitcher />);
  expect(screen.getByText("English")).toBeTruthy();
  expect(screen.getByText("العربية")).toBeTruthy();
  expect(toJSON()).toBeTruthy();
});

test("switching to a different-direction language triggers the reload path", async () => {
  await setLanguage("ar");
  (reconcileRTL as jest.Mock).mockReturnValue(true); // direction changed → reload needed
  render(<LanguageSwitcher />);

  await act(async () => {
    fireEvent.press(screen.getByText("English"));
  });

  expect(reconcileRTL).toHaveBeenCalledWith("en");
  // reload is scheduled behind a short paint delay.
  await waitFor(() => expect(reloadApp).toHaveBeenCalledTimes(1));
});

test("when the reload API is unavailable, the manual-restart message is shown (no silent no-op)", async () => {
  await setLanguage("ar");
  (reconcileRTL as jest.Mock).mockReturnValue(true);
  (reloadApp as jest.Mock).mockResolvedValue(false); // e.g. a build without expo-updates
  render(<LanguageSwitcher />);

  await act(async () => {
    fireEvent.press(screen.getByText("English"));
  });

  await waitFor(() => expect(screen.getByText(i18n.t("common:restartRequiredBody"))).toBeTruthy());
});

// Restore Arabic (the app default) so this file doesn't leak state into other suites.
afterAll(async () => {
  await setLanguage("ar");
});
