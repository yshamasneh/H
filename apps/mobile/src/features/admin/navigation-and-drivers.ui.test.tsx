import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, Share } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import i18n from "../../i18n";
import * as api from "../../core/api";
import { AdminTabBar, resetAdminAccessCache } from "./admin-tabs";
import { AdminCreateDriverScreen, AdminDriverDetailScreen } from "./driver-account-screens";
import { AdminDriversScreen } from "./drivers-screen";
import { AdminMoreScreen } from "./more-screen";

jest.mock("../../core/api", () => ({
  fetchAdminAccess: jest.fn(),
  listAdminDrivers: jest.fn(),
  listAdminDriverCash: jest.fn(),
  approveAdminDriver: jest.fn(),
  rejectAdminDriver: jest.fn(),
  suspendAdminDriver: jest.fn(),
  reactivateAdminDriver: jest.fn(),
  createAdminDriver: jest.fn(),
  getAdminDriver: jest.fn(),
  updateAdminDriver: jest.fn(),
  setAdminDriverPassword: jest.fn(),
  ApiError: class ApiError extends Error {}
}));
jest.mock("../../core/session", () => ({ getAccessToken: jest.fn().mockResolvedValue("token") }));

const mocked = api as jest.Mocked<typeof api>;
const admin = { id: "a1", fullName: "Amal Admin", phone: "+970590000001", role: "ADMIN" as const };
const frame = { x: 0, y: 0, width: 390, height: 844 };
const insets = { top: 0, left: 0, right: 0, bottom: 0 };
const wrap = (node: React.ReactElement) => render(<SafeAreaProvider initialMetrics={{ frame, insets }}>{node}</SafeAreaProvider>);

function driver(overrides: Partial<api.AdminDriver> = {}): api.AdminDriver {
  return {
    userId: "d1",
    fullName: "Samir Driver",
    phone: "+970599123456",
    isActive: true,
    status: "APPROVED",
    isOnline: true,
    completedDeliveriesCount: 12,
    activeDeliveryId: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    ...overrides
  };
}

beforeAll(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  resetAdminAccessCache();
  mocked.fetchAdminAccess.mockResolvedValue({ isSuperAdmin: true, permissions: [] });
});

describe("admin tab bar", () => {
  test("a full administrator gets Home, Orders, Drivers and More", async () => {
    const onNavigate = jest.fn();
    wrap(<AdminTabBar active="home" onNavigate={onNavigate} />);
    await waitFor(() => expect(mocked.fetchAdminAccess).toHaveBeenCalled());
    for (const tab of ["home", "orders", "drivers", "more"]) expect(screen.getByTestId(`admin-tab-${tab}`)).toBeTruthy();
    fireEvent.press(screen.getByTestId("admin-tab-orders"));
    expect(onNavigate).toHaveBeenCalledWith("orders");
  });

  test("tabs follow permissions: no Orders or Drivers tab without them", async () => {
    mocked.fetchAdminAccess.mockResolvedValue({ isSuperAdmin: false, permissions: ["MANAGE_USERS"] });
    wrap(<AdminTabBar active="home" onNavigate={jest.fn()} />);
    await waitFor(() => expect(screen.queryByTestId("admin-tab-orders")).toBeNull());
    expect(screen.queryByTestId("admin-tab-drivers")).toBeNull();
    expect(screen.getByTestId("admin-tab-home")).toBeTruthy();
    expect(screen.getByTestId("admin-tab-more")).toBeTruthy();
  });
});

describe("More", () => {
  function moreProps() {
    return {
      user: admin,
      onLogout: jest.fn().mockResolvedValue(undefined),
      onRestaurants: jest.fn(),
      onCosts: jest.fn(),
      onDriverCash: jest.fn(),
      onProductOffers: jest.fn(),
      onOffers: jest.fn(),
      onUsers: jest.fn(),
      onAnalytics: jest.fn(),
      onAuditLog: jest.fn(),
      onNotifications: jest.fn(),
      onOpenSettings: jest.fn()
    };
  }

  test("sign-out sits at the top, confirmed before it happens", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation((_title, _body, buttons) => {
      buttons?.find((button) => button.style === "destructive")?.onPress?.();
    });
    const props = moreProps();
    wrap(<AdminMoreScreen {...props} />);
    expect(screen.getByText("Amal Admin")).toBeTruthy();
    fireEvent.press(screen.getByText("Sign out"));
    expect(alert).toHaveBeenCalledWith("Sign out?", expect.any(String), expect.any(Array));
    await waitFor(() => expect(props.onLogout).toHaveBeenCalled());
    alert.mockRestore();
  });

  test("every tool is listed once, and only when the account can use it", async () => {
    const props = moreProps();
    wrap(<AdminMoreScreen {...props} />);
    expect(await screen.findByText("Driver cash")).toBeTruthy();
    for (const title of ["Stores", "Cost approvals", "Product offers", "Offers", "Users", "Analytics", "Audit log", "Notifications", "Settings"]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    fireEvent.press(screen.getByText("Cost approvals"));
    expect(props.onCosts).toHaveBeenCalled();
    screen.unmount();

    resetAdminAccessCache();
    mocked.fetchAdminAccess.mockResolvedValue({ isSuperAdmin: false, permissions: ["MANAGE_DRIVERS"] });
    wrap(<AdminMoreScreen {...moreProps()} />);
    await waitFor(() => expect(screen.queryByText("Driver cash")).toBeNull());
    expect(screen.queryByText("Users")).toBeNull();
    expect(screen.queryByText("Analytics")).toBeNull();
    expect(screen.getByText("Sign out")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
  });
});

describe("drivers", () => {
  test("the list searches by name or number and adds a driver from the header", async () => {
    mocked.listAdminDrivers.mockResolvedValue([driver(), driver({ userId: "d2", fullName: "Omar Other", phone: "+970598000000", isOnline: false })]);
    mocked.listAdminDriverCash.mockResolvedValue([]);
    const onAddDriver = jest.fn();
    const onOpenDriver = jest.fn();
    wrap(<AdminDriversScreen onAddDriver={onAddDriver} onOpenDriver={onOpenDriver} tabRoot />);
    expect(await screen.findByText("Samir Driver")).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText("Search name or phone"), "0598");
    expect(screen.queryByText("Samir Driver")).toBeNull();
    expect(screen.getByText("Omar Other")).toBeTruthy();
    fireEvent.press(screen.getByText("Omar Other"));
    expect(onOpenDriver).toHaveBeenCalledWith("d2");
    fireEvent.press(screen.getAllByText("Add driver")[0]);
    expect(onAddDriver).toHaveBeenCalled();
    // No old applications: the pending/rejected filters are not shown.
    expect(screen.queryByText(/Awaiting approval/)).toBeNull();
  });

  test("adding a driver sends name, number and the suggested password, then shows what to hand over", async () => {
    mocked.createAdminDriver.mockResolvedValue(driver({ isOnline: false }));
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" } as never);
    const onCreated = jest.fn();
    wrap(<AdminCreateDriverScreen onBack={jest.fn()} onCreated={onCreated} />);
    expect(screen.getByText("Create driver")).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText("Full name"), "Samir Driver");
    fireEvent.changeText(screen.getByPlaceholderText("059XXXXXXX"), "0599123456");
    const password = screen.getByPlaceholderText("First password").props.value as string;
    expect(password).toMatch(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12}$/);
    fireEvent.press(screen.getByText("Create driver"));
    await waitFor(() =>
      expect(mocked.createAdminDriver).toHaveBeenCalledWith("token", {
        fullName: "Samir Driver",
        countryCode: "+970",
        phoneNumber: "0599123456",
        password
      })
    );
    expect(await screen.findByText("Driver created")).toBeTruthy();
    expect(screen.getByTestId("driver-password")).toHaveTextContent(password);
    fireEvent.press(screen.getByText("Share details"));
    expect(share).toHaveBeenCalledWith({ message: expect.stringContaining(password) });
    fireEvent.press(screen.getByText("Open driver"));
    expect(onCreated).toHaveBeenCalledWith("d1");
    share.mockRestore();
  });

  test("a weak password is refused before it is sent", async () => {
    wrap(<AdminCreateDriverScreen onBack={jest.fn()} onCreated={jest.fn()} />);
    fireEvent.changeText(screen.getByPlaceholderText("Full name"), "Samir Driver");
    fireEvent.changeText(screen.getByPlaceholderText("059XXXXXXX"), "0599123456");
    fireEvent.changeText(screen.getByPlaceholderText("First password"), "weak");
    expect(screen.getByText("Use 8+ characters with upper and lower case, a number and a symbol.")).toBeTruthy();
    fireEvent.press(screen.getByText("Create driver"));
    expect(mocked.createAdminDriver).not.toHaveBeenCalled();
  });

  test("the driver page edits the number, sets a new password and suspends", async () => {
    const detail: api.AdminDriverDetail = {
      ...driver(),
      lastLocationAt: null,
      failedDeliveriesCount: 1,
      recentDeliveries: [
        { deliveryId: "v1", orderId: "abcdef12-0000", status: "DELIVERED", storeName: "JOVO MARKET", totalMinor: 2340, assignedAt: "2026-09-27T10:00:00.000Z", finishedAt: "2026-09-27T10:30:00.000Z" }
      ]
    };
    mocked.getAdminDriver.mockResolvedValue(detail);
    mocked.updateAdminDriver.mockResolvedValue(driver());
    mocked.setAdminDriverPassword.mockResolvedValue({ ok: true });
    mocked.suspendAdminDriver.mockResolvedValue(driver({ status: "SUSPENDED" }));
    const onOpenOrder = jest.fn();
    wrap(<AdminDriverDetailScreen driverUserId="d1" onBack={jest.fn()} onOpenOrder={onOpenOrder} />);
    expect(await screen.findByText("JOVO MARKET")).toBeTruthy();
    expect(screen.getByText("23.40 ILS")).toBeTruthy();
    await waitFor(() => expect(mocked.fetchAdminAccess).toHaveBeenCalled());
    fireEvent.press(screen.getByText("JOVO MARKET"));
    await waitFor(() => expect(onOpenOrder).toHaveBeenCalledWith("abcdef12-0000"));

    fireEvent.press(screen.getByText("Edit name or number"));
    expect(screen.getByPlaceholderText("059XXXXXXX").props.value).toBe("0599123456");
    fireEvent.changeText(screen.getByPlaceholderText("059XXXXXXX"), "0599999999");
    fireEvent.press(screen.getByText("Save"));
    await waitFor(() =>
      expect(mocked.updateAdminDriver).toHaveBeenCalledWith("token", "d1", { fullName: "Samir Driver", countryCode: "+970", phoneNumber: "0599999999" })
    );
    expect(await screen.findByText("Driver details saved.")).toBeTruthy();

    fireEvent.press(screen.getByText("New password"));
    const chosen = screen.getByPlaceholderText("New password").props.value as string;
    fireEvent.press(screen.getByText("Set password"));
    await waitFor(() => expect(mocked.setAdminDriverPassword).toHaveBeenCalledWith("token", "d1", chosen));
    expect(await screen.findByTestId("driver-password")).toHaveTextContent(chosen);

    fireEvent.press(screen.getByText("Suspend"));
    fireEvent.changeText(screen.getByPlaceholderText("Required suspension reason"), "Repeated late deliveries");
    fireEvent.press(screen.getByText("Confirm suspension"));
    await waitFor(() => expect(mocked.suspendAdminDriver).toHaveBeenCalledWith("token", "d1", "Repeated late deliveries"));
  });
});
