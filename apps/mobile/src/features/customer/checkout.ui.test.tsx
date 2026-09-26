import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { Image } from "react-native";
import i18n from "../../i18n";
import { CheckoutScreen } from "./cart-screens";
import type { Cart } from "./cart";
import { createOrder, getOrderQuote, getSupermarketStatus, listMyAddresses } from "../../core/api";
import { getAccessToken } from "../../core/session";
import { getCurrentCoordinates, reverseGeocode } from "../../core/location";
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
  getPassiveCoordinates: jest.fn().mockResolvedValue(null),
  reverseGeocode: jest.fn().mockResolvedValue("Somewhere")
}));
jest.mock("../../core/socket", () => ({ useOrderRealtime: () => {} }));
jest.mock("../../components/location-map", () => {
  const { createElement } = require("react");
  const { Pressable } = require("react-native");
  // A stand-in map with one tappable spot, so a test can "place the pin" like a customer would.
  return {
    LocationMap: (props: { onCoordinateChange?: (c: { latitude: number; longitude: number }) => void }) =>
      createElement(Pressable, { testID: "map-pin", onPress: () => props.onCoordinateChange?.({ latitude: 31.9, longitude: 35.2 }) })
  };
});

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

  // Place the pin, provide a valid delivery address, then get a delivery quote (Place order is gated on it).
  await placePin();
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
  (getOrderQuote as jest.Mock).mockRejectedValue(new ApiError(409, "RESTAURANT_CLOSED", "Store closed"));
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

const homeAndWork = [
  { id: "a1", label: "Home", addressLine: "123 Home Street", latitude: 31.9, longitude: 35.2, isDefault: true },
  { id: "a2", label: "Work", addressLine: "456 Work Street", latitude: 32.0, longitude: 35.3, isDefault: false }
];

test("a saved address is quoted the moment it is chosen, with no button press and no wait", async () => {
  (listMyAddresses as jest.Mock).mockResolvedValue(homeAndWork);
  render(<CheckoutScreen cart={cart} onBack={() => {}} onPlaced={() => {}} substitutionEnabled />);
  await screen.findByText("Work");
  // The default address is selected on open and its fee is calculated straight away.
  await waitFor(() => expect(getOrderQuote).toHaveBeenCalledTimes(1));
  expect((getOrderQuote as jest.Mock).mock.calls[0][1].deliveryLatitude).toBe(31.9);
  await screen.findByText(i18n.t("cart:checkout.deliveryFeeHere"));

  (getOrderQuote as jest.Mock).mockClear();
  await act(async () => { fireEvent.press(screen.getByText("Work")); });
  await waitFor(() => expect(getOrderQuote).toHaveBeenCalledTimes(1), { timeout: 300 });
  const revisedInput = (getOrderQuote as jest.Mock).mock.calls[0][1];
  expect(revisedInput.deliveryAddressLine).toBe("456 Work Street");
  expect(revisedInput.deliveryLatitude).toBe(32.0);
  expect(revisedInput.deliveryLongitude).toBe(35.3);
  expect(screen.getByText(i18n.t("cart:checkout.activeSaved", { label: "Work" }))).toBeTruthy();
});

test("placing a pin shows the delivery fee and distance under the map straight away", async () => {
  render(<CheckoutScreen cart={cart} onBack={() => {}} onPlaced={() => {}} substitutionEnabled />);
  await act(async () => { fireEvent.press(screen.getByTestId("map-pin")); });
  await screen.findByText(i18n.t("cart:checkout.deliveryFeeHere"));
  expect(screen.getByText("10.00 ILS · 1.0 km")).toBeTruthy();
  expect(screen.getByText(i18n.t("cart:checkout.activePin"))).toBeTruthy();
});

test("'use my current location' overrides a saved address: coordinates, label, address and fee all come from where the customer actually is", async () => {
  (listMyAddresses as jest.Mock).mockResolvedValue(homeAndWork);
  (getCurrentCoordinates as jest.Mock).mockResolvedValueOnce({ latitude: 31.95, longitude: 35.25 });
  (reverseGeocode as jest.Mock).mockResolvedValueOnce("Al-Irsal Street, Ramallah");
  (createOrder as jest.Mock).mockReturnValue(new Promise(() => {}));
  render(<CheckoutScreen cart={cart} onBack={() => {}} onPlaced={() => {}} substitutionEnabled />);
  await screen.findByText("Work");
  await waitFor(() => expect(getOrderQuote).toHaveBeenCalledTimes(1)); // Home, from the saved default
  (getOrderQuote as jest.Mock).mockClear();

  await act(async () => { fireEvent.press(screen.getByText(i18n.t("cart:checkout.useCurrentLocation"))); });

  await waitFor(() => expect(getOrderQuote).toHaveBeenCalled());
  const quoted = (getOrderQuote as jest.Mock).mock.calls[0][1];
  expect(quoted.deliveryLatitude).toBe(31.95);
  expect(quoted.deliveryLongitude).toBe(35.25);
  expect(quoted.deliveryLabel).toBe(i18n.t("cart:checkout.currentLocationLabel"));
  await waitFor(() => expect(screen.getByDisplayValue("Al-Irsal Street, Ramallah")).toBeTruthy());
  expect(screen.queryByDisplayValue("123 Home Street")).toBeNull();
  expect(screen.getByText(i18n.t("cart:checkout.activeCurrent"))).toBeTruthy();

  await act(async () => { fireEvent.press(await screen.findByText(i18n.t("cart:checkout.placeOrder"))); });
  await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
  const placed = (createOrder as jest.Mock).mock.calls[0][1];
  expect(placed).toMatchObject({
    deliveryLatitude: 31.95,
    deliveryLongitude: 35.25,
    deliveryLabel: i18n.t("cart:checkout.currentLocationLabel"),
    deliveryAddressLine: "Al-Irsal Street, Ramallah"
  });
});

test("if no address can be read for the current location, the saved address text is NOT carried over to the new coordinates", async () => {
  (listMyAddresses as jest.Mock).mockResolvedValue(homeAndWork);
  (getCurrentCoordinates as jest.Mock).mockResolvedValueOnce({ latitude: 31.95, longitude: 35.25 });
  (reverseGeocode as jest.Mock).mockResolvedValueOnce(null);
  (createOrder as jest.Mock).mockResolvedValue({ id: "order-1" });
  render(<CheckoutScreen cart={cart} onBack={() => {}} onPlaced={() => {}} substitutionEnabled />);
  await screen.findByText("Work");
  await waitFor(() => expect(getOrderQuote).toHaveBeenCalledTimes(1));

  await act(async () => { fireEvent.press(screen.getByText(i18n.t("cart:checkout.useCurrentLocation"))); });

  await screen.findByText(i18n.t("cart:checkout.addressNotFound"));
  expect(screen.queryByDisplayValue("123 Home Street")).toBeNull();
  // Ordering is refused until the customer supplies an address for where they actually are.
  await act(async () => { fireEvent.press(screen.getByText(i18n.t("cart:checkout.placeOrder"))); });
  expect(createOrder).not.toHaveBeenCalled();
  expect(screen.getByText(i18n.t("cart:checkout.addressRequiredError"))).toBeTruthy();
});

test("moving the pin away from a saved address drops its label and its address text, and deselects it", async () => {
  (listMyAddresses as jest.Mock).mockResolvedValue(homeAndWork);
  (reverseGeocode as jest.Mock).mockResolvedValueOnce(null);
  render(<CheckoutScreen cart={cart} onBack={() => {}} onPlaced={() => {}} substitutionEnabled />);
  await screen.findByText("Work");
  await waitFor(() => expect(screen.getByDisplayValue("123 Home Street")).toBeTruthy());
  expect(screen.getByText(i18n.t("cart:checkout.activeSaved", { label: "Home" }))).toBeTruthy();

  await act(async () => { fireEvent.press(screen.getByTestId("map-pin")); });

  expect(screen.queryByDisplayValue("123 Home Street")).toBeNull();
  expect(screen.getByDisplayValue(i18n.t("cart:checkout.pinLabel"))).toBeTruthy();
  expect(screen.getByText(i18n.t("cart:checkout.activePin"))).toBeTruthy();
});

test("a slow GPS fix that arrives after the customer chose something else does not override their choice", async () => {
  let resolveGps!: (value: { latitude: number; longitude: number }) => void;
  (getCurrentCoordinates as jest.Mock).mockReturnValueOnce(new Promise((resolve) => { resolveGps = resolve; }));
  render(<CheckoutScreen cart={cart} onBack={() => {}} onPlaced={() => {}} substitutionEnabled />);

  await act(async () => { fireEvent.press(screen.getByText(i18n.t("cart:checkout.useCurrentLocation"))); });
  await act(async () => { fireEvent.press(screen.getByTestId("map-pin")); }); // the customer taps the map while GPS is working
  (getOrderQuote as jest.Mock).mockClear();
  await act(async () => { resolveGps({ latitude: 30, longitude: 34 }); });

  expect(getOrderQuote).not.toHaveBeenCalled();
  expect(screen.getByText(i18n.t("cart:checkout.activePin"))).toBeTruthy();
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

async function placePin() {
  await act(async () => {
    fireEvent.press(screen.getByTestId("map-pin"));
  });
  // Placing a pin now quotes at once (the fee shows straight away); the tests below count only their own quotes.
  await waitFor(() => expect(getOrderQuote).toHaveBeenCalled());
  (getOrderQuote as jest.Mock).mockClear();
}

async function driveToQuote() {
  await placePin();
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

test("an order can't be quoted or placed while the pin is still on its default spot", async () => {
  render(<CheckoutScreen cart={cart} onBack={() => {}} onPlaced={() => {}} substitutionEnabled />);
  fireEvent.changeText(screen.getByPlaceholderText(i18n.t("cart:checkout.addressPlaceholder")), "123 Testing Street, Ramallah");
  await act(async () => { fireEvent.press(screen.getByText(i18n.t("cart:checkout.calculateDeliveryPrice"))); });
  expect(getOrderQuote).not.toHaveBeenCalled();
  expect(screen.getByText(i18n.t("cart:checkout.pinNotSetError"))).toBeTruthy();
});

test("placing the pin fills the address from it and quotes straight away", async () => {
  render(<CheckoutScreen cart={cart} onBack={() => {}} onPlaced={() => {}} substitutionEnabled />);
  await act(async () => { fireEvent.press(screen.getByTestId("map-pin")); });
  // reverseGeocode is mocked to "Somewhere"
  await waitFor(() => expect(screen.getByDisplayValue("Somewhere")).toBeTruthy());
  await screen.findByText(i18n.t("cart:checkout.addressFromPin"));
  await waitFor(() => expect(getOrderQuote).toHaveBeenCalledTimes(1), { timeout: 2000 });
  expect((getOrderQuote as jest.Mock).mock.calls[0][1].deliveryLatitude).toBe(31.9);
});

test("a pin outside the delivery area shows a clear banner and blocks Place order", async () => {
  (getOrderQuote as jest.Mock).mockRejectedValue(new ApiError(422, "DELIVERY_OUT_OF_RANGE", "outside the 25 km delivery area"));
  (createOrder as jest.Mock).mockResolvedValue({ id: "order-1" });
  render(<CheckoutScreen cart={cart} onBack={() => {}} onPlaced={() => {}} substitutionEnabled />);
  await placePin();
  await screen.findByText(i18n.t("cart:checkout.outOfRangeTitle"), undefined, { timeout: 2000 });
  expect(screen.getByText(i18n.t("cart:checkout.outOfRangeBody"))).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText(i18n.t("cart:checkout.placeOrder"))); });
  expect(createOrder).not.toHaveBeenCalled();
});
