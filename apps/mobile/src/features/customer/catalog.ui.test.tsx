import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import i18n from "../../i18n";
import * as api from "../../core/api";
import type { Cart } from "./cart";
import { SupermarketCatalogScreen, SupermarketProductScreen } from "./supermarket-screens";

jest.mock("../../core/api", () => ({
  getSupermarketCatalog: jest.fn(),
  getSupermarketProduct: jest.fn(),
  ApiError: class ApiError extends Error {}
}));

const mocked = api as jest.Mocked<typeof api>;

function product(id: string, overrides: Partial<api.SupermarketProduct> = {}): api.SupermarketProduct {
  return {
    id,
    name: `Product ${id}`,
    description: null,
    priceMinor: 1000,
    salePriceMinor: null,
    effectivePriceMinor: 1000,
    imageUrl: null,
    sku: null,
    brand: null,
    unitLabel: "item",
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

function catalogPage(ids: string[], total: number, page = 1): api.SupermarketCatalog {
  return {
    supermarket: { id: "s1", name: "JOVO MARKET" } as api.RestaurantSummary,
    departments: [{ id: "dairy", name: "Dairy", productCount: 3 } as api.SupermarketCatalog["departments"][number]],
    products: ids.map((id) => product(id)),
    page,
    pageSize: 40,
    total
  };
}

const cart: Cart = {
  restaurantId: "s1",
  restaurantName: "JOVO MARKET",
  items: [{ menuItemId: "p1", name: "Product p1", priceMinor: 1000, quantity: 2, unitLabel: "item", allowSubstitution: true }]
};

function catalogProps() {
  return {
    supermarketId: "s1",
    supermarketName: "JOVO MARKET",
    cart,
    onBack: jest.fn(),
    onAddItem: jest.fn(),
    onIncrementItem: jest.fn(),
    onDecrementItem: jest.fn(),
    onOpenProduct: jest.fn(),
    onViewCart: jest.fn()
  };
}

beforeAll(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

beforeEach(() => {
  jest.clearAllMocks();
});

test("the catalogue searches as the customer types, and says how many match", async () => {
  mocked.getSupermarketCatalog.mockResolvedValue(catalogPage(["p1", "p2"], 2));
  const props = catalogProps();
  render(<SupermarketCatalogScreen {...props} />);
  expect(await screen.findByText("Products: 2")).toBeTruthy();
  expect(screen.getByLabelText("2 in the basket")).toBeTruthy();

  mocked.getSupermarketCatalog.mockResolvedValue(catalogPage(["p2"], 1));
  fireEvent.changeText(screen.getByTestId("catalog-search"), "milk");
  await waitFor(() =>
    expect(mocked.getSupermarketCatalog).toHaveBeenLastCalledWith("s1", expect.objectContaining({ search: "milk", page: 1 }))
  );
  expect(await screen.findByText("Results for “milk”: 1")).toBeTruthy();

  fireEvent.press(screen.getByTestId("product-card-p2"));
  expect(props.onOpenProduct).toHaveBeenCalledWith("p2", { departmentId: undefined, search: "milk" });

  fireEvent.press(screen.getByLabelText("Clear search"));
  await waitFor(() => expect(mocked.getSupermarketCatalog).toHaveBeenLastCalledWith("s1", expect.objectContaining({ search: undefined })));
});

test("more products load as the list is scrolled, until everything is shown", async () => {
  mocked.getSupermarketCatalog
    .mockResolvedValueOnce(catalogPage(["p1", "p2"], 3))
    .mockResolvedValueOnce(catalogPage(["p3"], 3, 2));
  render(<SupermarketCatalogScreen {...catalogProps()} />);
  expect(await screen.findByText("Product p1")).toBeTruthy();
  const list = screen.UNSAFE_getByType(require("react-native").FlatList);
  await act(async () => {
    list.props.onEndReached();
  });
  expect(await screen.findByText("Product p3")).toBeTruthy();
  expect(mocked.getSupermarketCatalog).toHaveBeenLastCalledWith("s1", expect.objectContaining({ page: 2 }));
});

test("a failed load can be retried from the screen", async () => {
  mocked.getSupermarketCatalog.mockRejectedValueOnce(new Error("Network down")).mockResolvedValueOnce(catalogPage(["p1"], 1));
  render(<SupermarketCatalogScreen {...catalogProps()} />);
  fireEvent.press(await screen.findByText("Try again"));
  expect(await screen.findByText("Product p1")).toBeTruthy();
});

function productProps(overrides: Partial<Parameters<typeof SupermarketProductScreen>[0]> = {}) {
  return {
    supermarketId: "s1",
    productId: "p1",
    cart,
    onBack: jest.fn(),
    onAddItem: jest.fn(),
    onViewCart: jest.fn(),
    onViewed: jest.fn(),
    ...overrides
  };
}

test("the product page keeps the add bar in reach, adds the chosen quantity, and says what is already in the basket", async () => {
  mocked.getSupermarketProduct.mockResolvedValue(product("p1", { salePriceMinor: 800, effectivePriceMinor: 800 }));
  const props = productProps();
  render(<SupermarketProductScreen {...props} />);
  expect(await screen.findByText("2 already in your basket")).toBeTruthy();
  expect(props.onViewed).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));

  fireEvent.press(screen.getByLabelText("Increase quantity"));
  fireEvent.press(screen.getByTestId("add-to-basket"));
  expect(props.onAddItem).toHaveBeenCalledWith(expect.objectContaining({ id: "p1", allowSubstitution: true }), 2);

  fireEvent.press(screen.getByTestId("header-basket"));
  expect(props.onViewCart).toHaveBeenCalled();
});

test("the product page never offers more than the stock left after what is in the basket", async () => {
  mocked.getSupermarketProduct.mockResolvedValue(product("p1", { stockQuantity: 2 }));
  render(<SupermarketProductScreen {...productProps()} />);
  expect(await screen.findByText("All available stock is in your basket")).toBeTruthy();
  expect(screen.queryByTestId("add-to-basket")).toBeNull();
});

test("a sold-out product cannot be added", async () => {
  mocked.getSupermarketProduct.mockResolvedValue(product("p9", { stockQuantity: 0 }));
  render(<SupermarketProductScreen {...productProps({ productId: "p9", cart: null })} />);
  expect(await screen.findAllByText("Out of stock")).toHaveLength(2);
  expect(screen.queryByTestId("add-to-basket")).toBeNull();
});
