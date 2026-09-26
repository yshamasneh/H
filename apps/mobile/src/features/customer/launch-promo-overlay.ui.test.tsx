import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "../../i18n";
import type { RestaurantOffer } from "../../core/api";
import { selectFeaturedOffer } from "./home-screen";
import { LaunchPromoOverlay, launchPromoDurationMs } from "./launch-promo-overlay";

function offer(overrides: Partial<RestaurantOffer> = {}): RestaurantOffer {
  return {
    id: "offer-1",
    type: "ORDER_PERCENTAGE",
    restaurantId: null,
    restaurantName: null,
    restaurantBusinessType: null,
    menuItemId: null,
    menuItemName: null,
    title: "Weekend deal",
    description: null,
    discountPercent: 20,
    imageUrl: null,
    startsAt: new Date().toISOString(),
    endsAt: null,
    minimumSubtotalMinor: 0,
    maxDiscountMinor: null,
    isActive: true,
    isFeatured: true,
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

test("shows the featured offer full-screen and auto-dismisses after the timeout", () => {
  jest.useFakeTimers();
  const onDone = jest.fn();
  render(<LaunchPromoOverlay offer={offer({ title: "Weekend deal" })} onDone={onDone} />);

  expect(screen.getByText("Weekend deal")).toBeTruthy();
  expect(screen.getByText(i18n.t("customer:home.featuredOfferEyebrow"))).toBeTruthy();
  expect(screen.getByText(/20/)).toBeTruthy();

  act(() => jest.advanceTimersByTime(launchPromoDurationMs - 1));
  expect(onDone).not.toHaveBeenCalled();

  act(() => jest.advanceTimersByTime(1));
  expect(onDone).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

test("tapping the overlay dismisses it immediately, without waiting for the timeout", () => {
  jest.useFakeTimers();
  const onDone = jest.fn();
  render(<LaunchPromoOverlay offer={offer()} onDone={onDone} />);

  fireEvent.press(screen.getByTestId("launch-promo-overlay"));
  expect(onDone).toHaveBeenCalledTimes(1);

  // The pending auto-dismiss timer must not also fire and call onDone a second time.
  act(() => jest.advanceTimersByTime(launchPromoDurationMs));
  expect(onDone).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

test("selectFeaturedOffer is what decides the overlay is skipped when there is nothing to feature", () => {
  expect(selectFeaturedOffer([])).toBeNull();
  expect(selectFeaturedOffer([offer({ isFeatured: false })])).toBeNull();
  // A restaurant-scoped offer is never shown to a customer at all (the vertical isn't open yet),
  // so it must not be selected even when the admin marked it featured.
  expect(selectFeaturedOffer([
    offer({ isFeatured: true, restaurantId: "r1", restaurantBusinessType: "RESTAURANT" })
  ])).toBeNull();

  const featured = offer({ id: "offer-2", isFeatured: true });
  expect(selectFeaturedOffer([offer({ isFeatured: false }), featured])).toBe(featured);
});
