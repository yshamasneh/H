import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "../../i18n";
import { DriverEarningsScreen } from "./earnings-screen";
import type { DriverCashSummary } from "../../core/api";

const mockGetSummary = jest.fn();
const mockGetHandovers = jest.fn();
jest.mock("../../core/api", () => ({
  getDriverCashSummary: (...args: unknown[]) => mockGetSummary(...args),
  getDriverCashHandovers: (...args: unknown[]) => mockGetHandovers(...args)
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
  mockGetHandovers.mockReset().mockResolvedValue({ truncated: false, periods: [] });
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

test("the main view shows only the current period: no calendar chips to bring a settled period back", async () => {
  await renderScreen();

  expect(mockGetSummary).toHaveBeenCalledWith("token", "SHIFT");
  expect(screen.getByText("Since your last handover")).toBeTruthy();
  for (const chip of ["Today", "This week", "This month", "All time"]) {
    expect(screen.queryByText(chip)).toBeNull();
  }
  expect(mockGetHandovers).not.toHaveBeenCalled();
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

test("opens on 'since last handover'; History offers the calendar periods and reloads for each", async () => {
  await renderScreen();
  expect(mockGetSummary).toHaveBeenCalledWith("token", "SHIFT");

  await act(async () => {
    fireEvent.press(screen.getByText("History"));
  });
  expect(mockGetSummary).toHaveBeenLastCalledWith("token", "MONTH");

  await act(async () => {
    fireEvent.press(screen.getByText("Today"));
  });
  expect(mockGetSummary).toHaveBeenLastCalledWith("token", "TODAY");
});

// What the API returns right after an admin records a full handover: the current period starts at
// the handover, so nothing is held, owed or earned in it yet. The settled figures are history.
const afterHandover: DriverCashSummary = {
  ...summary,
  lastHandoverAt: "2026-09-20T12:00:00.000Z",
  from: "2026-09-20T12:00:00.000Z",
  cashCollectedMinor: 0,
  cashHandedOverMinor: 0,
  earningsMinor: 0,
  deliveredCount: 0,
  failedCount: 0,
  lines: [],
  balance: {
    ...summary.balance,
    cashOwedToPlatformMinor: 0,
    unsettledOrderCount: 0,
    oldestUnsettledAt: null,
    openOrders: []
  }
};

test("after a handover the main view starts fresh: nothing held, nothing owed, nothing earned yet", async () => {
  mockGetSummary.mockResolvedValue(afterHandover);
  await renderScreen();

  expect(screen.getByLabelText("Owed to the platform")).toHaveTextContent(/0\.00 ₪/);
  expect(screen.getByLabelText("Total cash collected")).toHaveTextContent(/0\.00 ₪/);
  expect(screen.getByLabelText("Your earnings")).toHaveTextContent(/0\.00 ₪/);
  expect(screen.getByText("No deliveries in this period.")).toBeTruthy();
  expect(screen.queryByText("JOVO MARKET")).toBeNull();
});

test("the settled period is still there under History, with what was handed over and earned", async () => {
  mockGetSummary.mockResolvedValue(afterHandover);
  mockGetHandovers.mockResolvedValue({
    truncated: false,
    periods: [
      {
        settlementId: "settle-1",
        periodStart: null,
        settledAt: "2026-09-20T12:00:00.000Z",
        cashHandedOverMinor: 9600,
        expectedAmountMinor: 9600,
        countedAmountMinor: 9400,
        discrepancyMinor: -200,
        settledOrderCount: 3,
        earningsMinor: 2100,
        deliveredCount: 3
      }
    ]
  });
  await renderScreen();

  await act(async () => {
    fireEvent.press(screen.getByText("History"));
  });

  expect(mockGetHandovers).toHaveBeenCalledWith("token");
  expect(screen.getByText("Past handovers")).toBeTruthy();
  expect(screen.getByText("Cash handover · 3 orders")).toBeTruthy();
  expect(screen.getByText("96.00 ₪")).toBeTruthy();
  expect(screen.getByText("21.00 ₪")).toBeTruthy();
  expect(screen.getByText("Short by 2.00 ₪: 94.00 ₪ counted of 96.00 ₪")).toBeTruthy();
});

test("History says so plainly when nothing has been handed over yet", async () => {
  mockGetHandovers.mockResolvedValue({ truncated: false, periods: [] });
  await renderScreen();
  await act(async () => {
    fireEvent.press(screen.getByText("History"));
  });
  expect(screen.getByText(/No handover recorded yet\. Each period appears here/)).toBeTruthy();
});
