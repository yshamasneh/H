import assert from "node:assert/strict";
import test from "node:test";
import { checkImageUrl, maxImageUrlLength } from "./image-url.util";

test("accepts an external https image and an application blob URL alike", () => {
  assert.equal(checkImageUrl("https://cdn.example.com/products/milk-1l.jpg"), null);
  assert.equal(checkImageUrl("https://jovo.blob.core.windows.net/public/products/r1/abc.webp"), null);
  assert.equal(checkImageUrl("  https://cdn.example.com/a.png  "), null);
  // Query strings are normal for CDN-hosted pictures and must not be rejected.
  assert.equal(checkImageUrl("https://cdn.example.com/a.jpg?v=3&w=600"), null);
  assert.equal(checkImageUrl("https://cdn.example.com/صورة/حليب.jpg"), null);
});

test("refuses anything that is not https", () => {
  assert.equal(checkImageUrl("http://cdn.example.com/a.jpg"), "NOT_HTTPS");
  assert.equal(checkImageUrl("javascript:alert(1)"), "NOT_HTTPS");
  assert.equal(checkImageUrl("data:image/png;base64,AAAA"), "NOT_HTTPS");
  assert.equal(checkImageUrl("ftp://cdn.example.com/a.jpg"), "NOT_HTTPS");
});

test("refuses text that is not a URL, and whitespace or control characters inside one", () => {
  assert.equal(checkImageUrl("logo.png"), "NOT_A_URL");
  assert.equal(checkImageUrl("not a url"), "NOT_A_URL");
  assert.equal(checkImageUrl("https://cdn.example.com/a b.jpg"), "NOT_A_URL");
  assert.equal(checkImageUrl("https://cdn.example.com/a.jpg\r\nX-Injected: 1"), "NOT_A_URL");
});

test("refuses embedded credentials and hosts a customer's phone cannot reach", () => {
  assert.equal(checkImageUrl("https://user:pass@cdn.example.com/a.jpg"), "HAS_CREDENTIALS");
  assert.equal(checkImageUrl("https://localhost/a.jpg"), "BAD_HOST");
  assert.equal(checkImageUrl("https://intranet/a.jpg"), "BAD_HOST");
  assert.equal(checkImageUrl("https://cdn.example.com./a.jpg"), "BAD_HOST");
});

test("refuses an over-long URL", () => {
  const long = `https://cdn.example.com/${"a".repeat(maxImageUrlLength)}.jpg`;
  assert.equal(checkImageUrl(long), "TOO_LONG");
  assert.equal(checkImageUrl(`https://cdn.example.com/${"a".repeat(200)}.jpg`), null);
});

test("refuses a signed, expiring link whether Azure, S3 or GCS issued it", () => {
  assert.equal(
    checkImageUrl("https://acct.blob.core.windows.net/c/a.webp?sv=2023-01-01&se=2030-01-01&sp=r&sig=abc%3D"),
    "SIGNED_URL"
  );
  assert.equal(checkImageUrl("https://b.s3.amazonaws.com/a.jpg?X-Amz-Signature=abc&X-Amz-Expires=60"), "SIGNED_URL");
  assert.equal(checkImageUrl("https://storage.googleapis.com/b/a.jpg?X-Goog-Signature=abc"), "SIGNED_URL");
  // An ordinary cache-busting or resize query is not a signature.
  assert.equal(checkImageUrl("https://cdn.example.com/a.jpg?sig=1"), null);
});
