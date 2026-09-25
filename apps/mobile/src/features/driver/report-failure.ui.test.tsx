import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "../../i18n";
import { DeliveryDetailScreen } from "./screens";

/**
 * A driver holding a delivery they cannot complete must be able to say so. Until this existed the
 * app offered no way to report a failure, and because acceptDelivery allows only one active
 * delivery at a time (DELIVERY_DRIVER_HAS_ACTIVE), such a driver could never take any further work.
 */
const mockUpdateStatus = jest.fn();
const mockListMine = jest.fn();

jest.mock("../../core/api", () => ({
  ...jest.requireActual("../../core/api"),
  listMyDeliveries: (...args: unknown[]) => mockListMine(...args),
  updateDeliveryStatus: (...args: unknown[]) => mockUpdateStatus(...args),
  listLandmarks: jest.fn().mockResolvedValue([]),
  getDriverCashSummary: jest.fn().mockResolvedValue({ balance: { cashOwedToPlatformMinor: 0, unsettledOrderCount: 0 } })
}));
jest.mock("../../core/session", () => ({ getAccessToken: jest.fn().mockResolvedValue("token") }));
jest.mock("../../core/location", () => ({ getCurrentCoordinates: jest.fn().mockRejectedValue(new Error("no gps")) }));
jest.mock("./location-tracking", () => ({ useDriverLocationTracking: () => undefined }));
jest.mock("./use-background-location", () => ({
  useBackgroundLocation: () => ({ ensure: jest.fn().mockResolvedValue(true), disclosure: null })
}));

const delivery = (status: string, extra: Record<string, unknown> = {}) => ({
  id: "delivery-1",
  status,
  order: {
    id: "order-1",
    deliveryLabel: "Home",
    deliveryAddressLine: "Biddu main street",
    totalMinor: 1275,
    cashDueMinor: 1300,
    cashRoundingMinor: 25,
    paymentMethod: "CASH",
    latitude: null,
    longitude: null
  },
  restaurant: { id: "store-1", name: "JOVO MARKET", addressLine: "Rukab Street", latitude: null, longitude: null },
  assignedAt: null,
  pickedUpAt: null,
  onTheWayAt: null,
  deliveredAt: null,
  createdAt: "2026-09-25T10:00:00.000Z",
  ...extra
});

beforeAll(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

beforeEach(() => {
  mockUpdateStatus.mockReset();
  mockListMine.mockReset();
});

test("a driver who cannot finish a delivery reports it with a reason, which is what the API requires", async () => {
  mockListMine.mockResolvedValue({ items: [delivery("ASSIGNED")], page: 1, pageSize: 50, total: 1 });
  mockUpdateStatus.mockResolvedValue(delivery("FAILED", { failureReason: "CUSTOMER_UNREACHABLE" }));

  render(<DeliveryDetailScreen deliveryId="delivery-1" onBack={() => undefined} />);

  // The picker is deliberately a second step, so failing a job is never one mistaken tap.
  const open = await screen.findByText("Can't complete this delivery");
  await act(async () => fireEvent.press(open));

  await act(async () => fireEvent.press(screen.getByText("Customer did not answer")));

  expect(mockUpdateStatus).toHaveBeenCalledWith("token", "delivery-1", "FAILED", {
    failureReason: "CUSTOMER_UNREACHABLE"
  });
  expect(screen.getByText("Delivery reported as failed")).toBeTruthy();
});

test("a delivered delivery offers no failure option, so a finished job cannot be undone from here", async () => {
  mockListMine.mockResolvedValue({ items: [delivery("DELIVERED")], page: 1, pageSize: 50, total: 1 });

  render(<DeliveryDetailScreen deliveryId="delivery-1" onBack={() => undefined} />);

  await screen.findByText("This delivery is complete.");
  expect(screen.queryByText("Can't complete this delivery")).toBeNull();
});
