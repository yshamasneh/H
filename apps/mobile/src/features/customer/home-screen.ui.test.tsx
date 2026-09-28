import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "../../i18n";
import * as api from "../../core/api";
import { CustomerHomeScreen } from "./home-screen";

jest.mock("../../core/api", () => ({
  listSupermarkets: jest.fn(),
  getSupermarketCatalog: jest.fn(),
  listActiveRestaurantOffers: jest.fn(),
  listMyNotifications: jest.fn(),
  listMyOrders: jest.fn(),
  ApiError: class ApiError extends Error {}
}));
jest.mock("../../core/session", () => ({ getAccessToken: jest.fn().mockResolvedValue("token") }));
jest.mock("../../core/kv-storage", () => ({
  kvStore: {
    getItem: jest.fn().mockResolvedValue(JSON.stringify([{ id: "seen", storeId: "s1", name: "Olive oil", imageUrl: null, viewedAt: 1 }])),
    setItem: jest.fn(),
    removeItem: jest.fn()
  }
}));

const mocked = api as jest.Mocked<typeof api>;
const customer = { id: "c1", fullName: "Lina Haddad", phone: "+970599000000", role: "CUSTOMER" as const };

function product(id: string): api.SupermarketProduct {
  return {
    id, name: `Product ${id}`, description: null, priceMinor: 1000, salePriceMinor: null, effectivePriceMinor: 1000,
    imageUrl: null, sku: null, brand: null, unitLabel: "item", stockQuantity: null, isFeatured: false, isVariableWeight: false,
    barcode: null, reorderLevel: null, offer: null, categoryId: "dairy", categoryName: "Dairy"
  };
}

function props() {
  return {
    user: customer,
    cart: null,
    onOpenCatalog: jest.fn(),
    onOpenProduct: jest.fn(),
    onOpenOffer: jest.fn(),
    onAddItem: jest.fn(),
    onIncrementItem: jest.fn(),
    onDecrementItem: jest.fn(),
    onViewCart: jest.fn(),
    onOpenNotifications: jest.fn()
  };
}

beforeAll(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  mocked.listSupermarkets.mockResolvedValue({ items: [{ id: "s1", name: "JOVO MARKET", isOpenNow: true }], page: 1, pageSize: 1, total: 1 } as never);
  mocked.getSupermarketCatalog.mockResolvedValue({
    supermarket: { id: "s1", name: "JOVO MARKET" },
    departments: [{ id: "dairy", name: "Dairy", productCount: 12 }],
    products: [product("p1")],
    page: 1,
    pageSize: 8,
    total: 1
  } as never);
  mocked.listActiveRestaurantOffers.mockResolvedValue([]);
  mocked.listMyNotifications.mockResolvedValue({ items: [], unreadCount: 0 } as never);
  mocked.listMyOrders.mockResolvedValue({
    items: [
      {
        id: "o1",
        status: "DELIVERED",
        createdAt: "2026-09-20T10:00:00Z",
        restaurant: { id: "s1", name: "JOVO MARKET" },
        items: [{ id: "l1", menuItemId: "bread", nameSnapshot: "Bread", imageUrl: null, fulfillmentAdjustment: null }]
      }
    ],
    page: 1,
    pageSize: 10,
    total: 1
  } as never);
});

test("the storefront leads with search, shows the store is open, and offers the way back to known products", async () => {
  const handlers = props();
  render(<CustomerHomeScreen {...handlers} />);
  expect(await screen.findByText("Open now")).toBeTruthy();
  expect(await screen.findByText("Recently viewed")).toBeTruthy();
  expect(screen.getByText("Olive oil")).toBeTruthy();
  expect(await screen.findByText("Buy again")).toBeTruthy();
  expect(screen.getByText("Bread")).toBeTruthy();
  // No offers: the offers row is simply absent rather than an empty card.
  expect(screen.queryByText("Offers")).toBeNull();

  fireEvent.press(screen.getByTestId("home-search"));
  expect(handlers.onOpenCatalog).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }), { focusSearch: true });

  fireEvent.press(screen.getByLabelText("Bread"));
  expect(handlers.onOpenProduct).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }), "bread");

  fireEvent.press(screen.getByLabelText("Add Product p1"));
  expect(handlers.onAddItem).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }), expect.objectContaining({ id: "p1" }));
});

test("a closed store says so up front and hides products that cannot be ordered", async () => {
  mocked.listSupermarkets.mockResolvedValue({ items: [{ id: "s1", name: "JOVO MARKET", isOpenNow: false }], page: 1, pageSize: 1, total: 1 } as never);
  const { forgetMarketStore } = require("./market");
  forgetMarketStore();
  render(<CustomerHomeScreen {...props()} />);
  expect(await screen.findByText("Closed now")).toBeTruthy();
  expect(screen.queryByText("Product p1")).toBeNull();
  expect(screen.queryByText("Recently viewed")).toBeNull();
});
