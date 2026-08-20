import assert from "node:assert/strict";
import { test } from "node:test";
import { performReload } from "./reload";

test("native reload uses Updates.reloadAsync and reports success", async () => {
  let nativeCalled = 0;
  let webCalled = 0;
  const ok = await performReload({
    platformOS: "ios",
    reloadWeb: () => {
      webCalled += 1;
    },
    reloadNative: async () => {
      nativeCalled += 1;
    }
  });
  assert.equal(ok, true);
  assert.equal(nativeCalled, 1);
  assert.equal(webCalled, 0, "web path must not run on native");
});

test("when the native reload API is unavailable/fails, performReload reports false (→ manual restart)", async () => {
  const ok = await performReload({
    platformOS: "android",
    reloadWeb: () => {},
    reloadNative: async () => {
      throw new Error("Updates.reloadAsync is not available in this environment");
    }
  });
  assert.equal(ok, false, "a failed reload must be surfaced, not swallowed silently");
});

test("web reload does a page reload and does not touch the native path", async () => {
  let nativeCalled = 0;
  let webCalled = 0;
  const ok = await performReload({
    platformOS: "web",
    reloadWeb: () => {
      webCalled += 1;
    },
    reloadNative: async () => {
      nativeCalled += 1;
    }
  });
  assert.equal(ok, true);
  assert.equal(webCalled, 1);
  assert.equal(nativeCalled, 0);
});
