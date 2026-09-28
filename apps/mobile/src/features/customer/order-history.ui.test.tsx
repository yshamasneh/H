import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "../../i18n";
import * as api from "../../core/api";
import { OrderHistoryScreen } from "./cart-screens";

jest.mock("../../core/api", () => ({
  listMyOrders: jest.fn(),
  orderPaymentMethods: ["CASH"],
  ApiError: class ApiError extends Error {}
}));
jest.mock("../../core/session", () => ({ getAccessToken: jest.fn().mockResolvedValue("token") }));
jest.mock("../../core/socket", () => ({ useOrderRealtime: () => undefined }));
jest.mock("../../components/location-map", () => ({ LocationMap: () => null }));

const mocked = api as jest.Mocked<typeof api>;

function order(id: string, status: string, createdAt: string): api.OrderDetail {
  return {
    id,
    status,
    createdAt,
    totalMinor: 3423,
    restaurant: { id: "s1", name: "JOVO MARKET" },
    items: [{ id: `${id}-1`, quantity: 2 }, { id: `${id}-2`, quantity: 1 }]
  } as unknown as api.OrderDetail;
}

beforeAll(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

test("orders on the way come first, each with its number and item count, and older ones load on scroll", async () => {
  mocked.listMyOrders
    .mockResolvedValueOnce({ items: [order("aaaaaaaa-1", "PREPARING", "2026-09-28T10:00:00Z"), order("bbbbbbbb-2", "DELIVERED", "2026-09-20T10:00:00Z")], page: 1, pageSize: 20, total: 3 })
    .mockResolvedValueOnce({ items: [order("cccccccc-3", "CANCELLED", "2026-09-01T10:00:00Z")], page: 2, pageSize: 20, total: 3 });
  const onOpenOrder = jest.fn();
  render(<OrderHistoryScreen onBack={() => undefined} onBrowse={() => undefined} onOpenOrder={onOpenOrder} />);

  expect(await screen.findByText("On the way")).toBeTruthy();
  expect(screen.getByText("Past orders")).toBeTruthy();
  expect(screen.getByText(/#AAAAAAAA · .* · 3 items/)).toBeTruthy();
  expect(screen.getByText("Track order")).toBeTruthy();
  expect(screen.getAllByText("34.23 ILS")).toHaveLength(2);

  const list = screen.UNSAFE_getByType(require("react-native").SectionList);
  await act(async () => {
    list.props.onEndReached();
  });
  expect(await screen.findByText(/#CCCCCCCC/)).toBeTruthy();
  expect(mocked.listMyOrders).toHaveBeenLastCalledWith("token", 2, 20);

  fireEvent.press(screen.getByText(/#AAAAAAAA/));
  expect(onOpenOrder).toHaveBeenCalledWith("aaaaaaaa-1");
});
