import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "../../i18n";
import { HandoverBanner } from "./handover-banner";

const mockGetSummary = jest.fn();
jest.mock("../../core/api", () => ({
  getDriverCashSummary: (...args: unknown[]) => mockGetSummary(...args)
}));
jest.mock("../../core/session", () => ({ getAccessToken: jest.fn().mockResolvedValue("token") }));

const summaryWith = (cashOwedToPlatformMinor: number, unsettledOrderCount: number) => ({
  balance: { cashOwedToPlatformMinor, unsettledOrderCount }
});

beforeAll(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

beforeEach(() => mockGetSummary.mockReset());

test("after the last delivery the driver sees one number to hand over, and that it is all the cash they hold", async () => {
  mockGetSummary.mockResolvedValue(summaryWith(6400, 2));
  render(<HandoverBanner onOpen={() => undefined} refreshKey="DELIVERED" />);

  await screen.findByText("64.00 ₪");
  expect(screen.getByText("Cash to hand over to JOVO")).toBeTruthy();
  expect(screen.getByText("That is all the cash you hold, from 2 orders.")).toBeTruthy();
  expect(screen.getByText("It does not include your earnings: JOVO pays those to you separately.")).toBeTruthy();
});

test("it opens the cash screen to see the orders", async () => {
  mockGetSummary.mockResolvedValue(summaryWith(3200, 1));
  const onOpen = jest.fn();
  render(<HandoverBanner onOpen={onOpen} refreshKey="DELIVERED" />);

  await screen.findByText("32.00 ₪");
  fireEvent.press(screen.getByText("See the orders"));

  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(screen.getByText("That is all the cash you hold, from 1 order.")).toBeTruthy();
});

test("a driver holding nothing sees no banner on the home screen, but a clear 'nothing to hand over' after a delivery", async () => {
  mockGetSummary.mockResolvedValue(summaryWith(0, 0));
  const home = render(<HandoverBanner onOpen={() => undefined} refreshKey={1} />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(home.queryByText("Cash to hand over to JOVO")).toBeNull();
  expect(home.queryByText("You are holding no customer cash. Nothing to hand over.")).toBeNull();
  home.unmount();

  render(<HandoverBanner onOpen={() => undefined} refreshKey="DELIVERED" showWhenZero />);
  expect(await screen.findByText("You are holding no customer cash. Nothing to hand over.")).toBeTruthy();
});

test("a failed lookup leaves the banner out rather than showing a wrong number", async () => {
  mockGetSummary.mockRejectedValue(new Error("offline"));
  render(<HandoverBanner onOpen={() => undefined} refreshKey="DELIVERED" showWhenZero />);
  await act(async () => {
    await Promise.resolve();
  });

  expect(screen.queryByText("Cash to hand over to JOVO")).toBeNull();
  expect(screen.queryByText("You are holding no customer cash. Nothing to hand over.")).toBeNull();
});
