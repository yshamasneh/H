import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import i18n from "../../i18n";
import { CheckoutScreen } from "./cart-screens";
import type { Cart } from "./cart";
import { createOrder, getOrderQuote, listMyAddresses } from "../../core/api";
import { getAccessToken } from "../../core/session";

// Mock the whole network + native surface CheckoutScreen touches. We only exercise the
// UI double-submit guard, so the API/session/location layers are stubbed.
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
jest.mock("../../core/location", () => ({
  getCurrentCoordinates: jest.fn().mockResolvedValue({ latitude: 31.9, longitude: 35.2 }),
  reverseGeocode: jest.fn().mockResolvedValue("Somewhere")
}));
jest.mock("../../core/socket", () => ({ useOrderRealtime: () => {} }));
jest.mock("../../components/location-map", () => ({ LocationMap: () => null }));

const cart: Cart = {
  restaurantId: "s1",
  restaurantName: "JOVO MARKET",
  items: [{ menuItemId: "m1", name: "Milk", priceMinor: 750, quantity: 1, unitLabel: "item", allowSubstitution: false }]
};

beforeAll(async () => {
  // English labels so the queries below are stable.
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  (listMyAddresses as jest.Mock).mockResolvedValue([]);
  (getAccessToken as jest.Mock).mockResolvedValue("access-token");
  (getOrderQuote as jest.Mock).mockResolvedValue({
    subtotalMinor: 750,
    deliveryDistanceMeters: 1000,
    deliveryFeeMinor: 1000,
    discountMinor: 0,
    totalMinor: 1750,
    appliedPromotions: []
  });
});

afterAll(async () => {
  await act(async () => {
    await i18n.changeLanguage("ar");
  });
});

test("a rapid double-tap on Place order submits exactly one order", async () => {
  // createOrder stays pending so the screen doesn't navigate away mid-assertion.
  (createOrder as jest.Mock).mockReturnValue(new Promise(() => {}));

  render(<CheckoutScreen cart={cart} onBack={() => {}} onPlaced={() => {}} substitutionEnabled={true} />);

  // Provide a valid delivery address, then get a delivery quote (Place order is gated on it).
  fireEvent.changeText(
    screen.getByPlaceholderText(i18n.t("cart:checkout.addressPlaceholder")),
    "123 Testing Street, Ramallah"
  );
  await act(async () => {
    fireEvent.press(screen.getByText(i18n.t("cart:checkout.calculateDeliveryPrice")));
  });
  await waitFor(() => expect(getOrderQuote).toHaveBeenCalledTimes(1));

  // Two presses in the same frame, before React can re-render the button as disabled.
  const placeOrder = await screen.findByText(i18n.t("cart:checkout.placeOrder"));
  await act(async () => {
    fireEvent.press(placeOrder);
    fireEvent.press(placeOrder);
  });

  await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
});

test("Place order is refused until a delivery quote has been calculated", async () => {
  (createOrder as jest.Mock).mockResolvedValue({ id: "order-1" });
  render(<CheckoutScreen cart={cart} onBack={() => {}} onPlaced={() => {}} substitutionEnabled={true} />);

  fireEvent.changeText(
    screen.getByPlaceholderText(i18n.t("cart:checkout.addressPlaceholder")),
    "123 Testing Street, Ramallah"
  );
  // No quote calculated yet → pressing Place order must not call createOrder.
  await act(async () => {
    fireEvent.press(screen.getByText(i18n.t("cart:checkout.placeOrder")));
  });
  expect(createOrder).not.toHaveBeenCalled();
});

async function driveToQuote() {
  fireEvent.changeText(
    screen.getByPlaceholderText(i18n.t("cart:checkout.addressPlaceholder")),
    "123 Testing Street, Ramallah"
  );
  await act(async () => {
    fireEvent.press(screen.getByText(i18n.t("cart:checkout.calculateDeliveryPrice")));
  });
  await waitFor(() => expect(getOrderQuote).toHaveBeenCalled());
}

const keyOfCall = (index: number) => (createOrder as jest.Mock).mock.calls[index][1].idempotencyKey as string;

test("the idempotency key is reused across retries within one checkout attempt (TC-081 mobile)", async () => {
  (createOrder as jest.Mock).mockRejectedValueOnce(new Error("network")).mockResolvedValue({ id: "order-1" });
  render(<CheckoutScreen cart={cart} onBack={() => {}} onPlaced={() => {}} substitutionEnabled={true} />);
  await driveToQuote();
  const placeOrder = await screen.findByText(i18n.t("cart:checkout.placeOrder"));

  // First attempt fails; retry of the same basket succeeds.
  await act(async () => {
    fireEvent.press(placeOrder);
  });
  await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
  await act(async () => {
    fireEvent.press(placeOrder);
  });
  await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2));

  expect(keyOfCall(0)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(keyOfCall(1)).toBe(keyOfCall(0));
});

test("a new checkout attempt (different basket) mints a fresh idempotency key (TC-081 mobile)", async () => {
  (createOrder as jest.Mock).mockReturnValue(new Promise(() => {}));
  const { unmount } = render(<CheckoutScreen cart={cart} onBack={() => {}} onPlaced={() => {}} substitutionEnabled={true} />);
  await driveToQuote();
  await act(async () => {
    fireEvent.press(await screen.findByText(i18n.t("cart:checkout.placeOrder")));
  });
  await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
  unmount();

  const differentCart: Cart = {
    ...cart,
    items: [{ ...cart.items[0], menuItemId: "m2", quantity: 3 }]
  };
  render(<CheckoutScreen cart={differentCart} onBack={() => {}} onPlaced={() => {}} substitutionEnabled={true} />);
  await driveToQuote();
  await act(async () => {
    fireEvent.press(await screen.findByText(i18n.t("cart:checkout.placeOrder")));
  });
  await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2));

  expect(keyOfCall(1)).not.toBe(keyOfCall(0));
});
