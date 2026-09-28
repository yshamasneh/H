import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import i18n from "../../i18n";
import * as api from "../../core/api";
import { AdminCostApprovalsScreen } from "./cost-approvals-screen";
import { AdminDriverCashDetailScreen, AdminDriverCashScreen } from "./driver-cash-screens";

jest.mock("../../core/api", () => ({
  fetchAdminAccess: jest.fn(),
  getAdminAccountingOverview: jest.fn(),
  listAdminDriverCash: jest.fn(),
  listAdminDriverCustody: jest.fn(),
  listAdminCashSettlements: jest.fn(),
  recordAdminCashSettlement: jest.fn(),
  listAdminOperatingCosts: jest.fn(),
  decideAdminOperatingCost: jest.fn(),
  ApiError: class ApiError extends Error {}
}));
jest.mock("../../core/session", () => ({ getAccessToken: jest.fn().mockResolvedValue("token") }));

const mocked = api as jest.Mocked<typeof api>;
const everyPermission = { isSuperAdmin: true, permissions: [] };

const dana: api.AdminDriverCash = {
  driverUserId: "d1",
  driverName: "Dana Driver",
  driverPhone: "+970599000111",
  collectedMinor: 15_000,
  settledMinor: 4_400,
  outstandingMinor: 10_600,
  outstandingOrderCount: 3,
  oldestOutstandingAt: "2020-01-01T10:00:00.000Z",
  earningsMinor: 2_100,
  earningsPaidMinor: 700
};
const sami: api.AdminDriverCash = { ...dana, driverUserId: "d2", driverName: "Sami Settled", outstandingMinor: 0, outstandingOrderCount: 0, oldestOutstandingAt: null };

const custody: api.AdminDriverCustodyLine[] = [
  { custodyId: "a", orderId: "aaaaaaaa-1111", collectedAt: "2026-09-26T10:00:00.000Z", expectedAmountMinor: 2400, collectedAmountMinor: 2400, settledAmountMinor: 0, outstandingMinor: 2400, status: "OUTSTANDING" },
  { custodyId: "b", orderId: "bbbbbbbb-2222", collectedAt: "2026-09-27T10:00:00.000Z", expectedAmountMinor: 5400, collectedAmountMinor: 5400, settledAmountMinor: 0, outstandingMinor: 5400, status: "OUTSTANDING" },
  { custodyId: "c", orderId: "cccccccc-3333", collectedAt: "2026-09-28T10:00:00.000Z", expectedAmountMinor: 2800, collectedAmountMinor: 2800, settledAmountMinor: 0, outstandingMinor: 2800, status: "OUTSTANDING" }
];

const recorded: api.AdminCashSettlement = {
  id: "s1",
  driverUserId: "d1",
  driverName: "Dana Driver",
  receivedByName: "Admin Amal",
  reference: "HANDOVER-2026-09-28-ABCD",
  mode: "SELECTED",
  expectedAmountMinor: 2400,
  countedAmountMinor: 2000,
  discrepancyMinor: -400,
  discrepancyNote: "Change given to a customer",
  note: null,
  settledAt: "2026-09-28T12:00:00.000Z",
  allocations: [{ custodyId: "a", orderId: "aaaaaaaa-1111", amountMinor: 2000 }]
};

beforeAll(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  mocked.fetchAdminAccess.mockResolvedValue(everyPermission);
  mocked.listAdminDriverCash.mockResolvedValue([sami, dana]);
  mocked.getAdminAccountingOverview.mockResolvedValue({ cashSettledMinor: 8_800 } as api.AdminAccountingOverview);
  mocked.listAdminDriverCustody.mockResolvedValue(custody);
  mocked.listAdminCashSettlements.mockResolvedValue([]);
  mocked.recordAdminCashSettlement.mockResolvedValue(recorded);
});

test("the cash list leads with whoever holds the most, and the total held", async () => {
  const onOpenDriver = jest.fn();
  render(<AdminDriverCashScreen onBack={() => undefined} onOpenDriver={onOpenDriver} />);
  expect(await screen.findAllByText("106.00 ILS")).toHaveLength(2); // the total, and Dana's badge
  expect(screen.getByText("1 driver holding cash")).toBeTruthy();
  expect(screen.getByText("88.00 ILS")).toBeTruthy();
  const names = screen.getAllByText(/Dana Driver|Sami Settled/).map((node) => node.props.children);
  expect(names).toEqual(["Dana Driver", "Sami Settled"]);
  expect(screen.getByText("Not holding any cash now.")).toBeTruthy();
  fireEvent.press(screen.getByText("Dana Driver"));
  expect(onOpenDriver).toHaveBeenCalledWith(dana);
});

test("receiving cash: tick orders, a short count needs a reason, confirm, then the stored receipt", async () => {
  render(<AdminDriverCashDetailScreen driverUserId="d1" onBack={() => undefined} onOpenOrder={() => undefined} />);
  expect(await screen.findByText("Receive cash")).toBeTruthy();
  await screen.findByTestId("custody-a");
  expect(screen.getByDisplayValue("106.00")).toBeTruthy();
  expect(screen.getByText("Matches what was expected")).toBeTruthy();

  fireEvent.press(screen.getByTestId("custody-a"));
  expect(screen.getByDisplayValue("24.00")).toBeTruthy();

  fireEvent.changeText(screen.getByDisplayValue("24.00"), "20");
  expect(screen.getByText("Short by 4.00 ILS")).toBeTruthy();
  fireEvent.press(screen.getByText("Record handover"));
  expect(screen.queryByText("Yes, record it")).toBeNull(); // a short count cannot be recorded without a reason

  fireEvent.changeText(screen.getByPlaceholderText("Reason for the difference (required)"), "Change given to a customer");
  fireEvent.press(screen.getByText("Record handover"));
  expect(screen.getByText(/Record receiving 20.00 ILS from Dana Driver\?/)).toBeTruthy();
  fireEvent.press(screen.getByText("Yes, record it"));

  await waitFor(() => expect(mocked.recordAdminCashSettlement).toHaveBeenCalledTimes(1));
  const [, body] = mocked.recordAdminCashSettlement.mock.calls[0];
  expect(body).toEqual(
    expect.objectContaining({
      driverUserId: "d1",
      countedAmountMinor: 2000,
      custodyIds: ["a"],
      discrepancyNote: "Change given to a customer"
    })
  );
  expect(body.reference).toMatch(/^HANDOVER-\d{4}-\d{2}-\d{2}-/);

  expect(await screen.findByText("Cash handover receipt")).toBeTruthy();
  expect(screen.getByText("Admin Amal")).toBeTruthy();
  expect(screen.getByText("-4.00 ILS")).toBeTruthy();
  expect(screen.getByText("HANDOVER-2026-09-28-ABCD")).toBeTruthy();
});

test("without permission to receive cash, the balance and history show but no handover form", async () => {
  mocked.fetchAdminAccess.mockResolvedValue({ isSuperAdmin: false, permissions: ["VIEW_ACCOUNTING"] });
  mocked.listAdminCashSettlements.mockResolvedValue([recorded]);
  render(<AdminDriverCashDetailScreen driverUserId="d1" onBack={() => undefined} onOpenOrder={() => undefined} />);
  expect(await screen.findByText("Receiving cash needs permission to receive driver cash.")).toBeTruthy();
  expect(screen.queryByText("Receive cash")).toBeNull();
  expect(mocked.listAdminDriverCustody).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText("20.00 ILS"));
  expect(await screen.findByText("Cash handover receipt")).toBeTruthy();
});

test("without accounting access nothing is requested", async () => {
  mocked.fetchAdminAccess.mockResolvedValue({ isSuperAdmin: false, permissions: ["MANAGE_USERS"] });
  render(<AdminDriverCashScreen onBack={() => undefined} onOpenDriver={jest.fn()} />);
  expect(await screen.findByText("Viewing driver cash needs permission to view accounting.")).toBeTruthy();
  expect(mocked.listAdminDriverCash).not.toHaveBeenCalled();
});

const cost: api.AdminOperatingCost = {
  id: "cost1",
  businessId: "b1",
  businessName: "JOVO MARKET",
  category: "UTILITIES",
  description: "Electricity, September",
  amountMinor: 45_000,
  incurredOn: "2026-09-25T00:00:00.000Z",
  periodLabel: "2026-09",
  isRecurring: true,
  status: "PROPOSED",
  proposedByName: "Store Manager",
  approverName: null,
  decidedAt: null,
  decisionNote: null,
  createdAt: "2026-09-26T00:00:00.000Z",
  shares: []
};

test("a cost is approved only after confirming, and rejected only with a reason", async () => {
  mocked.listAdminOperatingCosts.mockResolvedValue([cost]);
  mocked.decideAdminOperatingCost.mockResolvedValue({ ...cost, status: "APPROVED" });
  render(<AdminCostApprovalsScreen onBack={() => undefined} />);
  expect(await screen.findByText("450.00 ILS")).toBeTruthy();
  expect(screen.getByText("Utilities")).toBeTruthy();
  expect(mocked.listAdminOperatingCosts).toHaveBeenLastCalledWith("token", "PROPOSED");

  fireEvent.press(screen.getByText("Reject"));
  const confirmReject = screen.getAllByText("Reject");
  fireEvent.press(confirmReject[confirmReject.length - 1]);
  expect(mocked.decideAdminOperatingCost).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByPlaceholderText("Reason for rejecting (shown to the store)"), "Duplicate invoice");
  fireEvent.press(screen.getAllByText("Reject").slice(-1)[0]);
  await waitFor(() =>
    expect(mocked.decideAdminOperatingCost).toHaveBeenCalledWith("token", "cost1", { approve: false, note: "Duplicate invoice" })
  );
});

test("approving shows what will be written to the ledger first", async () => {
  mocked.listAdminOperatingCosts.mockResolvedValue([cost]);
  mocked.decideAdminOperatingCost.mockResolvedValue({ ...cost, status: "APPROVED" });
  render(<AdminCostApprovalsScreen onBack={() => undefined} />);
  fireEvent.press(await screen.findByText("Approve"));
  expect(screen.getByText(/450.00 ILS will be split between the parties/)).toBeTruthy();
  expect(mocked.decideAdminOperatingCost).not.toHaveBeenCalled();
  fireEvent.press(screen.getAllByText("Approve").slice(-1)[0]);
  await waitFor(() => expect(mocked.decideAdminOperatingCost).toHaveBeenCalledWith("token", "cost1", { approve: true }));
});

test("without the approval permission the queue is read-only", async () => {
  mocked.fetchAdminAccess.mockResolvedValue({ isSuperAdmin: false, permissions: ["VIEW_ACCOUNTING"] });
  mocked.listAdminOperatingCosts.mockResolvedValue([cost]);
  render(<AdminCostApprovalsScreen onBack={() => undefined} />);
  expect(await screen.findByText("450.00 ILS")).toBeTruthy();
  expect(screen.queryByText("Approve")).toBeNull();
  expect(screen.queryByText("Reject")).toBeNull();
});
