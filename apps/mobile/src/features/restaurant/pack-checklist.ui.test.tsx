import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import i18n from "../../i18n";
import { RestaurantOrderDetailScreen } from "./order-screens";
import { getRestaurantOrder, listRestaurantMenuItems, updateOrderStatus } from "../../core/api";
import { getAccessToken } from "../../core/session";

jest.mock("../../core/api", () => ({
  getRestaurantOrder: jest.fn(),
  listRestaurantMenuItems: jest.fn(),
  listRestaurantOrders: jest.fn(),
  proposeOrderItemFulfillment: jest.fn(),
  updateOrderStatus: jest.fn()
}));
jest.mock("../../core/session", () => ({ getAccessToken: jest.fn() }));
jest.mock("../../core/socket", () => ({ useOrderRealtime: () => {}, useRealtimeEvent: () => {} }));
// An in-mockMemory stand-in for the device's storage, shared across renders so persistence is testable.
const mockMemory = new Map<string, string>();
jest.mock("../../core/kv-storage", () => ({
  kvStore: {
    getItem: async (key: string) => mockMemory.get(key) ?? null,
    setItem: async (key: string, value: string) => { mockMemory.set(key, value); },
    removeItem: async (key: string) => { mockMemory.delete(key); }
  }
}));

const line = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  menuItemId: `menu-${id}`,
  nameSnapshot: name,
  priceMinorSnapshot: 500,
  imageUrl: `https://cdn.example/${id}.jpg`,
  quantity: 2,
  unitLabelSnapshot: "item",
  allowSubstitution: true,
  isVariableWeightSnapshot: false,
  lineTotalMinor: 1000,
  fulfillmentAdjustment: null,
  ...extra
});

const approvedReplacement = {
  id: "adj-1",
  replacementMenuItemId: "menu-oat",
  replacementNameSnapshot: "Oat milk",
  replacementUnitLabelSnapshot: "item",
  replacementImageUrl: "https://cdn.example/oat.jpg",
  actualQuantityMilli: 2000,
  unitPriceMinor: 700,
  lineTotalMinor: 1400,
  status: "APPROVED",
  note: null,
  decidedAt: null,
  updatedAt: "2026-09-26T10:00:00Z"
};

function order(status: string, items: unknown[]) {
  return {
    id: "order-1",
    status,
    createdAt: "2026-09-26T10:00:00Z",
    totalMinor: 3000,
    deliveryLabel: "Home",
    deliveryAddressLine: "Somewhere",
    statusHistory: [],
    items
  };
}

const threeLines = () => [
  line("a", "Whole milk"),
  line("b", "Cow milk", { fulfillmentAdjustment: approvedReplacement }),
  line("c", "Bread")
];

const readyLabel = () => i18n.t("restaurantOps:orders.markReadyForPickup");

async function open(next: unknown) {
  (getRestaurantOrder as jest.Mock).mockResolvedValue(next);
  render(<RestaurantOrderDetailScreen onBack={() => {}} orderId="order-1" />);
  await screen.findByText(i18n.t("restaurantOps:orders.pack.title"));
}

beforeAll(async () => {
  await act(async () => { await i18n.changeLanguage("en"); });
});
afterAll(async () => {
  await act(async () => { await i18n.changeLanguage("ar"); });
});
beforeEach(() => {
  jest.clearAllMocks();
  mockMemory.clear();
  (getAccessToken as jest.Mock).mockResolvedValue("token");
  (listRestaurantMenuItems as jest.Mock).mockResolvedValue([]);
});

test("each item shows its product photo, and an approved replacement shows the replacement's", async () => {
  await open(order("PREPARING", threeLines()));
  const uris = screen.UNSAFE_getAllByType(require("react-native").Image).map((image: { props: { source: { uri?: string } } }) => image.props.source?.uri);
  expect(uris).toContain("https://cdn.example/a.jpg");
  expect(uris).toContain("https://cdn.example/oat.jpg");
  expect(uris).not.toContain("https://cdn.example/b.jpg");
});

test("Mark ready is disabled until every item is checked, then works", async () => {
  (updateOrderStatus as jest.Mock).mockResolvedValue(order("READY_FOR_PICKUP", threeLines()));
  await open(order("PREPARING", threeLines()));

  await act(async () => { fireEvent.press(screen.getByText(readyLabel())); });
  expect(updateOrderStatus).not.toHaveBeenCalled();
  expect(screen.getByText(/3 item\(s\) still to pack/)).toBeTruthy();

  const boxes = screen.getAllByRole("checkbox");
  expect(boxes).toHaveLength(3);
  await act(async () => { fireEvent.press(boxes[0]); });
  await act(async () => { fireEvent.press(boxes[1]); });
  expect(screen.getByText("Packed 2 of 3")).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText(readyLabel())); });
  expect(updateOrderStatus).not.toHaveBeenCalled();

  await act(async () => { fireEvent.press(boxes[2]); });
  expect(screen.getByText(i18n.t("restaurantOps:orders.pack.allPacked"))).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText(readyLabel())); });
  await waitFor(() => expect(updateOrderStatus).toHaveBeenCalledWith("token", "order-1", "READY_FOR_PICKUP"));
});

test("an approved replacement reads as a replacement, not as a plain pick", async () => {
  await open(order("PREPARING", threeLines()));
  expect(screen.getByText("Oat milk")).toBeTruthy();
  expect(screen.getByText(/Replaces: Cow milk/)).toBeTruthy();
  const replacementBox = screen.getAllByRole("checkbox")[1];
  await act(async () => { fireEvent.press(replacementBox); });
  // Still identifiable as a replacement once ticked, and counted as packed.
  expect(screen.getByText(i18n.t("restaurantOps:orders.pack.replacementTag") + " ")).toBeTruthy();
  expect(screen.getByText("Packed 1 of 3")).toBeTruthy();
});

test("a line still waiting on the customer is flagged and cannot be ticked", async () => {
  const pending = { ...approvedReplacement, status: "PENDING" };
  (getRestaurantOrder as jest.Mock).mockResolvedValue(order("PLACED", [line("a", "Whole milk", { fulfillmentAdjustment: pending })]));
  render(<RestaurantOrderDetailScreen onBack={() => {}} orderId="order-1" />);
  await screen.findByText(i18n.t("restaurantOps:orders.pack.awaitingCustomer"));
  const row = screen.getByRole("checkbox");
  expect(row.props.accessibilityState.disabled).toBe(true);
  expect(row.props.accessibilityState.checked).toBe(false);
});

test("ticked items are remembered when the screen is reopened", async () => {
  await open(order("PREPARING", threeLines()));
  await act(async () => { fireEvent.press(screen.getAllByRole("checkbox")[0]); });
  expect(mockMemory.size).toBe(1);

  screen.unmount();
  await open(order("PREPARING", threeLines()));
  await waitFor(() => expect(screen.getByText("Packed 1 of 3")).toBeTruthy());
  expect(screen.getAllByRole("checkbox")[0].props.accessibilityState.checked).toBe(true);
});

test("'Mark ready anyway' names what is unchecked and only proceeds when confirmed", async () => {
  (updateOrderStatus as jest.Mock).mockResolvedValue(order("READY_FOR_PICKUP", threeLines()));
  const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  await open(order("PREPARING", threeLines()));
  await act(async () => { fireEvent.press(screen.getAllByRole("checkbox")[0]); });

  await act(async () => { fireEvent.press(screen.getByText(i18n.t("restaurantOps:orders.pack.readyAnyway"))); });
  expect(alertSpy).toHaveBeenCalledTimes(1);
  const [, body, buttons] = alertSpy.mock.calls[0];
  expect(body).toContain("Cow milk");
  expect(body).toContain("Bread");
  expect(body).not.toContain("Whole milk");
  expect(updateOrderStatus).not.toHaveBeenCalled();

  // Cancelling leaves the order where it was.
  await act(async () => { buttons![0].onPress!(); });
  expect(updateOrderStatus).not.toHaveBeenCalled();

  // Confirming marks it ready.
  await act(async () => { fireEvent.press(screen.getByText(i18n.t("restaurantOps:orders.pack.readyAnyway"))); });
  await act(async () => { alertSpy.mock.calls[1][2]![1].onPress!(); });
  await waitFor(() => expect(updateOrderStatus).toHaveBeenCalledWith("token", "order-1", "READY_FOR_PICKUP"));
  alertSpy.mockRestore();
});

test("Start preparing is not gated: only the hand-off to a driver waits for the checklist", async () => {
  (updateOrderStatus as jest.Mock).mockResolvedValue(order("PREPARING", threeLines()));
  await open(order("ACCEPTED", threeLines()));
  await act(async () => { fireEvent.press(screen.getByText(i18n.t("restaurantOps:orders.startPreparing"))); });
  await waitFor(() => expect(updateOrderStatus).toHaveBeenCalledWith("token", "order-1", "PREPARING"));
});
