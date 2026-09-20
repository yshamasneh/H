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
// share earned, one failed delivery that took no cash. What is still held, and to be handed over, is
// 64.00 across two orders: not 43.00, and not 75.00.
const heldLine = (orderId: string, restaurantName: string, occurredAt: string) => ({
  orderId,
  restaurantName,
  deliveryLabel: "Home",
  outcome: "DELIVERED" as const,
  occurredAt,
  cashCollectedMinor: 3200,
  cashHandedOverMinor: 0,
  cashOwedToPlatformMinor: 3200,
  earningMinor: 700
});
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
    earningsOwedToDriverMinor: 2100,
    openOrders: [
      heldLine("cccccccc-3333-4333-8333-333333333333", "Al-Quds Market", "2026-09-19T09:00:00.000Z"),
      heldLine("aaaaaaaa-1111-4111-8111-111111111111", "JOVO MARKET", "2026-09-20T10:00:00.000Z")
    ],
    openOrdersTruncated: false
  },
  lines: [
    heldLine("aaaaaaaa-1111-4111-8111-111111111111", "JOVO MARKET", "2026-09-20T10:00:00.000Z"),
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

test("one number leads the screen: the cash to hand over, in words a driver cannot misread", async () => {
  await renderScreen();

  const owed = screen.getByLabelText("Owed to the platform");
  expect(owed).toHaveTextContent(/Hand this over to JOVO/);
  expect(owed).toHaveTextContent(/64\.00 ₪/);
  expect(screen.getByText("You are holding 64.00 ₪ in cash from customers. All of it goes to JOVO.")).toBeTruthy();
});

test("says plainly that the driver's earnings are not in that number and must not be taken out of the cash", async () => {
  await renderScreen();

  expect(screen.getByText(/Your earnings are not in this amount\. JOVO pays them to you separately/)).toBeTruthy();
  expect(screen.getByText(/do not take them out of the cash/)).toBeTruthy();
  // The number to hand over is not the cash minus the earnings.
  expect(screen.queryByText("43.00 ₪")).toBeNull();
  expect(screen.queryByText("75.00 ₪")).toBeNull();
});

test("lists the orders that add up to the amount to hand over, oldest first, with the total", async () => {
  await renderScreen();

  const owed = screen.getByLabelText("Owed to the platform");
  expect(owed).toHaveTextContent(/Al-Quds Market/);
  expect(owed).toHaveTextContent(/JOVO MARKET/);
  expect(screen.getByText(/2 orders not yet handed over/)).toBeTruthy();
  expect(screen.getByText("Total to hand over")).toBeTruthy();
});

test("cash collected and earnings stay in their own separate, labelled cards for the chosen period", async () => {
  await renderScreen();

  expect(screen.getByLabelText("Total cash collected")).toHaveTextContent(/96\.00 ₪/);
  expect(screen.getByLabelText("Your earnings")).toHaveTextContent(/21\.00 ₪/);
  expect(screen.getByText("Already handed over: 32.00 ₪")).toBeTruthy();
  expect(screen.getByText(/Still to be paid to you: 21\.00 ₪/)).toBeTruthy();
});

test("the amount to hand over does not change when another period is chosen", async () => {
  await renderScreen();
  mockGetSummary.mockResolvedValue({
    ...summary,
    period: "TODAY",
    cashCollectedMinor: 3200,
    earningsMinor: 700,
    // The period only changes what was collected in it; the standing balance is the same.
    balance: { ...summary.balance, cashOwedFromBeforePeriodMinor: 3200 }
  });

  await act(async () => {
    fireEvent.press(screen.getByText("Today"));
  });

  expect(mockGetSummary).toHaveBeenLastCalledWith("token", "TODAY");
  expect(screen.getByLabelText("Owed to the platform")).toHaveTextContent(/64\.00 ₪/);
  expect(screen.getByLabelText("Total cash collected")).toHaveTextContent(/32\.00 ₪/);
});

test("a driver holding no cash is told so, with nothing to hand over", async () => {
  mockGetSummary.mockResolvedValue({
    ...summary,
    balance: { ...summary.balance, cashOwedToPlatformMinor: 0, unsettledOrderCount: 0, oldestUnsettledAt: null, openOrders: [] }
  });
  await renderScreen();

  const owed = screen.getByLabelText("Owed to the platform");
  expect(owed).toHaveTextContent(/0\.00 ₪/);
  expect(screen.getByText("You are holding no customer cash. There is nothing to hand over.")).toBeTruthy();
  expect(screen.queryByText("Total to hand over")).toBeNull();
});

test("lists the period's orders below, a failed delivery earning without cash", async () => {
  await renderScreen();

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
