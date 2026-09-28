import assert from "node:assert/strict";
import { test } from "node:test";
import { loadRecentlyViewed, parseRecentlyViewed, recentlyViewedLimit, recordRecentlyViewed, withViewed } from "./recently-viewed";

const base = { storeId: "s1", imageUrl: null };

test("the most recent view comes first, without duplicates, and the list is capped", () => {
  let list = withViewed([], { ...base, id: "a", name: "A" }, 1);
  list = withViewed(list, { ...base, id: "b", name: "B" }, 2);
  list = withViewed(list, { ...base, id: "a", name: "A" }, 3);
  assert.deepEqual(list.map((entry) => entry.id), ["a", "b"]);
  for (let index = 0; index < 20; index += 1) list = withViewed(list, { ...base, id: `p${index}`, name: "P" }, 10 + index);
  assert.equal(list.length, recentlyViewedLimit);
  assert.equal(list[0].id, "p19");
});

test("stored data that is corrupt or foreign is dropped, never thrown", () => {
  assert.deepEqual(parseRecentlyViewed(null), []);
  assert.deepEqual(parseRecentlyViewed("{not json"), []);
  assert.deepEqual(parseRecentlyViewed(JSON.stringify({ id: "a" })), []);
  const parsed = parseRecentlyViewed(JSON.stringify([{ id: "a", storeId: "s1", name: "A" }, { id: 5 }, null]));
  assert.deepEqual(parsed, [{ id: "a", storeId: "s1", name: "A", imageUrl: null, viewedAt: 0 }]);
});

test("views are kept per customer, and a failing store never breaks anything", async () => {
  const memory = new Map<string, string>();
  const store = {
    getItem: async (key: string) => memory.get(key) ?? null,
    setItem: async (key: string, value: string) => void memory.set(key, value),
    removeItem: async (key: string) => void memory.delete(key)
  };
  await recordRecentlyViewed(store, "u1", { ...base, id: "a", name: "A" }, 1);
  assert.deepEqual((await loadRecentlyViewed(store, "u1")).map((entry) => entry.id), ["a"]);
  assert.deepEqual(await loadRecentlyViewed(store, "u2"), []);

  const broken = { getItem: async () => { throw new Error("x"); }, setItem: async () => { throw new Error("x"); }, removeItem: async () => undefined };
  assert.deepEqual(await loadRecentlyViewed(broken, "u1"), []);
  await recordRecentlyViewed(broken, "u1", { ...base, id: "a", name: "A" });
});
