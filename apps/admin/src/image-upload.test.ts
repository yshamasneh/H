import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveImageSource } from "./image-source";
import { isSafeExternalImageUrl, maxImageBytes, putBlob, saveOfferWithImage, saveProductWithImage, uploadImage, validateImageFile } from "./image-upload";

test("file validation accepts only JPEG, PNG, and WebP within five megabytes", () => {
  assert.equal(validateImageFile({ type: "image/jpeg", size: 100 }), null);
  assert.equal(validateImageFile({ type: "image/png", size: maxImageBytes }), null);
  assert.equal(validateImageFile({ type: "image/webp", size: 1 }), null);
  assert.equal(validateImageFile({ type: "image/gif", size: 100 }), "type");
  assert.equal(validateImageFile({ type: "image/jpeg", size: maxImageBytes + 1 }), "size");
});
test("fallback resolution covers empty and failed remote URLs", () => {
  assert.equal(resolveImageSource(null, false, "/fallback.jpg"), "/fallback.jpg");
  assert.equal(resolveImageSource("", false, "/fallback.jpg"), "/fallback.jpg");
  assert.equal(resolveImageSource("   ", false, "/fallback.jpg"), "/fallback.jpg");
  assert.equal(resolveImageSource("bad url", false, "/fallback.jpg"), "/fallback.jpg");
  assert.equal(resolveImageSource("javascript:alert(1)", false, "/fallback.jpg"), "/fallback.jpg");
  assert.equal(resolveImageSource("https://invalid.example/image.jpg", true, "/fallback.jpg"), "/fallback.jpg");
  assert.equal(resolveImageSource("https://cdn.example/image.jpg", false, "/fallback.jpg"), "https://cdn.example/image.jpg");
  assert.equal(resolveImageSource("blob:https://admin.example/preview", false, "/fallback.jpg"), "blob:https://admin.example/preview");
});

test("browser PUT reports progress and rejects failed uploads", async () => {
  const original = globalThis.XMLHttpRequest;
  class FakeXhr {
    static status = 201;
    status = FakeXhr.status;
    upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
    onload?: () => void;
    onerror?: () => void;
    onabort?: () => void;
    open() {}
    setRequestHeader() {}
    send() {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 3, total: 4 });
      this.onload?.();
    }
  }
  globalThis.XMLHttpRequest = FakeXhr as never;
  try {
    const progress: number[] = [];
    await putBlob("https://upload.invalid", {}, new Blob(["ok"]), (value) => progress.push(value));
    assert.deepEqual(progress, [75, 100]);
    FakeXhr.status = 500;
    await assert.rejects(() => putBlob("https://upload.invalid", {}, new Blob(["no"])), /status 500/);
  } finally {
    globalThis.XMLHttpRequest = original;
  }
});

test("SAS, Blob PUT, and complete failures never return a persistent URL", async () => {
  const file = new File(["image"], "photo.jpg", { type: "image/jpeg" });
  const steps: string[] = [];
  let failing: "sas" | "put" | "complete" | null = null;
  const services = {
    createTicket: async () => {
      steps.push("sas");
      if (failing === "sas") throw new Error("SAS failed");
      return { purpose: "PRODUCT" as const, restaurantId: "store", uploadId: "pending/image", uploadUrl: "https://upload.example/blob?sig=secret", expiresAt: "later", headers: {} };
    },
    put: async () => {
      steps.push("put");
      if (failing === "put") throw new Error("Blob failed");
    },
    complete: async () => {
      steps.push("complete");
      if (failing === "complete") throw new Error("complete failed");
      return { imageUrl: "https://images.example/public/photo.jpg", blobName: "photo.jpg" };
    }
  };
  const input = { file, purpose: "PRODUCT" as const, restaurantId: "store" };
  for (const [stage, expected] of [["sas", ["sas"]], ["put", ["sas", "put"]], ["complete", ["sas", "put", "complete"]]] as const) {
    steps.length = 0;
    failing = stage;
    await assert.rejects(() => uploadImage(input, services), /failed/);
    assert.deepEqual(steps, expected);
  }
  steps.length = 0;
  failing = null;
  assert.equal(await uploadImage(input, services), "https://images.example/public/photo.jpg");
  assert.deepEqual(steps, ["sas", "put", "complete"]);
});

test("replacing a product image deletes the old image only after the product save", async () => {
  const events: string[] = [];
  const file = new File(["image"], "photo.jpg", { type: "image/jpeg" });
  const base = {
    selection: file,
    previousUrl: "https://images.example/old.jpg",
    draftUrl: "https://images.example/old.jpg",
    restaurantId: "store",
    upload: async () => { events.push("upload"); return "https://images.example/new.jpg"; },
    remove: async ({ imageUrl }: { imageUrl: string }) => { events.push(`delete:${imageUrl}`); }
  };
  await saveProductWithImage({ ...base, save: async (imageUrl) => { events.push(`save:${imageUrl}`); return true; } });
  assert.deepEqual(events, ["upload", "save:https://images.example/new.jpg", "delete:https://images.example/old.jpg"]);

  events.length = 0;
  await assert.rejects(() => saveProductWithImage({ ...base, save: async () => { events.push("save failed"); throw new Error("save failed"); } }), /save failed/);
  assert.deepEqual(events, ["upload", "save failed", "delete:https://images.example/new.jpg"]);
});

test("replacing an offer's image deletes the old image only after the offer save, and uploads under OFFER", async () => {
  const events: string[] = [];
  const file = new File(["image"], "photo.jpg", { type: "image/jpeg" });
  const base = {
    selection: file,
    previousUrl: "https://images.example/old.jpg",
    restaurantId: "store",
    upload: async (input: { purpose: string; restaurantId?: string }) => {
      events.push(`upload:${input.purpose}:${input.restaurantId}`);
      return "https://images.example/new.jpg";
    },
    remove: async ({ imageUrl }: { imageUrl: string }) => { events.push(`delete:${imageUrl}`); }
  };
  await saveOfferWithImage({ ...base, save: async (imageUrl) => { events.push(`save:${imageUrl}`); return true; } });
  assert.deepEqual(events, [
    "upload:OFFER:store",
    "save:https://images.example/new.jpg",
    "delete:https://images.example/old.jpg"
  ]);

  events.length = 0;
  await assert.rejects(
    () => saveOfferWithImage({ ...base, save: async () => { events.push("save failed"); throw new Error("save failed"); } }),
    /save failed/
  );
  assert.deepEqual(events, ["upload:OFFER:store", "save failed", "delete:https://images.example/new.jpg"]);
});

test("a platform-wide offer (no restaurant) uploads under OFFER with no restaurantId", async () => {
  const events: string[] = [];
  const file = new File(["image"], "photo.jpg", { type: "image/jpeg" });
  await saveOfferWithImage({
    selection: file,
    previousUrl: null,
    restaurantId: undefined,
    upload: async (input) => {
      events.push(`upload:${input.purpose}:${input.restaurantId}`);
      return "https://images.example/new.jpg";
    },
    remove: async () => { events.push("delete"); },
    save: async (imageUrl) => { events.push(`save:${imageUrl}`); return true; }
  });
  assert.deepEqual(events, ["upload:OFFER:undefined", "save:https://images.example/new.jpg"]);
});

test("removing an offer's image sends an empty imageUrl and deletes the old one, without ever uploading", async () => {
  const events: string[] = [];
  await saveOfferWithImage({
    selection: null,
    previousUrl: "https://images.example/old.jpg",
    restaurantId: "store",
    upload: async () => { events.push("upload"); return "unexpected"; },
    remove: async ({ imageUrl }) => { events.push(`delete:${imageUrl}`); },
    save: async (imageUrl) => { events.push(`save:${imageUrl}`); return true; }
  });
  assert.deepEqual(events, ["save:", "delete:https://images.example/old.jpg"]);
});

test("leaving an offer's image untouched neither uploads, saves an imageUrl, nor deletes anything", async () => {
  const events: string[] = [];
  await saveOfferWithImage({
    selection: undefined,
    previousUrl: "https://images.example/old.jpg",
    restaurantId: "store",
    upload: async () => { events.push("upload"); return "unexpected"; },
    remove: async ({ imageUrl }) => { events.push(`delete:${imageUrl}`); },
    save: async (imageUrl) => { events.push(`save:${imageUrl}`); return true; }
  });
  assert.deepEqual(events, ["save:undefined"]);
});

test("external image URL requires plain HTTPS without signed query credentials", () => {
  assert.equal(isSafeExternalImageUrl("https://images.example/photo.jpg"), true);
  assert.equal(isSafeExternalImageUrl("http://images.example/photo.jpg"), false);
  assert.equal(isSafeExternalImageUrl("https://images.example/photo.jpg?sig=secret"), false);
  assert.equal(isSafeExternalImageUrl("https://images.example/photo.jpg?x-amz-signature=secret"), false);
});
