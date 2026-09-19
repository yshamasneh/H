import assert from "node:assert/strict";
import test from "node:test";
import { buildProfileUpdate, profileToDraft, type ProfileFields } from "./business-profile";

const original: ProfileFields = {
  name: "Wasel Kitchen",
  description: "Family falafel",
  addressLine: "Al-Manara Square",
  latitude: 31.9038,
  longitude: 35.2034,
  opensAt: "09:00",
  closesAt: "22:00"
};
const errorOf = (result: { ok: boolean }) => (result as { error?: string }).error;

test("an untouched form changes nothing and sends nothing", () => {
  const result = buildProfileUpdate(profileToDraft(original), original);
  assert.deepEqual(result, { ok: true, body: {}, changed: false });
});

test("only edited fields are sent, and the logo is never part of the body", () => {
  const draft = { ...profileToDraft(original), name: "  Wasel Kitchen 2 ", addressLine: "New street 5" };
  const result = buildProfileUpdate(draft, original);
  assert.ok(result.ok);
  assert.deepEqual(result.body, { name: "Wasel Kitchen 2", addressLine: "New street 5" });
  assert.equal("logoUrl" in result.body, false);
});

test("coordinates travel as a pair, only when one of them moved", () => {
  const moved = buildProfileUpdate({ ...profileToDraft(original), latitude: 31.95 }, original);
  assert.ok(moved.ok);
  assert.deepEqual(moved.body, { latitude: 31.95, longitude: 35.2034 });

  assert.equal(errorOf(buildProfileUpdate({ ...profileToDraft(original), latitude: null }, original)), "coordinatesInvalid");
  assert.equal(errorOf(buildProfileUpdate({ ...profileToDraft(original), latitude: 95 }, original)), "coordinatesInvalid");
  assert.equal(errorOf(buildProfileUpdate({ ...profileToDraft(original), longitude: -181 }, original)), "coordinatesInvalid");
});

test("hours: both or neither, real times, and not the same time", () => {
  const draft = profileToDraft(original);
  const changed = buildProfileUpdate({ ...draft, opensAt: "08:30", closesAt: "23:15" }, original);
  assert.ok(changed.ok);
  assert.deepEqual(changed.body, { opensAt: "08:30", closesAt: "23:15" });

  const cleared = buildProfileUpdate({ ...draft, opensAt: "", closesAt: "" }, original);
  assert.ok(cleared.ok);
  assert.deepEqual(cleared.body, { opensAt: "", closesAt: "" });

  assert.equal(errorOf(buildProfileUpdate({ ...draft, closesAt: "" }, original)), "hoursIncomplete");
  assert.equal(errorOf(buildProfileUpdate({ ...draft, opensAt: "9:00" }, original)), "hoursInvalid");
  assert.equal(errorOf(buildProfileUpdate({ ...draft, opensAt: "24:00" }, original)), "hoursInvalid");
  assert.equal(errorOf(buildProfileUpdate({ ...draft, opensAt: "10:00", closesAt: "10:00" }, original)), "hoursSame");
  // A window that crosses midnight (22:00 -> 02:00) is a legitimate schedule.
  assert.ok(buildProfileUpdate({ ...draft, opensAt: "22:00", closesAt: "02:00" }, original).ok);
});

test("rejects unusable text fields", () => {
  const draft = profileToDraft(original);
  assert.equal(errorOf(buildProfileUpdate({ ...draft, name: " a " }, original)), "nameInvalid");
  assert.equal(errorOf(buildProfileUpdate({ ...draft, addressLine: "ab" }, original)), "addressInvalid");
  assert.equal(errorOf(buildProfileUpdate({ ...draft, description: "x".repeat(501) }, original)), "descriptionTooLong");
});

test("a store with no hours or description yet round-trips cleanly", () => {
  const bare: ProfileFields = { ...original, description: null, opensAt: null, closesAt: null };
  assert.deepEqual(buildProfileUpdate(profileToDraft(bare), bare), { ok: true, body: {}, changed: false });
});
