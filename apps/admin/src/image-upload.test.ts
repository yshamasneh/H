import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveImageSource } from "./image-source";
import { maxImageBytes, putBlob, validateImageFile } from "./image-upload";

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
  assert.equal(resolveImageSource("https://invalid.example/image.jpg", true, "/fallback.jpg"), "/fallback.jpg");
  assert.equal(resolveImageSource("https://cdn.example/image.jpg", false, "/fallback.jpg"), "https://cdn.example/image.jpg");
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
