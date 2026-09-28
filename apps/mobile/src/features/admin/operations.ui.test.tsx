import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import i18n from "../../i18n";
import * as api from "../../core/api";
import { AdminDashboardScreen } from "./dashboard-screen";
import { AdminDriversScreen } from "./drivers-screen";
import { AdminOrderDetailScreen, AdminOrdersScreen } from "./orders-screen";

jest.mock("../../core/api", () => ({
  fetchAdminAccess: jest.fn(),
  getAdminDashboard: jest.fn(),
  getAdminAccountingOverview: jest.fn(),
  listAdminOrders: jest.fn(),
  getAdminOrder: jest.fn(),
  getAdminOrderTracking: jest.fn(),
  cancelAdminOrder: jest.fn(),
  listAdminDrivers: jest.fn(),
  listAdminDriverCash: jest.fn(),
  approveAdminDriver: jest.fn(),
  rejectAdminDriver: jest.fn(),
  suspendAdminDriver: jest.fn(),
  reactivateAdminDriver: jest.fn(),
  ApiError: class ApiError extends Error {}
}));
jest.mock("../../core/session", () => ({ getAccessToken: jest.fn().mockResolvedValue("token") }));
jest.mock("../../core/socket", () => ({ useRealtimeEvent: () => undefined }));

const mocked = api as jest.Mocked<typeof api>;
const admin = { id: "a1", fullName: "Amal Admin", phone: "+970590000001", role: "ADMIN" as const };

const dashboard: api.AdminDashboard = {
  ordersToday: 12,
  revenueTodayMinor: 45_678,
  activeDeliveries: 2,
  pendingRestaurantApprovals: 1,
  onlineDriversCount: 3,
  newCustomerSignupsToday: 4,
  pendingDriverApprovals: 2,
  ordersAwaitingAcceptance: 5,
  activityFeed: [{ id: "h1", orderId: "o1", restaurantName: "JOVO MARKET", toStatus: "ACCEPTED", createdAt: "2026-09-28T10:00:00.000Z" }]
};
const books = {
  cashOutstandingMinor: 10_600,
  pendingOperatingCostCount: 1,
  ledgerImbalanceMinor: 0,
  costDataIncompleteCount: 0
} as api.AdminAccountingOverview;

function dashboardProps() {
  return {
    user: admin,
    onRestaurants: jest.fn(),
    onOrders: jest.fn(),
    onOpenOrder: jest.fn(),
    onDrivers: jest.fn(),
    onDriverCash: jest.fn(),
    onCosts: jest.fn(),
    onUsers: jest.fn(),
    onNotifications: jest.fn()
  };
}

beforeAll(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  mocked.fetchAdminAccess.mockResolvedValue({ isSuperAdmin: true, permissions: [] });
  mocked.getAdminDashboard.mockResolvedValue(dashboard);
  mocked.getAdminAccountingOverview.mockResolvedValue(books);
});

test("the dashboard leads with what needs attention, each opening the screen that handles it", async () => {
  const props = dashboardProps();
  render(<AdminDashboardScreen {...props} />);
  expect(await screen.findByText("Needs attention")).toBeTruthy();
  expect(await screen.findByText("Orders not yet accepted by the store")).toBeTruthy();
  expect(screen.getByText("106.00 ILS")).toBeTruthy();
  expect(screen.getByText("456.78 ILS")).toBeTruthy(); // today's revenue, exact

  fireEvent.press(screen.getByText("Orders not yet accepted by the store"));
  expect(props.onOrders).toHaveBeenCalledWith("PLACED");
  fireEvent.press(screen.getByText("Stores awaiting approval"));
  expect(props.onRestaurants).toHaveBeenCalledWith("PENDING");
  fireEvent.press(screen.getByText("Drivers awaiting approval"));
  expect(props.onDrivers).toHaveBeenCalledWith("PENDING");
  fireEvent.press(screen.getByText("Cash still held by drivers"));
  expect(props.onDriverCash).toHaveBeenCalled();
  fireEvent.press(screen.getByText("Operating costs awaiting a decision"));
  expect(props.onCosts).toHaveBeenCalled();

  fireEvent.press(screen.getByText("JOVO MARKET"));
  expect(props.onOpenOrder).toHaveBeenCalledWith("o1");
  // Notifications are one tap away in the header; tools and sign-out live under the More tab.
  fireEvent.press(screen.getByLabelText("Notifications"));
  expect(props.onNotifications).toHaveBeenCalled();
  expect(screen.queryByText("Sign out")).toBeNull();
});

test("a ledger problem is shown first and sends the admin to the web console", async () => {
  mocked.getAdminAccountingOverview.mockResolvedValue({ ...books, ledgerImbalanceMinor: 250 });
  render(<AdminDashboardScreen {...dashboardProps()} />);
  expect(await screen.findByText("The ledger does not balance")).toBeTruthy();
  expect(screen.getByText("Investigate on the web console (Accounting)")).toBeTruthy();
});

test("an account only sees the items and tools it can use", async () => {
  mocked.fetchAdminAccess.mockResolvedValue({ isSuperAdmin: false, permissions: ["MANAGE_DRIVERS"] });
  render(<AdminDashboardScreen {...dashboardProps()} />);
  expect(await screen.findByText("Drivers awaiting approval")).toBeTruthy();
  expect(screen.queryByText("Orders not yet accepted by the store")).toBeNull();
  expect(screen.queryByText("Cash still held by drivers")).toBeNull();
  expect(mocked.getAdminAccountingOverview).not.toHaveBeenCalled();
});

test("nothing waiting reads as all clear", async () => {
  mocked.getAdminDashboard.mockResolvedValue({ ...dashboard, pendingRestaurantApprovals: 0, pendingDriverApprovals: 0, ordersAwaitingAcceptance: 0 });
  mocked.getAdminAccountingOverview.mockResolvedValue({ ...books, cashOutstandingMinor: 0, pendingOperatingCostCount: 0 });
  render(<AdminDashboardScreen {...dashboardProps()} />);
  expect(await screen.findByText("Nothing is waiting on you right now.")).toBeTruthy();
});

function order(id: string, status: api.OrderStatusValue = "PLACED"): api.OrderDetail {
  return {
    id,
    status,
    restaurant: { id: "s1", name: `Store ${id}` },
    totalMinor: 2340,
    deliveryAddressLine: "Street",
    createdAt: "2026-09-28T10:00:00.000Z",
    items: [],
    statusHistory: [],
    delivery: null
  } as unknown as api.OrderDetail;
}

test("orders open pre-filtered and more pages load on request", async () => {
  mocked.listAdminOrders
    .mockResolvedValueOnce({ items: [order("1"), order("2")], page: 1, pageSize: 2, total: 3 })
    .mockResolvedValueOnce({ items: [order("3")], page: 2, pageSize: 2, total: 3 });
  render(<AdminOrdersScreen initialFilter="PLACED" onBack={() => undefined} onOpenOrder={() => undefined} />);
  expect(await screen.findByText("Store 1")).toBeTruthy();
  expect(mocked.listAdminOrders).toHaveBeenCalledWith("token", { status: "PLACED", page: 1 });
  fireEvent.press(screen.getByText("Show more (2 of 3)"));
  expect(await screen.findByText("Store 3")).toBeTruthy();
  expect(mocked.listAdminOrders).toHaveBeenLastCalledWith("token", { status: "PLACED", page: 2 });
  expect(screen.queryByText(/Show more/)).toBeNull();
});

test("an order's delivery shows who is driving it, a tap away from a call", async () => {
  mocked.getAdminOrder.mockResolvedValue({
    ...order("o1", "READY_FOR_PICKUP"),
    delivery: { id: "d", status: "ASSIGNED", assignedAt: "2026-09-28T10:05:00.000Z", pickedUpAt: null, onTheWayAt: null, deliveredAt: null }
  } as api.OrderDetail);
  mocked.getAdminOrderTracking.mockResolvedValue({
    orderId: "o1",
    deliveryId: "d",
    deliveryStatus: "ASSIGNED",
    driver: { userId: "dr1", fullName: "Dana Driver", phone: "+970599000111", isOnline: true }
  });
  render(<AdminOrderDetailScreen onBack={() => undefined} orderId="o1" />);
  expect(await screen.findByText("Dana Driver")).toBeTruthy();
  expect(screen.getByText("⁦+970599000111⁩")).toBeTruthy();
  expect(screen.getByText("Delivery")).toBeTruthy();
});

test("without driver management the order still shows, just without the driver", async () => {
  mocked.fetchAdminAccess.mockResolvedValue({ isSuperAdmin: false, permissions: ["VIEW_ALL_ORDERS"] });
  mocked.getAdminOrder.mockResolvedValue(order("o1"));
  render(<AdminOrderDetailScreen onBack={() => undefined} orderId="o1" />);
  expect(await screen.findByText("Store o1")).toBeTruthy();
  await waitFor(() => expect(mocked.fetchAdminAccess).toHaveBeenCalled());
  expect(mocked.getAdminOrderTracking).not.toHaveBeenCalled();
});

const driver = (overrides: Partial<api.AdminDriver>): api.AdminDriver =>
  ({
    userId: "u",
    fullName: "Driver",
    phone: "+970599000999",
    isActive: true,
    status: "APPROVED",
    isOnline: false,
    completedDeliveriesCount: 0,
    activeDeliveryId: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides
  }) as api.AdminDriver;

test("drivers can be narrowed to those awaiting approval, and cash held links to receiving it", async () => {
  mocked.listAdminDrivers.mockResolvedValue([
    driver({ userId: "p", fullName: "Pending Pat", status: "PENDING" }),
    driver({ userId: "o", fullName: "Online Omar", isOnline: true }),
    driver({ userId: "s", fullName: "Suspended Sam", status: "SUSPENDED" })
  ]);
  mocked.listAdminDriverCash.mockResolvedValue([
    { driverUserId: "o", outstandingMinor: 3_500 } as api.AdminDriverCash
  ]);
  const onOpenCash = jest.fn();
  render(<AdminDriversScreen initialFilter="PENDING" onBack={() => undefined} onOpenCash={onOpenCash} />);
  expect(await screen.findByText("Pending Pat")).toBeTruthy();
  expect(screen.queryByText("Online Omar")).toBeNull();
  expect(screen.getByText("Awaiting approval (1)")).toBeTruthy();

  fireEvent.press(screen.getByText("On shift (1)"));
  expect(screen.getByText("Online Omar")).toBeTruthy();
  expect(await screen.findByText("35.00 ILS")).toBeTruthy();
  fireEvent.press(screen.getByText("Receive cash"));
  expect(onOpenCash).toHaveBeenCalledWith("o");
});
