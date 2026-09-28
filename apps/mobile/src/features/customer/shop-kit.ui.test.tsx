import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "../../i18n";
import type { SupermarketProduct } from "../../core/api";
import type { Cart } from "./cart";
import { CartBar, ProductCard } from "./shop-kit";

function product(overrides: Partial<SupermarketProduct> = {}): SupermarketProduct {
  return {
    id: "labneh",
    name: "Labneh",
    description: null,
    priceMinor: 1250,
    salePriceMinor: 999,
    effectivePriceMinor: 999,
    imageUrl: null,
    sku: null,
    brand: "Al Juneidi",
    unitLabel: "500 g",
    stockQuantity: null,
    isFeatured: false,
    isVariableWeight: false,
    barcode: null,
    reorderLevel: null,
    offer: null,
    categoryId: "dairy",
    categoryName: "Dairy",
    ...overrides
  };
}

function renderCard(overrides: Partial<SupermarketProduct>, quantity: number) {
  const handlers = { onOpen: jest.fn(), onAdd: jest.fn(), onIncrement: jest.fn(), onDecrement: jest.fn() };
  render(<ProductCard product={product(overrides)} quantity={quantity} {...handlers} />);
  return handlers;
}

beforeAll(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

test("a product not yet in the basket shows its sale price and a single add button", () => {
  const handlers = renderCard({}, 0);
  expect(screen.getByText("9.99 ILS")).toBeTruthy();
  expect(screen.getByText("12.50 ILS")).toBeTruthy();
  expect(screen.getByText("Al Juneidi")).toBeTruthy();
  fireEvent.press(screen.getByLabelText("Add Labneh"));
  expect(handlers.onAdd).toHaveBeenCalledTimes(1);
  expect(handlers.onOpen).not.toHaveBeenCalled();
});

test("once in the basket the card changes quantity in place, and at one the minus removes", () => {
  const handlers = renderCard({}, 1);
  expect(screen.getByLabelText("1 in the basket")).toBeTruthy();
  fireEvent.press(screen.getByTestId("increase-Labneh"));
  expect(handlers.onIncrement).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByLabelText("Remove Labneh from the basket"));
  expect(handlers.onDecrement).toHaveBeenCalledTimes(1);
  expect(handlers.onOpen).not.toHaveBeenCalled();
});

test("stock is respected: low stock is announced and the plus stops at the counted level", () => {
  const handlers = renderCard({ stockQuantity: 2 }, 2);
  expect(screen.getByText("Only 2 left")).toBeTruthy();
  fireEvent.press(screen.getByTestId("increase-Labneh"));
  expect(handlers.onIncrement).not.toHaveBeenCalled();
});

test("a sold-out product says so and cannot be added", () => {
  const handlers = renderCard({ stockQuantity: 0 }, 0);
  expect(screen.getByText("Out of stock")).toBeTruthy();
  fireEvent.press(screen.getByLabelText("Add Labneh"));
  expect(handlers.onAdd).not.toHaveBeenCalled();
});

test("tapping the card itself opens the product", () => {
  const handlers = renderCard({}, 0);
  fireEvent.press(screen.getByTestId("product-card-labneh"));
  expect(handlers.onOpen).toHaveBeenCalledTimes(1);
});

test("the cart bar shows item count, exact subtotal and what the sale prices save", () => {
  const cart: Cart = {
    restaurantId: "store",
    restaurantName: "JOVO MARKET",
    items: [
      { menuItemId: "labneh", name: "Labneh", priceMinor: 999, quantity: 2, unitLabel: "item", allowSubstitution: true, regularPriceMinor: 1250 },
      { menuItemId: "bread", name: "Bread", priceMinor: 425, quantity: 1, unitLabel: "item", allowSubstitution: true }
    ]
  };
  const onPress = jest.fn();
  render(<CartBar cart={cart} onPress={onPress} />);
  expect(screen.getByText("3")).toBeTruthy();
  expect(screen.getByText("24.23 ILS")).toBeTruthy(); // 2 x 9.99 + 4.25
  expect(screen.getByText("You're saving 5.02 ILS")).toBeTruthy();
  fireEvent.press(screen.getByTestId("cart-bar"));
  expect(onPress).toHaveBeenCalled();
});
