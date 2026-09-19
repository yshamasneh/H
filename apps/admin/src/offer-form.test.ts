import assert from "node:assert/strict";
import test from "node:test";
import { buildOffer, emptyOfferDraft, offerToDraft, offerToggleBody, toLocalInput, type OfferView } from "./offer-form";

const draft = (over: Partial<ReturnType<typeof emptyOfferDraft>> = {}) => ({
  ...emptyOfferDraft(),
  title: "Weekend 10%",
  restaurantId: "rest-1",
  ...over
});

const errorOf = (result: { ok: boolean }) => (result as { error?: string }).error;

test("builds a valid order-percentage offer with money converted exactly", () => {
  const result = buildOffer(draft({ minimumSubtotal: "35.50", maxDiscount: "5.15" }));
  assert.ok(result.ok);
  assert.deepEqual(result.body, {
    type: "ORDER_PERCENTAGE",
    restaurantId: "rest-1",
    title: "Weekend 10%",
    discountPercent: 10,
    minimumSubtotalMinor: 3550,
    maxDiscountMinor: 515,
    isActive: true
  });
});

test("free delivery carries no percentage, no cap and needs no restaurant", () => {
  const result = buildOffer(draft({ type: "FREE_DELIVERY", restaurantId: "", discountPercent: "30", maxDiscount: "9" }));
  assert.ok(result.ok);
  assert.equal("discountPercent" in result.body, false);
  assert.equal("maxDiscountMinor" in result.body, false);
  assert.equal("restaurantId" in result.body, false);
});

test("enforces the same required-field rules as the API", () => {
  assert.equal(errorOf(buildOffer(draft({ title: " a " }))), "titleRequired");
  assert.equal(errorOf(buildOffer(draft({ restaurantId: "" }))), "restaurantRequired");
  assert.equal(errorOf(buildOffer(draft({ type: "PRODUCT_PERCENTAGE", menuItemId: "" }))), "productRequired");
  assert.equal(errorOf(buildOffer(draft({ type: "DELIVERY_PERCENTAGE", restaurantId: "" }))), undefined);
  for (const bad of ["0", "101", "abc", "", "10.5"]) {
    assert.equal(errorOf(buildOffer(draft({ discountPercent: bad }))), "percentInvalid", bad);
  }
  assert.equal(errorOf(buildOffer(draft({ minimumSubtotal: "-1" }))), "minimumInvalid");
  assert.equal(errorOf(buildOffer(draft({ maxDiscount: "0" }))), "maxDiscountInvalid");
});

test("a product is sent only for product offers", () => {
  const product = buildOffer(draft({ type: "PRODUCT_PERCENTAGE", menuItemId: "item-1" }));
  assert.ok(product.ok);
  assert.equal(product.body.menuItemId, "item-1");
  const order = buildOffer(draft({ menuItemId: "stale-selection" }));
  assert.ok(order.ok);
  assert.equal("menuItemId" in order.body, false);
});

test("the end must be after the start, and an unset start on create is left to the server", () => {
  const created = buildOffer(draft());
  assert.ok(created.ok);
  assert.equal("startsAt" in created.body, false);

  assert.equal(
    errorOf(buildOffer(draft({ startsAt: "2030-01-02T10:00", endsAt: "2030-01-02T10:00" }))),
    "endBeforeStart"
  );
  assert.equal(errorOf(buildOffer(draft({ endsAt: "2001-01-01T00:00" }))), "endBeforeStart");
  assert.equal(errorOf(buildOffer(draft({ startsAt: "nope" }))), "startInvalid");
  assert.ok(buildOffer(draft({ startsAt: "2030-01-02T10:00", endsAt: "2030-01-03T10:00" })).ok);
});

const stored: OfferView = {
  id: "offer-1",
  type: "PRODUCT_PERCENTAGE",
  restaurantId: "rest-1",
  restaurantName: "Kitchen",
  menuItemId: "item-1",
  menuItemName: "Falafel",
  title: "Falafel deal",
  description: "Two for one",
  discountPercent: 25,
  minimumSubtotalMinor: 2000,
  maxDiscountMinor: 800,
  imageUrl: "https://blob.example/offers/rest-1/a.jpg",
  startsAt: "2026-09-01T08:00:00.000Z",
  endsAt: "2026-10-01T08:00:00.000Z",
  isActive: true,
  createdAt: "2026-08-30T08:00:00.000Z"
};

test("editing hands the untouched image URL and start back, so a full-replace update cannot strip them", () => {
  const edited = buildOffer({ ...offerToDraft(stored), title: "Falafel deal 2" }, { imageUrl: stored.imageUrl, startsAt: stored.startsAt });
  assert.ok(edited.ok);
  assert.equal(edited.body.imageUrl, stored.imageUrl);
  assert.equal(edited.body.title, "Falafel deal 2");
  assert.equal(edited.body.discountPercent, 25);
  assert.equal(edited.body.maxDiscountMinor, 800);
  assert.equal(edited.body.menuItemId, "item-1");
  // start is re-derived from the local input; it must be the same instant it was.
  assert.equal(new Date(edited.body.startsAt!).getTime(), new Date(stored.startsAt).getTime());
});

test("pausing changes only isActive and drops nothing else", () => {
  const paused = offerToggleBody(stored, false);
  assert.deepEqual(paused, {
    type: "PRODUCT_PERCENTAGE",
    restaurantId: "rest-1",
    menuItemId: "item-1",
    title: "Falafel deal",
    description: "Two for one",
    discountPercent: 25,
    minimumSubtotalMinor: 2000,
    maxDiscountMinor: 800,
    imageUrl: "https://blob.example/offers/rest-1/a.jpg",
    startsAt: "2026-09-01T08:00:00.000Z",
    endsAt: "2026-10-01T08:00:00.000Z",
    isActive: false
  });
});

test("toLocalInput round-trips an instant to the minute", () => {
  const local = toLocalInput("2026-09-01T08:00:00.000Z");
  assert.match(local, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(new Date(local).toISOString(), "2026-09-01T08:00:00.000Z");
  assert.equal(toLocalInput(null), "");
});

test("an untouched start and end are handed back to the exact millisecond", () => {
  const withSeconds = { ...stored, startsAt: "2026-09-01T08:00:37.412Z", endsAt: "2026-10-01T08:00:12.900Z" };
  const edited = buildOffer(offerToDraft(withSeconds), { imageUrl: null, startsAt: withSeconds.startsAt, endsAt: withSeconds.endsAt });
  assert.ok(edited.ok);
  assert.equal(edited.body.startsAt, "2026-09-01T08:00:37.412Z");
  assert.equal(edited.body.endsAt, "2026-10-01T08:00:12.900Z");
});
