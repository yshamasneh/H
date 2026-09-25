import { act, render, screen } from "@testing-library/react-native";
import i18n from "../../i18n";
import { OrderConfirmationScreen } from "./cart-screens";
import type { OrderDetail } from "../../core/api";

jest.mock("../../core/api", () => ({
  orderPaymentMethods: ["CASH"],
  createOrder: jest.fn(),
  getOrderQuote: jest.fn(),
  listMyAddresses: jest.fn(),
  cancelMyOrder: jest.fn(),
  decideOrderFulfillment: jest.fn(),
  getMyOrder: jest.fn(),
  listMyOrders: jest.fn(),
  ApiError: class ApiError extends Error {}
}));
jest.mock("../../core/session", () => ({ getAccessToken: jest.fn() }));
jest.mock("../../core/location", () => ({ getCurrentCoordinates: jest.fn(), getPassiveCoordinates: jest.fn().mockResolvedValue(null), reverseGeocode: jest.fn() }));
jest.mock("../../core/socket", () => ({ useOrderRealtime: () => {} }));
jest.mock("../../components/location-map", () => ({ LocationMap: () => null }));

// 13.40 of goods + 10.00 delivery = 23.40 exact; collected as 24.00.
function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: "o1",
    status: "PLACED",
    restaurant: { id: "s1", name: "JOVO MARKET" },
    paymentMethod: "CASH",
    deliveryLabel: "Home",
    deliveryAddressLine: "12 Main St",
    deliveryLatitude: 31.9,
    deliveryLongitude: 35.2,
    deliveryDistanceMeters: 800,
    customerNote: null,
    appliedPromotions: [],
    items: [],
    subtotalMinor: 1340,
    deliveryFeeMinor: 1000,
    discountMinor: 0,
    totalMinor: 2340,
    cashDueMinor: 2400,
    cashRoundingMinor: 60,
    createdAt: "2026-09-20T10:00:00.000Z",
    statusHistory: [],
    delivery: null,
    requiresCustomerReview: false,
    ...overrides
  } as unknown as OrderDetail;
}

beforeAll(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

const renderConfirmation = (value: OrderDetail) =>
  render(<OrderConfirmationScreen onDone={() => undefined} onViewOrders={() => undefined} order={value} />);

test("the customer is told to pay the rounded-up cash amount, and sees how it was reached", () => {
  renderConfirmation(order());

  expect(screen.getByText("Pay 24.00 ILS in cash when it arrives.")).toBeTruthy();
  expect(screen.getByText("23.40 ILS")).toBeTruthy(); // the exact order total is still shown
  expect(screen.getByText("Rounded up to a whole shekel")).toBeTruthy();
  expect(screen.getByText("+0.60 ILS")).toBeTruthy();
  expect(screen.getByText("Cash to pay")).toBeTruthy();
  expect(screen.getByText("24.00 ILS")).toBeTruthy();
});

test("a whole-shekel total shows no rounding line at all", () => {
  renderConfirmation(order({ subtotalMinor: 1400, totalMinor: 2400, cashDueMinor: 2400, cashRoundingMinor: 0 }));

  expect(screen.getByText("Pay 24.00 ILS in cash when it arrives.")).toBeTruthy();
  expect(screen.queryByText("Rounded up to a whole shekel")).toBeNull();
  expect(screen.queryByText("Cash to pay")).toBeNull();
});

test("an API that predates rounding is shown exactly as before: the total is the cash due", () => {
  renderConfirmation(order({ cashDueMinor: undefined, cashRoundingMinor: undefined }));

  expect(screen.getByText("Pay 23.40 ILS in cash when it arrives.")).toBeTruthy();
  expect(screen.queryByText("Rounded up to a whole shekel")).toBeNull();
});
