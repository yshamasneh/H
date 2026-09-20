import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { Image } from "react-native";
import i18n from "../../i18n";
import { CheckoutScreen } from "./cart-screens";
import type { Cart } from "./cart";
import { createOrder, getOrderQuote, getSupermarketStatus, listMyAddresses } from "../../core/api";
import { getAccessToken } from "../../core/session";
import { ApiError } from "../../core/api-error";

// Mock the whole network + native surface CheckoutScreen touches. We only exercise the
// UI double-submit guard, so the API/session/location layers are stubbed.
jest.mock("../../core/api", () => ({
  orderPaymentMethods: ["CASH"],
  createOrder: jest.fn(),
  getOrderQuote: jest.fn(),
  getSupermarketStatus: jest.fn(),
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
  (getSupermarketStatus as jest.Mock).mockReset();
  (listMyAddresses as jest.Mock).mockResolvedValue([]);
  (getSupermarketStatus as jest.Mock).mockResolvedValue({ isOpenNow: true });
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

test("checkout keeps the cart image URL in its order summary", () => {
  const pictured = { ...cart, items: [{ ...cart.items[0], imageUrl: "https://cdn.example/milk.jpg" }] };
  const view = render(<CheckoutScreen cart={pictured} onBack={() => {}} onPlaced={() => {}} substitutionEnabled={true} />);
  expect(view.UNSAFE_getAllByType(Image).some((image) => image.props.source?.uri === "https://cdn.example/milk.jpg")).toBe(true);
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

test("store closing after quote prevents order creation and retains the basket", async () => {
  (getSupermarketStatus as jest.Mock)
    .mockResolvedValueOnce({ isOpenNow: true })
    .mockResolvedValueOnce({ isOpenNow: false });
  render(<CheckoutScreen cart={cart} onBack={() => {}} onPlaced={() => {}} substitutionEnabled />);
  await driveToQuote();
  await act(async () => {
    fireEvent.press(screen.getByText(i18n.t("cart:checkout.placeOrder")));
  });
  expect(createOrder).not.toHaveBeenCalled();
  expect(screen.getByText("1 x Milk")).toBeTruthy();
  expect(screen.getAllByText(i18n.t("cart:checkout.storeClosed")).length).toBeGreaterThan(0);
});

test("quote reports a closed store separately from a connection failure", async () => {
  (getOrderQuote as jest.Mock).mockRejectedValueOnce(new ApiError(409, "RESTAURANT_CLOSED", "Store closed"));
  render(<CheckoutScreen cart={cart} onBack={() => {}} onPlaced={() => {}} substitutionEnabled />);
  await driveToQuote();
  await screen.findByText(i18n.t("cart:checkout.storeClosed"));
  expect(screen.getByText("1 x Milk")).toBeTruthy();
  expect(createOrder).not.toHaveBeenCalled();
});

test("editing the delivery address invalidates and refreshes an existing quote", async () => {
  render(<CheckoutScreen cart={cart} onBack={() => {}} onPlaced={() => {}} substitutionEnabled />);
  await driveToQuote();
  fireEvent.changeText(screen.getByPlaceholderText(i18n.t("cart:checkout.addressPlaceholder")), "456 New Street, Ramallah");
  await waitFor(() => expect(getOrderQuote).toHaveBeenCalledTimes(2), { timeout: 2000 });
  expect((getOrderQuote as jest.Mock).mock.calls[1][1].deliveryAddressLine).toBe("456 New Street, Ramallah");
});

test("choosing another saved location requests a quote with its coordinates", async () => {
  (listMyAddresses as jest.Mock).mockResolvedValue([
    { id: "a1", label: "Home", addressLine: "123 Home Street", latitude: 31.9, longitude: 35.2, isDefault: true },
    { id: "a2", label: "Work", addressLine: "456 Work Street", latitude: 32.0, longitude: 35.3, isDefault: false }
  ]);
  render(<CheckoutScreen cart={cart} onBack={() => {}} onPlaced={() => {}} substitutionEnabled />);
  await screen.findByText("Work");
  await act(async () => { fireEvent.press(screen.getByText(i18n.t("cart:checkout.calculateDeliveryPrice"))); });
  await waitFor(() => expect(getOrderQuote).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByText("Work"));
  await waitFor(() => expect(getOrderQuote).toHaveBeenCalledTimes(2), { timeout: 2000 });
  const revisedInput = (getOrderQuote as jest.Mock).mock.calls[1][1];
  expect(revisedInput.deliveryAddressLine).toBe("456 Work Street");
  expect(revisedInput.deliveryLatitude).toBe(32.0);
  expect(revisedInput.deliveryLongitude).toBe(35.3);
});

test("a changed server price requires a second explicit confirmation using the new quote", async () => {
  const updated = {
    subtotalMinor: 750,
    deliveryDistanceMeters: 5000,
    deliveryFeeMinor: 1500,
    discountMinor: 0,
    totalMinor: 2250,
    appliedPromotions: []
  };
  (createOrder as jest.Mock)
    .mockRejectedValueOnce(new ApiError(409, "ORDER_PRICE_CHANGED", "Price changed", { currentQuote: updated }))
    .mockResolvedValueOnce({ id: "order-1" });
  const onPlaced = jest.fn();
  render(<CheckoutScreen cart={cart} onBack={() => {}} onPlaced={onPlaced} substitutionEnabled />);
  await driveToQuote();
  await act(async () => { fireEvent.press(screen.getByText(i18n.t("cart:checkout.placeOrder"))); });
  expect(onPlaced).not.toHaveBeenCalled();
  expect(screen.getByText(i18n.t("cart:checkout.priceChanged"))).toBeTruthy();
  expect(screen.getByText("22.50 ILS")).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText(i18n.t("cart:checkout.confirmUpdatedPrice"))); });
  expect((createOrder as jest.Mock).mock.calls[0][1].expectedDeliveryFeeMinor).toBe(1000);
  expect((createOrder as jest.Mock).mock.calls[1][1].expectedDeliveryFeeMinor).toBe(1500);
  expect((createOrder as jest.Mock).mock.calls[1][1].expectedTotalMinor).toBe(2250);
  expect(onPlaced).toHaveBeenCalledTimes(1);
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
  // First attempt fails; retry of the same basket succeeds.
  await act(async () => {
    fireEvent.press(screen.getByText(i18n.t("cart:checkout.placeOrder")));
  });
  await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
  await act(async () => {
    fireEvent.press(screen.getByText(i18n.t("cart:checkout.placeOrder")));
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
