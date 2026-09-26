import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import i18n from "../../i18n";
import { RestaurantOrderDetailScreen } from "./order-screens";
import { getRestaurantOrder, listRestaurantMenuItems, setOrderItemPicked, updateOrderStatus } from "../../core/api";
import { ApiError } from "../../core/api-error";
import { getAccessToken } from "../../core/session";

jest.mock("../../core/api", () => ({
  getRestaurantOrder: jest.fn(),
  listRestaurantMenuItems: jest.fn(),
  listRestaurantOrders: jest.fn(),
  proposeOrderItemFulfillment: jest.fn(),
  setOrderItemPicked: jest.fn(),
  updateOrderStatus: jest.fn(),
  ApiError: jest.requireActual("../../core/api-error").ApiError
}));
jest.mock("../../core/session", () => ({ getAccessToken: jest.fn() }));
// The screen subscribes to live events; the test plays the part of the server pushing one.
const mockHandlers = new Map<string, (payload: unknown) => void>();
jest.mock("../../core/socket", () => ({
  useOrderRealtime: () => {},
  useRealtimeEvent: (event: string, handler: (payload: unknown) => void) => { mockHandlers.set(event, handler); }
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
  isPicked: false,
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
const withFirstTwoPicked = () => threeLines().map((entry, index) => (index < 2 ? { ...entry, isPicked: true } : entry));

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
  mockHandlers.clear();
  (getAccessToken as jest.Mock).mockResolvedValue("token");
  (listRestaurantMenuItems as jest.Mock).mockResolvedValue([]);
  (setOrderItemPicked as jest.Mock).mockResolvedValue({});
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
  await act(async () => { fireEvent.press(screen.getAllByRole("checkbox")[1]); });
  expect(screen.getByText(i18n.t("restaurantOps:orders.pack.replacementTag") + " ")).toBeTruthy();
  expect(screen.getByText("Packed 1 of 3")).toBeTruthy();
});

test("a line still waiting on the customer is flagged, cannot be ticked, and sends nothing", async () => {
  const pending = { ...approvedReplacement, status: "PENDING" };
  (getRestaurantOrder as jest.Mock).mockResolvedValue(order("PLACED", [line("a", "Whole milk", { fulfillmentAdjustment: pending })]));
  render(<RestaurantOrderDetailScreen onBack={() => {}} orderId="order-1" />);
  await screen.findByText(i18n.t("restaurantOps:orders.pack.awaitingCustomer"));
  const row = screen.getByRole("checkbox");
  expect(row.props.accessibilityState.disabled).toBe(true);
  await act(async () => { fireEvent.press(row); });
  expect(setOrderItemPicked).not.toHaveBeenCalled();
});

test("ticking sends the absolute value to the server for that line", async () => {
  await open(order("PREPARING", threeLines()));
  await act(async () => { fireEvent.press(screen.getAllByRole("checkbox")[0]); });
  expect(setOrderItemPicked).toHaveBeenCalledWith("token", "order-1", "a", true);
  await act(async () => { fireEvent.press(screen.getAllByRole("checkbox")[0]); });
  expect(setOrderItemPicked).toHaveBeenLastCalledWith("token", "order-1", "a", false);
});

test("what the server already has ticked is what the screen shows, so a second device starts in the right place", async () => {
  await open(order("PREPARING", withFirstTwoPicked()));
  expect(screen.getByText("Packed 2 of 3")).toBeTruthy();
  const boxes = screen.getAllByRole("checkbox");
  expect(boxes.map((box) => box.props.accessibilityState.checked)).toEqual([true, true, false]);
});

test("a tick made on another device shows up live, with no refetch, and can complete the checklist", async () => {
  (updateOrderStatus as jest.Mock).mockResolvedValue(order("READY_FOR_PICKUP", threeLines()));
  await open(order("PREPARING", withFirstTwoPicked()));
  expect(screen.getByText("Packed 2 of 3")).toBeTruthy();
  const callsBefore = (getRestaurantOrder as jest.Mock).mock.calls.length;

  await act(async () => { mockHandlers.get("order.packing.changed")!({ orderId: "order-1", orderItemId: "c", isPicked: true }); });

  expect(screen.getByText(i18n.t("restaurantOps:orders.pack.allPacked"))).toBeTruthy();
  expect((getRestaurantOrder as jest.Mock).mock.calls.length).toBe(callsBefore);
  await act(async () => { fireEvent.press(screen.getByText(readyLabel())); });
  await waitFor(() => expect(updateOrderStatus).toHaveBeenCalledWith("token", "order-1", "READY_FOR_PICKUP"));
});

test("a live event for another order, or a malformed one, is ignored", async () => {
  await open(order("PREPARING", threeLines()));
  await act(async () => {
    mockHandlers.get("order.packing.changed")!({ orderId: "someone-else", orderItemId: "a", isPicked: true });
    mockHandlers.get("order.packing.changed")!({ orderId: "order-1", orderItemId: "a" });
    mockHandlers.get("order.packing.changed")!(null);
  });
  expect(screen.getByText("Packed 0 of 3")).toBeTruthy();
});

test("if the server refuses a tick, it is undone", async () => {
  (setOrderItemPicked as jest.Mock).mockRejectedValue(new ApiError(409, "ORDER_NOT_BEING_PACKED", "no"));
  await open(order("PREPARING", threeLines()));
  await act(async () => { fireEvent.press(screen.getAllByRole("checkbox")[0]); });
  await waitFor(() => expect(screen.getByText("Packed 0 of 3")).toBeTruthy());
  expect(screen.getAllByRole("checkbox")[0].props.accessibilityState.checked).toBe(false);
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

  await act(async () => { buttons![0].onPress!(); });
  expect(updateOrderStatus).not.toHaveBeenCalled();

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
