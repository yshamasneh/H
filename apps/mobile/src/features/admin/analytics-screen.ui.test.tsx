import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import i18n from "../../i18n";
import * as api from "../../core/api";
import { AdminAnalyticsScreen } from "./analytics-screen";

jest.mock("../../core/api", () => ({
  fetchAdminAccess: jest.fn(),
  getAdminTopProducts: jest.fn(),
  getAdminPeakTimes: jest.fn(),
  getAdminCustomerRetention: jest.fn(),
  ApiError: class ApiError extends Error {}
}));
jest.mock("../../core/session", () => ({ getAccessToken: jest.fn().mockResolvedValue("token") }));

const mocked = api as jest.Mocked<typeof api>;
const period = { fromDate: null, toDate: null, fromUtc: null, toUtcExclusive: null, timeZone: "Asia/Hebron" };

// The API database test's hand-computed store (see apps/api/src/integration/analytics.e2e.test.ts):
// Sun 23:30 and Sun 00:15 (winter), Mon 00:30 and Mon 12:00, Tue 12:00, all Hebron time.
function peakFixture(): api.AdminPeakTimes {
  const byWeekdayHour = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  byWeekdayHour[0][23] = 1;
  byWeekdayHour[0][0] = 1;
  byWeekdayHour[1][0] = 1;
  byWeekdayHour[1][12] = 1;
  byWeekdayHour[2][12] = 1;
  return {
    period,
    totalOrders: 5,
    byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, orders: byWeekdayHour.reduce((sum, row) => sum + row[hour], 0) })),
    byWeekday: byWeekdayHour.map((row, weekday) => ({ weekday, orders: row.reduce((sum, count) => sum + count, 0) })),
    byWeekdayHour
  };
}

const products: api.AdminTopProducts = {
  period,
  sortBy: "quantity",
  totals: { deliveredOrders: 5, productsSold: 4, revenueMinor: 10473 },
  items: [
    { rank: 1, menuItemId: "bread", name: "Bread", unitLabel: "item", quantityMilli: 5000, revenueMinor: 2125, orders: 3 },
    { rank: 2, menuItemId: "tomatoes", name: "Tomatoes", unitLabel: "kg", quantityMilli: 3250, revenueMinor: 2600, orders: 2 },
    { rank: 3, menuItemId: "labneh", name: "Labneh", unitLabel: "item", quantityMilli: 3000, revenueMinor: 3248, orders: 2 },
    { rank: 4, menuItemId: "oil", name: "Olive oil", unitLabel: "item", quantityMilli: 1000, revenueMinor: 2500, orders: 1 }
  ]
};

const retention: api.AdminCustomerRetention = {
  period,
  customers: 3,
  oneTimeCustomers: 1,
  returningCustomers: 2,
  returningRateBp: 6667,
  deliveredOrders: 5,
  ordersFromReturningCustomers: 4
};

beforeAll(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  mocked.fetchAdminAccess.mockResolvedValue({ isSuperAdmin: false, permissions: ["VIEW_ALL_ORDERS"] });
  mocked.getAdminTopProducts.mockResolvedValue(products);
  mocked.getAdminPeakTimes.mockResolvedValue(peakFixture());
  mocked.getAdminCustomerRetention.mockResolvedValue(retention);
});

test("returning vs one-time customers show the same figures as the web console", async () => {
  render(<AdminAnalyticsScreen onBack={() => undefined} />);
  expect(await screen.findByText("66.67%")).toBeTruthy();
  expect(screen.getByText("Returning rate")).toBeTruthy();
  expect(screen.getByText("Two or more delivered orders · 4 orders")).toBeTruthy();
  expect(screen.getByText("5 delivered orders in the period")).toBeTruthy();
  expect(screen.getByText("Returning · 2")).toBeTruthy();
  expect(screen.getByText("One-time · 1")).toBeTruthy();
  expect(screen.getByLabelText("2 of 3 customers returned (66.67%)")).toBeTruthy();
});

test("best sellers list every ranked row with exact quantities and agorot, and re-rank on demand", async () => {
  render(<AdminAnalyticsScreen onBack={() => undefined} />);
  expect(await screen.findByText("104.73 ILS")).toBeTruthy();
  expect(screen.getByText("5 item")).toBeTruthy();
  expect(screen.getByText("21.25 ILS")).toBeTruthy();
  expect(screen.getByText("3.25 kg")).toBeTruthy();
  expect(screen.getByText("26.00 ILS")).toBeTruthy();
  expect(screen.getByText("32.48 ILS")).toBeTruthy();
  expect(screen.getByText("Olive oil")).toBeTruthy();
  expect(mocked.getAdminTopProducts).toHaveBeenLastCalledWith("token", expect.objectContaining({ sortBy: "quantity", limit: 20 }));

  fireEvent.press(screen.getByText("By revenue"));
  await waitFor(() =>
    expect(mocked.getAdminTopProducts).toHaveBeenLastCalledWith("token", expect.objectContaining({ sortBy: "revenue" }))
  );
});

test("peak hours read in Hebron time, and each weekday's hours come from the same grid as the web heatmap", async () => {
  render(<AdminAnalyticsScreen onBack={() => undefined} />);
  expect(await screen.findByText(/Busiest hour: 00:00, 12:00/)).toBeTruthy();
  expect(screen.getByText(/Busiest day: Sunday, Monday/)).toBeTruthy();

  fireEvent.press(screen.getByTestId("hour-0"));
  expect(screen.getByText("00:00: 2 orders")).toBeTruthy();

  fireEvent.press(screen.getAllByText("Monday")[0]);
  fireEvent.press(screen.getByTestId("hour-0"));
  expect(screen.getByText("Monday 00:00: 1 orders")).toBeTruthy();
  fireEvent.press(screen.getByTestId("hour-23"));
  expect(screen.getByText("Monday 23:00: 0 orders")).toBeTruthy();

  // Tapping a weekday bar drills into that day too.
  fireEvent.press(screen.getByLabelText("Sunday: 2 orders"));
  fireEvent.press(screen.getByTestId("hour-23"));
  expect(screen.getByText("Sunday 23:00: 1 orders")).toBeTruthy();

  // The exact numbers are also available as a list.
  fireEvent.press(screen.getByText("Show the numbers as a list"));
  expect(screen.getAllByText("23:00").length).toBeGreaterThan(0);
});

test("the default period is the last 30 Hebron days, and 'All time' drops the bounds", async () => {
  render(<AdminAnalyticsScreen onBack={() => undefined} />);
  await screen.findByText("66.67%");
  const firstCall = mocked.getAdminPeakTimes.mock.calls[0][1]!;
  expect(firstCall.fromDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(firstCall.toDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  fireEvent.press(screen.getByText("All time"));
  await waitFor(() => expect(mocked.getAdminPeakTimes).toHaveBeenLastCalledWith("token", {}));
  expect(mocked.getAdminCustomerRetention).toHaveBeenLastCalledWith("token", {});
});

test("a custom period is only applied once both typed dates are real days in order", async () => {
  render(<AdminAnalyticsScreen onBack={() => undefined} />);
  await screen.findByText("66.67%");
  fireEvent.press(screen.getByText("Custom"));
  const [from, to] = screen.getAllByPlaceholderText("2026-09-28");
  fireEvent.changeText(from, "2026-09-30");
  fireEvent.changeText(to, "2026-09-01");
  expect(screen.getByText("Write dates as year-month-day, with the start on or before the end.")).toBeTruthy();

  fireEvent.changeText(from, "٢٠٢٦-٠٩-٠١");
  fireEvent.changeText(to, "2026-09-28");
  fireEvent.press(screen.getByText("Apply"));
  await waitFor(() =>
    expect(mocked.getAdminPeakTimes).toHaveBeenLastCalledWith("token", { fromDate: "2026-09-01", toDate: "2026-09-28" })
  );
});

test("without VIEW_ALL_ORDERS nothing is requested and the reason is shown", async () => {
  mocked.fetchAdminAccess.mockResolvedValue({ isSuperAdmin: false, permissions: ["MANAGE_USERS"] });
  render(<AdminAnalyticsScreen onBack={() => undefined} />);
  expect(await screen.findByText("Viewing analytics needs permission to view all orders.")).toBeTruthy();
  expect(mocked.getAdminPeakTimes).not.toHaveBeenCalled();
  expect(mocked.getAdminTopProducts).not.toHaveBeenCalled();
});

test("a section that fails to load shows its error while the others still render", async () => {
  mocked.getAdminPeakTimes.mockRejectedValue(new Error("Peak times failed"));
  render(<AdminAnalyticsScreen onBack={() => undefined} />);
  expect(await screen.findByText("66.67%")).toBeTruthy();
  expect(await screen.findByText("104.73 ILS")).toBeTruthy();
  expect(await screen.findByText(/Peak times failed|went wrong|error/i)).toBeTruthy();
});
