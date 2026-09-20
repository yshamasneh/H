import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "../../i18n";
import { DriverEarningsScreen } from "./earnings-screen";
import type { DriverCashSummary } from "../../core/api";

const mockGetSummary = jest.fn();
jest.mock("../../core/api", () => ({
  getDriverCashSummary: (...args: unknown[]) => mockGetSummary(...args)
}));
jest.mock("../../core/session", () => ({ getAccessToken: jest.fn().mockResolvedValue("token") }));

// Three orders' worth of cash (96.00) of which 32.00 has been handed back, 21.00 of delivery-fee
// share earned, one failed delivery that took no cash. What is still owed is 64.00: not 43.00.
const summary: DriverCashSummary = {
  period: "SHIFT",
  from: null,
  to: "2026-09-20T12:00:00.000Z",
  lastHandoverAt: null,
  cashCollectedMinor: 9600,
  cashHandedOverMinor: 3200,
  earningsMinor: 2100,
  deliveredCount: 3,
  failedCount: 1,
  balance: {
    cashOwedToPlatformMinor: 6400,
    unsettledOrderCount: 2,
    oldestUnsettledAt: "2026-09-19T09:00:00.000Z",
    cashOwedFromBeforePeriodMinor: 0,
    earningsOwedToDriverMinor: 2100
  },
  lines: [
    {
      orderId: "aaaaaaaa-1111-4111-8111-111111111111",
      restaurantName: "JOVO MARKET",
      deliveryLabel: "Home",
      outcome: "DELIVERED",
      occurredAt: "2026-09-20T10:00:00.000Z",
      cashCollectedMinor: 3200,
      cashHandedOverMinor: 0,
      cashOwedToPlatformMinor: 3200,
      earningMinor: 700
    },
    {
      orderId: "bbbbbbbb-2222-4222-8222-222222222222",
      restaurantName: "Falafel House",
      deliveryLabel: "Office",
      outcome: "DELIVERY_FAILED",
      occurredAt: "2026-09-20T11:00:00.000Z",
      cashCollectedMinor: 0,
      cashHandedOverMinor: 0,
      cashOwedToPlatformMinor: 0,
      earningMinor: 700
    }
  ],
  linesTruncated: false
};

beforeAll(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

beforeEach(() => {
  mockGetSummary.mockReset().mockResolvedValue(summary);
});

async function renderScreen() {
  render(<DriverEarningsScreen onBack={() => undefined} />);
  await screen.findByText("Total cash collected");
}

test("shows three separate, labelled figures: cash collected, earnings, and cash owed to the platform", async () => {
  await renderScreen();

  const collected = screen.getByLabelText("Total cash collected");
  const earned = screen.getByLabelText("Your earnings");
  const owed = screen.getByLabelText("Owed to the platform");

  expect(collected).toHaveTextContent(/96.00 ₪/);
  expect(earned).toHaveTextContent(/21.00 ₪/);
  expect(owed).toHaveTextContent(/64.00 ₪/);
  // The owed figure is not the cash minus the earnings (96.00 - 21.00, or 64.00 - 21.00): the handover is gross.
  expect(screen.queryByText("43.00 ₪")).toBeNull();
  expect(screen.queryByText("75.00 ₪")).toBeNull();
});

test("says plainly that earnings are paid separately and are not taken off what is handed over", async () => {
  await renderScreen();

  expect(screen.getByText(/paid separately|pays this to you separately/i)).toBeTruthy();
  expect(screen.getByText(/nothing taken off for your earnings/i)).toBeTruthy();
});

test("shows what has already been handed over and how many orders are still unsettled", async () => {
  await renderScreen();

  expect(screen.getByText("Already handed over: 32.00 ₪")).toBeTruthy();
  expect(screen.getByText("2 orders not yet handed over")).toBeTruthy();
});

test("lists the orders behind the totals, a failed delivery earning without cash", async () => {
  await renderScreen();

  expect(screen.getByText("JOVO MARKET")).toBeTruthy();
  expect(screen.getByText("Falafel House")).toBeTruthy();
  expect(screen.getByText("Failed")).toBeTruthy();
  expect(screen.getByText("No cash taken")).toBeTruthy();
});

test("opens on 'since last handover' and reloads for another period when one is chosen", async () => {
  await renderScreen();
  expect(mockGetSummary).toHaveBeenCalledWith("token", "SHIFT");

  await act(async () => {
    fireEvent.press(screen.getByText("Today"));
  });

  expect(mockGetSummary).toHaveBeenLastCalledWith("token", "TODAY");
});

test("warns when part of what is owed comes from before the chosen period", async () => {
  mockGetSummary.mockResolvedValue({
    ...summary,
    balance: { ...summary.balance, cashOwedFromBeforePeriodMinor: 3200 }
  });
  await renderScreen();

  expect(screen.getByText("Includes 32.00 ₪ from before this period.")).toBeTruthy();
});
