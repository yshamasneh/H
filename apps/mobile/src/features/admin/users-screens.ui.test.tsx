import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import i18n from "../../i18n";
import * as api from "../../core/api";
import { AdminCustomerDetailScreen } from "./customer-detail-screen";
import { AdminUsersScreen } from "./users-screen";

jest.mock("../../core/api", () => ({
  listAdminUsers: jest.fn(),
  getAdminCustomerDetail: jest.fn(),
  fetchAdminAccess: jest.fn(),
  setAdminUserActive: jest.fn(),
  createAdminAccount: jest.fn(),
  assignAdminPlatformRole: jest.fn(),
  ApiError: class ApiError extends Error {}
}));
jest.mock("../../core/session", () => ({ getAccessToken: jest.fn().mockResolvedValue("token") }));

const mocked = api as jest.Mocked<typeof api>;
// The phone is wrapped in directional isolates so it stays left to right inside Arabic text.
const shownPhone = (phone: string) => `⁦${phone}⁩`;

const customer = {
  id: "c1",
  fullName: "Lina Customer",
  phone: "+970599111222",
  role: "CUSTOMER" as const,
  isActive: true,
  phoneVerifiedAt: "2026-01-05T09:00:00.000Z",
  createdAt: "2026-01-05T09:00:00.000Z"
};
const staff = [
  { ...customer, id: "d1", fullName: "Driver Dan", phone: "+970599333444", role: "DRIVER" as const },
  { ...customer, id: "a2", fullName: "Admin Two", phone: "+970599555666", role: "ADMIN" as const }
];

beforeAll(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  mocked.fetchAdminAccess.mockResolvedValue({ isSuperAdmin: true, permissions: [] });
  mocked.listAdminUsers.mockImplementation(async (_token, params) => {
    const items = params?.audience === "STAFF" ? staff : [customer];
    return { items, page: 1, pageSize: 20, total: items.length };
  });
});

test("customers and staff are separate lists, each asking the API for its own audience", async () => {
  const onOpenCustomer = jest.fn();
  render(<AdminUsersScreen currentUserId="a1" onBack={() => undefined} onOpenCustomer={onOpenCustomer} />);

  expect(await screen.findByText("Lina Customer")).toBeTruthy();
  expect(screen.getByText(shownPhone("+970599111222"))).toBeTruthy();
  expect(screen.getByText("Registered phone")).toBeTruthy();
  expect(screen.queryByText("Driver Dan")).toBeNull();
  expect(screen.queryByText("Create an administrator")).toBeNull();
  expect(mocked.listAdminUsers).toHaveBeenLastCalledWith("token", expect.objectContaining({ audience: "CUSTOMERS" }));

  fireEvent.press(await screen.findByText("Customer details"));
  expect(onOpenCustomer).toHaveBeenCalledWith("c1");

  fireEvent.press(screen.getByText("Staff & admins"));
  expect(await screen.findByText("Driver Dan")).toBeTruthy();
  expect(screen.queryByText("Lina Customer")).toBeNull();
  expect(screen.getByText("Create an administrator")).toBeTruthy();
  expect(screen.getByText("Make super admin")).toBeTruthy();
  expect(mocked.listAdminUsers).toHaveBeenLastCalledWith("token", expect.objectContaining({ audience: "STAFF" }));
});

test("the detail link and admin tools stay hidden without the permissions the API requires", async () => {
  mocked.fetchAdminAccess.mockResolvedValue({ isSuperAdmin: false, permissions: ["MANAGE_USERS"] });
  render(<AdminUsersScreen currentUserId="a1" onBack={() => undefined} onOpenCustomer={jest.fn()} />);

  expect(await screen.findByText("Lina Customer")).toBeTruthy();
  await waitFor(() => expect(mocked.fetchAdminAccess).toHaveBeenCalled());
  expect(screen.queryByText("Customer details")).toBeNull();

  fireEvent.press(screen.getByText("Staff & admins"));
  expect(await screen.findByText("Driver Dan")).toBeTruthy();
  expect(screen.queryByText("Create an administrator")).toBeNull();
  expect(screen.queryByText("Make super admin")).toBeNull();
});

test("suspending needs a reason and sends it", async () => {
  mocked.setAdminUserActive.mockResolvedValue({ ...customer, isActive: false });
  render(<AdminUsersScreen currentUserId="a1" onBack={() => undefined} onOpenCustomer={jest.fn()} />);

  fireEvent.press(await screen.findByText("Suspend"));
  fireEvent.changeText(screen.getByPlaceholderText("Reason for suspending (required)"), "Abusive calls");
  const confirm = screen.getAllByText("Suspend");
  fireEvent.press(confirm[confirm.length - 1]);
  await waitFor(() => expect(mocked.setAdminUserActive).toHaveBeenCalledWith("token", "c1", false, "Abusive calls"));
});

test("tapping a registered number opens the device dialer with that number", async () => {
  const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  render(<AdminUsersScreen currentUserId="a1" onBack={() => undefined} onOpenCustomer={jest.fn()} />);
  fireEvent.press(await screen.findByText(shownPhone("+970599111222")));
  expect(openURL).toHaveBeenCalledWith("tel:+970599111222");
  openURL.mockRestore();
});

// The API's hand-computed example: 34.23 (sale item + 10 ILS minimum fee) + 53.95 + 28.00.
const detail: api.AdminCustomerDetail = {
  customer,
  deliveredOrdersCount: 3,
  deliveredSpentMinor: 11618,
  ordersCount: 4,
  firstOrderAt: "2026-01-10T12:00:00.000Z",
  orders: [
    { id: "o4", status: "CANCELLED", totalMinor: 7777, createdAt: "2026-09-28T12:00:00.000Z", storeName: "JOVO MARKET", itemsCount: 1 },
    { id: "o3", status: "DELIVERED", totalMinor: 2800, createdAt: "2026-09-27T12:00:00.000Z", storeName: "JOVO MARKET", itemsCount: 1 },
    { id: "o2", status: "DELIVERED", totalMinor: 5395, createdAt: "2026-03-02T12:00:00.000Z", storeName: "JOVO MARKET", itemsCount: 1 },
    { id: "o1", status: "DELIVERED", totalMinor: 3423, createdAt: "2026-01-10T12:00:00.000Z", storeName: "JOVO MARKET", itemsCount: 2 }
  ]
};

test("customer detail shows delivered count, exact lifetime spend and the full history", async () => {
  mocked.getAdminCustomerDetail.mockResolvedValue(detail);
  const onOpenOrder = jest.fn();
  render(<AdminCustomerDetailScreen onBack={() => undefined} onOpenOrder={onOpenOrder} userId="c1" />);

  expect(await screen.findByText("116.18 ILS")).toBeTruthy();
  expect(screen.queryByText("117.00 ILS")).toBeNull(); // never the shekel-rounded cash figure
  expect(screen.getByText("Completed orders")).toBeTruthy();
  expect(screen.getByText("3")).toBeTruthy();
  expect(screen.getByText("4")).toBeTruthy();
  expect(screen.getByText(shownPhone("+970599111222"))).toBeTruthy();
  for (const amount of ["77.77 ILS", "28.00 ILS", "53.95 ILS", "34.23 ILS"]) {
    expect(screen.getByText(amount)).toBeTruthy();
  }
  expect(screen.getAllByText("Yes")).toHaveLength(3);
  expect(screen.getAllByText("No")).toHaveLength(1);
  expect(mocked.getAdminCustomerDetail).toHaveBeenCalledWith("token", "c1");

  fireEvent.press(screen.getByText("34.23 ILS"));
  expect(onOpenOrder).toHaveBeenCalledWith("o1");
});

test("customer detail does not request order history without VIEW_ALL_ORDERS", async () => {
  mocked.fetchAdminAccess.mockResolvedValue({ isSuperAdmin: false, permissions: ["MANAGE_USERS"] });
  render(<AdminCustomerDetailScreen onBack={() => undefined} onOpenOrder={jest.fn()} userId="c1" />);
  expect(
    await screen.findByText("Viewing a customer's order history needs permission to view all orders.")
  ).toBeTruthy();
  expect(mocked.getAdminCustomerDetail).not.toHaveBeenCalled();
});
