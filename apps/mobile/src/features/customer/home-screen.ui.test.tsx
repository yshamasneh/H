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
  getPlatformSettings: jest.fn(),
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
  // The resolved store is cached for the session; every test starts from a fresh lookup.
  require("./market").forgetMarketStore();
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
  mocked.getPlatformSettings.mockResolvedValue({ substitutionOptionEnabled: true, restaurantOrderingEnabled: false });
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

function offer(id: string, overrides: Partial<api.RestaurantOffer> = {}): api.RestaurantOffer {
  return {
    id, title: `Offer ${id}`, description: null, type: "ORDER_PERCENTAGE", discountPercent: 10, imageUrl: null, isFeatured: false,
    restaurantId: null, restaurantName: null, restaurantBusinessType: null, menuItemName: null, endsAt: null,
    ...overrides
  } as unknown as api.RestaurantOffer;
}

/** Every piece of rendered text, top to bottom. */
function renderedTexts(): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === "string") out.push(node);
    else if (node && typeof node === "object" && "children" in node) {
      for (const child of (node as { children: unknown[] | null }).children ?? []) walk(child);
    }
  };
  const tree = screen.toJSON();
  for (const root of Array.isArray(tree) ? tree : [tree]) walk(root);
  return out;
}

/** Where each label first appears in the rendered text, top to bottom (-1 when absent). */
function renderedOrder(labels: string[]): number[] {
  const texts = renderedTexts();
  return labels.map((label) => texts.indexOf(label));
}

test("the storefront reads search, then offers, then departments, then the store's products", async () => {
  mocked.listActiveRestaurantOffers.mockResolvedValue([offer("o1"), offer("o2", { isFeatured: true })]);
  render(<CustomerHomeScreen {...props()} />);
  expect(await screen.findByText("Offers")).toBeTruthy();
  expect(await screen.findByText("Product p1")).toBeTruthy();

  const [search, offers, departments, products] = renderedOrder(["Search products, brands or departments", "Offers", "Departments", "From JOVO MARKET"]);
  expect(search).toBeGreaterThan(-1);
  expect(search).toBeLessThan(offers);
  expect(offers).toBeLessThan(departments);
  expect(departments).toBeLessThan(products);
});

test("the featured offer leads the Offers section and is not repeated in the row", async () => {
  mocked.listActiveRestaurantOffers.mockResolvedValue([offer("o1"), offer("o2", { isFeatured: true })]);
  render(<CustomerHomeScreen {...props()} />);
  expect(await screen.findByText("Offer o2")).toBeTruthy();
  expect(screen.getAllByText("Offer o2")).toHaveLength(1);
  expect(screen.getByText("Offer o1")).toBeTruthy();
  const [featured, regular] = renderedOrder(["Offer o2", "Offer o1"]);
  expect(featured).toBeLessThan(regular);
});

test("with no offers the departments sit straight under the search, with no placeholder in between", async () => {
  render(<CustomerHomeScreen {...props()} />);
  expect(await screen.findByTestId("home-departments")).toBeTruthy();
  expect(screen.queryByText("Offers")).toBeNull();
  expect(screen.queryByTestId("home-offers")).toBeNull();
  const [search, departments] = renderedOrder(["Search products, brands or departments", "Departments"]);
  expect(search).toBeLessThan(departments);
});

test("restaurant offers are not shown to customers while restaurants are off", async () => {
  mocked.listActiveRestaurantOffers.mockResolvedValue([offer("r1", { restaurantId: "rest1", restaurantBusinessType: "RESTAURANT" as never })]);
  render(<CustomerHomeScreen {...props()} />);
  expect(await screen.findByTestId("home-departments")).toBeTruthy();
  expect(screen.queryByText("Offers")).toBeNull();
  expect(screen.queryByText("Offer r1")).toBeNull();
});

test("there is nothing about restaurants on the screen while the server has them off", async () => {
  render(<CustomerHomeScreen {...props()} onOpenRestaurants={jest.fn()} />);
  expect(await screen.findByText("Product p1")).toBeTruthy();
  expect(screen.queryByText("Restaurants")).toBeNull();
  expect(screen.queryByText(/coming soon/i)).toBeNull();
  expect(screen.queryByTestId("home-restaurants")).toBeNull();
});

test("an older server that does not send the flag keeps restaurants hidden", async () => {
  mocked.getPlatformSettings.mockResolvedValue({ substitutionOptionEnabled: true } as never);
  render(<CustomerHomeScreen {...props()} onOpenRestaurants={jest.fn()} />);
  expect(await screen.findByText("Product p1")).toBeTruthy();
  expect(screen.queryByTestId("home-restaurants")).toBeNull();
});

test("when the server opens restaurants, the entry appears at the bottom and opens the restaurant list", async () => {
  mocked.getPlatformSettings.mockResolvedValue({ substitutionOptionEnabled: true, restaurantOrderingEnabled: true });
  const onOpenRestaurants = jest.fn();
  render(<CustomerHomeScreen {...props()} onOpenRestaurants={onOpenRestaurants} />);
  expect(await screen.findByTestId("home-restaurants")).toBeTruthy();
  const [products, restaurants] = renderedOrder(["From JOVO MARKET", "Order from restaurants near you"]);
  expect(products).toBeLessThan(restaurants);
  fireEvent.press(screen.getByText("Order from restaurants near you"));
  expect(onOpenRestaurants).toHaveBeenCalledTimes(1);
});

test("a catalogue that cannot be loaded says so and can be retried, instead of showing placeholders for ever", async () => {
  mocked.getSupermarketCatalog.mockRejectedValueOnce(new Error("offline"));
  render(<CustomerHomeScreen {...props()} />);
  expect(await screen.findByText("We couldn't load the store")).toBeTruthy();
  expect(screen.queryByText("From JOVO MARKET")).toBeNull();
  fireEvent.press(screen.getByText("Try again"));
  expect(await screen.findByText("Product p1")).toBeTruthy();
  expect(screen.queryByText("We couldn't load the store")).toBeNull();
});

test("search opens the catalogue with the keyboard up as soon as the store is known", async () => {
  const handlers = props();
  render(<CustomerHomeScreen {...handlers} />);
  fireEvent.press(screen.getByTestId("home-search"));
  await screen.findByText("Product p1");
  expect(handlers.onOpenCatalog).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }), { focusSearch: true });
});

test("in Arabic the same order holds and the restaurant entry stays hidden", async () => {
  await act(async () => {
    await i18n.changeLanguage("ar");
  });
  try {
    mocked.listActiveRestaurantOffers.mockResolvedValue([offer("o1")]);
    render(<CustomerHomeScreen {...props()} onOpenRestaurants={jest.fn()} />);
    expect(await screen.findByTestId("home-departments")).toBeTruthy();
    const [search, offers, departments, products] = renderedOrder([
      "ابحث عن منتجات أو علامات تجارية أو أقسام",
      "العروض",
      "الأقسام",
      "من جوفو ماركت"
    ]);
    expect(search).toBeGreaterThan(-1);
    expect(search).toBeLessThan(offers);
    expect(offers).toBeLessThan(departments);
    expect(departments).toBeLessThan(products);
    expect(screen.queryByText("المطاعم")).toBeNull();
    expect(screen.queryByText(/قريبًا/)).toBeNull();
  } finally {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  }
});
