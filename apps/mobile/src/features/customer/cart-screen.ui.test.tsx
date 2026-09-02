import { render, screen, act } from "@testing-library/react-native";
import i18n from "../../i18n";
import { CartScreen } from "./cart-screens";
import type { Cart } from "./cart";

// Stub the network/native surface cart-screens imports at module load.
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
jest.mock("../../core/location", () => ({ getCurrentCoordinates: jest.fn(), reverseGeocode: jest.fn() }));
jest.mock("../../core/socket", () => ({ useOrderRealtime: () => {} }));
jest.mock("../../components/location-map", () => ({ LocationMap: () => null }));

const cart: Cart = {
  restaurantId: "s1",
  restaurantName: "JOVO MARKET",
  items: [{ menuItemId: "m1", name: "Milk", priceMinor: 750, quantity: 2, unitLabel: "carton", allowSubstitution: false }]
};

const noop = () => {};

function renderCart(substitutionEnabled = true) {
  render(
    <CartScreen
      cart={cart}
      onBack={noop}
      onBrowse={noop}
      onIncrement={noop}
      onDecrement={noop}
      onRemove={noop}
      onToggleSubstitution={noop}
      onCheckout={noop}
      substitutionEnabled={substitutionEnabled}
    />
  );
}

beforeAll(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

test("the substitution toggle exposes a checkbox role and its checked state (TC-195)", () => {
  renderCart();
  const checkboxes = screen.getAllByRole("checkbox");
  expect(checkboxes.length).toBeGreaterThanOrEqual(1);
  // allowSubstitution is false → the checkbox reports unchecked.
  expect(checkboxes[0].props.accessibilityState?.checked).toBe(false);
});

test("the substitution toggle is hidden when the platform option is disabled (TC-196)", () => {
  renderCart(false);
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
});

test("cart item controls carry accessible labels (TC-192)", () => {
  renderCart();
  expect(screen.getByLabelText(i18n.t("cart:cart.increaseQuantityAccessibility", { name: "Milk" }))).toBeTruthy();
  expect(screen.getByLabelText(i18n.t("cart:cart.decreaseQuantityAccessibility", { name: "Milk" }))).toBeTruthy();
  expect(screen.getByLabelText(i18n.t("cart:cart.removeItemAccessibility", { name: "Milk" }))).toBeTruthy();
});

afterAll(async () => {
  await act(async () => {
    await i18n.changeLanguage("ar");
  });
});
