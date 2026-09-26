import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import i18n from "../../i18n";
import { ToastProvider } from "../../components/toast";
import { getRestaurantLiveOrders, updateOrderStatus } from "../../core/api";
import { ApiError } from "../../core/api-error";
import { StoreLiveQueueProvider } from "./store-live-queue";

jest.mock("../../core/api", () => ({
  getRestaurantLiveOrders: jest.fn(),
  updateOrderStatus: jest.fn(),
  ApiError: jest.requireActual("../../core/api-error").ApiError
}));
jest.mock("../../core/session", () => ({ getAccessToken: jest.fn(async () => "token") }));
// The test plays the server: it pushes socket events through these handlers.
const mockHandlers = new Map<string, () => void>();
jest.mock("../../core/socket", () => ({
  useRealtimeEvent: (event: string, handler: () => void) => {
    mockHandlers.set(event, handler);
  }
}));
// Sound is a device concern; here we only check the provider asks for it while an order is NEW.
const mockSoundActive: boolean[] = [];
jest.mock("../../core/order-alert-sound", () => ({
  useOrderAlertSound: (active: boolean) => {
    mockSoundActive.push(active);
    return { state: "on", arm: jest.fn(), mute: jest.fn() };
  }
}));

const newOrder = {
  id: "abcdef12-0000-0000-0000-000000000000",
  status: "PLACED",
  createdAt: new Date().toISOString(),
  totalMinor: 8890,
  items: [
    { id: "l1", quantity: 2, imageUrl: null },
    { id: "l2", quantity: 1, imageUrl: null }
  ]
};
const queue = (orders: unknown[]) => ({
  business: { id: "b", name: "JOVO MARKET", businessType: "SUPERMARKET", isOpen: true },
  new: orders,
  inProgress: [],
  ready: [],
  serverTime: new Date().toISOString()
});

function renderHost(viewingOrderId: string | null = null) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
    <ToastProvider>
      <StoreLiveQueueProvider onOpenBoard={jest.fn()} onOpenOrder={jest.fn()} userId="owner-1" viewingOrderId={viewingOrderId}>
        <Text>catalogue screen</Text>
      </StoreLiveQueueProvider>
    </ToastProvider>
    </SafeAreaProvider>
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockHandlers.clear();
  mockSoundActive.length = 0;
  await i18n.changeLanguage("en");
});

test("a new order shows the popup over the current screen with its number, item count and total", async () => {
  (getRestaurantLiveOrders as jest.Mock).mockResolvedValue(queue([newOrder]));
  renderHost();

  expect(await screen.findByText("New order")).toBeTruthy();
  expect(screen.getByText("catalogue screen")).toBeTruthy();
  expect(screen.getByText("#ABCDEF12")).toBeTruthy();
  expect(screen.getByText("3 items")).toBeTruthy();
  expect(screen.getByText("88.90 ₪")).toBeTruthy();
  expect(mockSoundActive.at(-1)).toBe(true);
});

test("accepting from the popup accepts the order and silences the alert", async () => {
  (getRestaurantLiveOrders as jest.Mock).mockResolvedValueOnce(queue([newOrder])).mockResolvedValue(queue([]));
  (updateOrderStatus as jest.Mock).mockResolvedValue({ ...newOrder, status: "ACCEPTED" });
  renderHost();

  fireEvent.press(await screen.findByText("Accept order"));

  await waitFor(() => expect(updateOrderStatus).toHaveBeenCalledWith("token", newOrder.id, "ACCEPTED"));
  await waitFor(() => expect(screen.queryByText("New order")).toBeNull());
  expect(mockSoundActive.at(-1)).toBe(false);
});

test("an accept made on another device (a status event) closes the popup and stops the sound here", async () => {
  (getRestaurantLiveOrders as jest.Mock).mockResolvedValueOnce(queue([newOrder]));
  renderHost();
  expect(await screen.findByText("New order")).toBeTruthy();

  (getRestaurantLiveOrders as jest.Mock).mockResolvedValue(queue([]));
  await act(async () => mockHandlers.get("order.status.changed")?.());

  await waitFor(() => expect(screen.queryByText("New order")).toBeNull());
  expect(mockSoundActive.at(-1)).toBe(false);
  expect(updateOrderStatus).not.toHaveBeenCalled();
});

test("losing the race to another device is reported as already handled, not as an error", async () => {
  (getRestaurantLiveOrders as jest.Mock).mockResolvedValueOnce(queue([newOrder])).mockResolvedValue(queue([]));
  (updateOrderStatus as jest.Mock).mockRejectedValue(new ApiError(409, "INVALID_STATUS_TRANSITION", "nope"));
  renderHost();

  fireEvent.press(await screen.findByText("Accept order"));

  expect(await screen.findByText("Order #ABCDEF12 was already handled on another device")).toBeTruthy();
});

test("the popup stays out of the way on that order's own screen", async () => {
  (getRestaurantLiveOrders as jest.Mock).mockResolvedValue(queue([newOrder]));
  renderHost(newOrder.id);

  await waitFor(() => expect(getRestaurantLiveOrders).toHaveBeenCalled());
  expect(screen.queryByText("New order")).toBeNull();
  expect(mockSoundActive.at(-1)).toBe(true);
});
