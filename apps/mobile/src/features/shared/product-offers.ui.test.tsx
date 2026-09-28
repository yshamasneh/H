import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { Alert } from "react-native";
import i18n from "../../i18n";
import * as api from "../../core/api";
import { AdminProductOffersScreen } from "../admin/product-offers-screen";
import { RestaurantOffersScreen } from "../restaurant/offers-screen";

jest.mock("../../core/api", () => ({
  fetchAdminAccess: jest.fn(),
  listRestaurantMenuCategories: jest.fn(),
  listRestaurantMenuItems: jest.fn(),
  updateRestaurantMenuItem: jest.fn(),
  listAdminRestaurants: jest.fn(),
  listAdminStoreMenuCategories: jest.fn(),
  listAdminStoreMenuItems: jest.fn(),
  updateAdminStoreMenuItem: jest.fn(),
  ApiError: class ApiError extends Error {}
}));
jest.mock("../../core/session", () => ({ getAccessToken: jest.fn().mockResolvedValue("token") }));

const mocked = api as jest.Mocked<typeof api>;

function product(overrides: Partial<api.MenuItemOwner>): api.MenuItemOwner {
  return {
    id: "p",
    categoryId: "dairy",
    name: "Product",
    description: null,
    priceMinor: 2000,
    salePriceMinor: null,
    costPriceMinor: null,
    imageUrl: null,
    sku: null,
    barcode: null,
    brand: null,
    unitLabel: "item",
    isAvailable: true,
    ...overrides
  } as api.MenuItemOwner;
}

const milk = product({ id: "milk", name: "Fresh milk", sku: "MLK-1", priceMinor: 2000, salePriceMinor: 1000, imageUrl: "https://cdn.example/milk.jpg" });
const bread = product({ id: "bread", name: "Bread", categoryId: "bakery", priceMinor: 2000 });
const cheese = product({ id: "cheese", name: "Cheese", priceMinor: 10_000, salePriceMinor: 7000, costPriceMinor: 8000 });
const categories: api.MenuCategoryOwner[] = [
  { id: "dairy", name: "Dairy", sortOrder: 0, isActive: true },
  { id: "bakery", name: "Bakery", sortOrder: 1, isActive: true }
];
const manager = { isSuperAdmin: false, permissions: ["MANAGE_PRODUCTS", "MANAGE_PRICES"] };

beforeAll(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  mocked.fetchAdminAccess.mockResolvedValue(manager);
  mocked.listRestaurantMenuItems.mockResolvedValue([bread, milk, cheese]);
  mocked.listRestaurantMenuCategories.mockResolvedValue(categories);
});

test("running offers come first with the discount worked out from the two prices", async () => {
  render(<RestaurantOffersScreen onBack={() => undefined} />);
  const milkRow = await screen.findByTestId("offer-row-milk");
  expect(within(milkRow).getByText("−50%")).toBeTruthy();
  expect(within(milkRow).getByText("20.00 ILS")).toBeTruthy();
  expect(within(milkRow).getByText("10.00 ILS")).toBeTruthy();
  expect(within(screen.getByTestId("offer-row-cheese")).getByText("−30%")).toBeTruthy();
  expect(within(screen.getByTestId("offer-row-cheese")).getByText("Below cost")).toBeTruthy();
  // No offer: one price and no sticker.
  const breadRow = screen.getByTestId("offer-row-bread");
  expect(within(breadRow).queryByText(/%/)).toBeNull();
  expect(within(breadRow).getByText("Add offer")).toBeTruthy();
  expect(screen.getByText("On offer (2)")).toBeTruthy();
});

test("search finds a product by SKU and by category", async () => {
  render(<RestaurantOffersScreen onBack={() => undefined} />);
  await screen.findByTestId("offer-row-milk");
  fireEvent.changeText(screen.getByPlaceholderText("Search by name, SKU, barcode, brand or category"), "mlk");
  expect(screen.getByTestId("offer-row-milk")).toBeTruthy();
  expect(screen.queryByTestId("offer-row-bread")).toBeNull();
  fireEvent.changeText(screen.getByPlaceholderText("Search by name, SKU, barcode, brand or category"), "bakery");
  expect(screen.getByTestId("offer-row-bread")).toBeTruthy();
  expect(screen.queryByTestId("offer-row-milk")).toBeNull();
});

test("the manager types only the offer price; the discount follows and is saved as salePriceMinor", async () => {
  mocked.updateRestaurantMenuItem.mockResolvedValue({ ...bread, salePriceMinor: 1500 });
  render(<RestaurantOffersScreen onBack={() => undefined} />);
  fireEvent.press(await screen.findByTestId("offer-row-bread"));
  const input = screen.getByTestId("offer-price-input");
  fireEvent.changeText(input, "20");
  expect(screen.getByText("The offer price must be lower than the regular price.")).toBeTruthy();
  fireEvent.changeText(input, "15");
  expect(screen.getByTestId("offer-live-percent")).toHaveTextContent("−25%");
  expect(screen.getByText("Save 25%")).toBeTruthy(); // the customer's own sticker, previewed
  fireEvent.press(screen.getByText("Start offer"));
  await waitFor(() => expect(mocked.updateRestaurantMenuItem).toHaveBeenCalledWith("token", "bread", { salePriceMinor: 1500 }));
  expect(await screen.findByText("Offer saved for Bread.")).toBeTruthy();
  expect(within(screen.getByTestId("offer-row-bread")).getByText("−25%")).toBeTruthy();
});

test("ending an offer is confirmed, then the product is back at its regular price", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation((_title, _body, buttons) => {
    buttons?.find((button) => button.style === "destructive")?.onPress?.();
  });
  mocked.updateRestaurantMenuItem.mockResolvedValue({ ...milk, salePriceMinor: null });
  render(<RestaurantOffersScreen onBack={() => undefined} />);
  fireEvent.press(await screen.findByTestId("offer-row-milk"));
  expect(screen.getByTestId("offer-price-input").props.value).toBe("10.00");
  fireEvent.press(screen.getAllByText("End offer")[0]);
  expect(alert).toHaveBeenCalledWith("End this offer?", "Fresh milk goes back to its regular price of 20.00 ILS.", expect.any(Array));
  await waitFor(() => expect(mocked.updateRestaurantMenuItem).toHaveBeenCalledWith("token", "milk", { salePriceMinor: null }));
  const milkRow = await screen.findByTestId("offer-row-milk");
  await waitFor(() => expect(within(milkRow).queryByText("−50%")).toBeNull());
  expect(within(screen.getByTestId("offer-row-milk")).getByText("20.00 ILS")).toBeTruthy();
  alert.mockRestore();
});

test("staff without the manage-prices permission see offers read-only", async () => {
  mocked.fetchAdminAccess.mockResolvedValue({ isSuperAdmin: false, permissions: ["MANAGE_PRODUCTS"] });
  render(<RestaurantOffersScreen onBack={() => undefined} />);
  await screen.findByTestId("offer-row-milk");
  expect(screen.getByText("You can see the offers, but changing prices needs the manage-prices permission.")).toBeTruthy();
  expect(screen.queryByText("Add offer")).toBeNull();
  fireEvent.press(screen.getByTestId("offer-row-bread"));
  expect(screen.queryByTestId("offer-price-input")).toBeNull();
});

test("a failed load offers a retry", async () => {
  mocked.listRestaurantMenuItems.mockRejectedValueOnce(new Error("offline"));
  render(<RestaurantOffersScreen onBack={() => undefined} />);
  fireEvent.press(await screen.findByText("Retry"));
  expect(await screen.findByTestId("offer-row-milk")).toBeTruthy();
});

test("an administrator edits a store's offers through the admin store routes", async () => {
  mocked.fetchAdminAccess.mockResolvedValue({ isSuperAdmin: false, permissions: ["MANAGE_BUSINESSES"] });
  mocked.listAdminRestaurants.mockResolvedValue({
    items: [
      { id: "r1", name: "Burger Place", businessType: "RESTAURANT" } as api.AdminRestaurant,
      { id: "s1", name: "JOVO Market", businessType: "SUPERMARKET" } as api.AdminRestaurant
    ],
    page: 1,
    pageSize: 50,
    total: 2
  });
  mocked.listAdminStoreMenuItems.mockResolvedValue([bread]);
  mocked.listAdminStoreMenuCategories.mockResolvedValue(categories);
  mocked.updateAdminStoreMenuItem.mockResolvedValue({ ...bread, salePriceMinor: 1000 });
  render(<AdminProductOffersScreen onBack={() => undefined} />);
  fireEvent.press(await screen.findByTestId("offer-row-bread"));
  // The supermarket is picked first.
  expect(mocked.listAdminStoreMenuItems).toHaveBeenCalledWith("token", "s1");
  fireEvent.press(screen.getByText("−50%"));
  expect(screen.getByTestId("offer-price-input").props.value).toBe("10.00");
  fireEvent.press(screen.getByText("Start offer"));
  await waitFor(() => expect(mocked.updateAdminStoreMenuItem).toHaveBeenCalledWith("token", "s1", "bread", { salePriceMinor: 1000 }));
});
